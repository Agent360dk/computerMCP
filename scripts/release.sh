#!/bin/bash
# Udgiver én version fire steder paa én gang: git, GitHub, npm, MCP-registret.
#
# Findes fordi de fire versionstal glider fra hinanden naar de saettes i haanden.
# 18/9 stod sitet paa fjorten vaerktoejer mens npm leverede tolv, fordi
# udgivelsen var blokeret paa en doed token og alt andet var gaaet videre.
#
# Brug: scripts/release.sh 0.2.0
set -euo pipefail
V="${1:?brug: release.sh <version>}"
cd "$(dirname "$0")/.."
# FUNDET AF SIKKERHEDSREVIEWET 20/9: mine egne tilfoejelser i dag brugte
#    $ROOT seks steder - og den blev aldrig sat. Med set -u doer scriptet
#    paa foerste linje der naevner den, altsaa FOER trin 0. Udgivelsen kunne
#    ikke koere, og det ville foerst vise sig da nogen bad om den.
ROOT="$(pwd)"

# ⛔ RAEKKEFOELGEN ER HELE POINTEN (fundet 20/9). npm-README'en udledes af
#    repoets README i byggetrinnet - altsaa FOER publish - og en npm-README er
#    FROSSET pr. version. Stod forbeholdet "npx serves 0.1.0" der, ville det
#    staa i 0.2.0 for evigt og kraeve en 0.2.1 at fjerne.
#
#    Derfor saettes PUBLICERET til den version vi er ved at udgive FOER der
#    bygges, og teksten renses i samme aandedrag. Fejler noget undervejs,
#    ruller faelden det tilbage - saa staar sitet ikke og lyver om en udgivelse
#    der aldrig skete.
TIDLIGERE_UDGIVET=$(cat "$ROOT/PUBLICERET" 2>/dev/null || echo ukendt)
rul_tilbage() {
  if [ "$(cat "$ROOT/PUBLICERET" 2>/dev/null)" != "$TIDLIGERE_UDGIVET" ]; then
    echo "$TIDLIGERE_UDGIVET" > "$ROOT/PUBLICERET"
    python3 "$ROOT/scripts/sync-tal.py" >/dev/null 2>&1 || true
    echo "   (PUBLICERET rullet tilbage til $TIDLIGERE_UDGIVET - udgivelsen skete ikke)"
  fi
}
trap rul_tilbage EXIT

echo "== 0/7 teksten skal beskrive DEN version vi udgiver =="
echo "$V" > "$ROOT/PUBLICERET"
python3 "$ROOT/scripts/sync-tal.py" | sed 's/^/   /'

echo "== 1/7 byg den binaer vi faktisk udsender =="
# ⛔ Y3a. `mcp-server/vendor/` er gitignored: binaeren er IKKE i et commit, den
#    bygges her og kommer i npm-pakken via package.json' files-felt. Koerte
#    scriptet ikke denne linje, kunne pakken faa den binaer der tilfaeldigvis laa
#    paa maskinen - f.eks. én uden det vaerktoej commit'et lige har tilfoejet.
#    MAALT 19/9: kilden fik `wait-for`, og kun en manuel kopi lagde den i vendor.
./scripts/build-release.sh || { echo "⛔ byg fejlede"; exit 1; }
[ -x mcp-server/vendor/cmcp-helper ] || { echo "⛔ ingen binaer i vendor/"; exit 1; }

# ⛔ MAALT 19/9: den binaer der laa i vendor/ var arm64 ALENE - mens sitet,
#    README og llms.txt alle tre lovede "a signed universal binary for Apple
#    silicon and Intel". En Intel-Mac ville have faaet "bad CPU type" ved
#    install, paa et loefte vi selv havde skrevet tre steder.
#
#    Den gamle vagt spurgte kun OM der laa en binaer. Den spurgte ikke HVILKEN.
#    En vagt der kun tjekker eksistens, vogter ingenting.
ARCHS="$(lipo -archs mcp-server/vendor/cmcp-helper 2>/dev/null)"
case " $ARCHS " in
  *" arm64 "*) ;;
  *) echo "⛔ den udsendte binaer mangler arm64 (har: $ARCHS)"; exit 1 ;;
esac
case " $ARCHS " in
  *" x86_64 "*) ;;
  *) echo "⛔ den udsendte binaer er IKKE universel (har kun: $ARCHS)."
     echo "   Sitet, README og llms.txt lover universal. Byg med:"
     echo "   cd helper && swift build -c release --arch arm64 --arch x86_64"
     exit 1 ;;
esac
echo "   binaer: $ARCHS ✓"

echo "== 2/7 proever =="
# ⛔ Her stod foer: CMCP_DIALOGS=1 ./test/run-all.sh - altsaa otte aegte
#    macOS-dialoger paa menneskets skaerm ved HVERT udgivelsesforsoeg.
#    Samtykke-porten skal stadig vaere bevist, men den behoever ikke bevises
#    forfra hver gang; den behoever bevises for DEN KODE der udgives.
#
#    19/9 ANDEN RUNDE: samtykke-porten proeves nu HELE vejen gennem en attrap
#    for spoergeren, saa alle port-proever koerer ved hver koersel uden at vise
#    noget. Tilbage staar praecis ét faktum der kraever en aegte dialog: at
#    osascript selv skriver `gave up:true` efter `giving up after N`. Det er en
#    OS-kontrakt, ikke vores logik - og den er EEN boks i to sekunder, ikke otte.
#
#    Kvitteringen daekker nu kun den kontrakt, og de filer der kan aendre den.
./test/run-all.sh

KVIT=".dialog-kvittering"
# ⛔ TO GANGE RETTET, og anden gang var fordi produktet flyttede sig under den.
#
#    Foerst var listen for KORT: den daekkede ikke `tools.js`, hvor hvert
#    vaerktoejs niveau bor - saa en tier-aendring kunne slaa porten fra uden at
#    ugyldiggoere kvitteringen. Vagten bestod sin egen omgaaelse.
#
#    Saa blev den for BRED. Da samtykke-porten fik en attrap, blev ALT vores
#    eget bevist ved hver koersel uden et vindue. Tilbage staar praecis ét
#    faktum der kraever en aegte dialog: at macOS selv giver op efter
#    `giving up after N`. Kun to filer kan aendre DET - `policy.js`, som bygger
#    kommandoen og tolker svaret, og `failclosed.mjs`, som maaler det.
#
#    Med den brede liste ugyldiggjorde enhver rettelse i en proevefil
#    kvitteringen og kraevede en ny boks paa menneskets skaerm. En vagt der
#    koster en afbrydelse hver gang man retter en test, bliver slaaet fra.
PORT_FILER="mcp-server/policy.js test/failclosed.mjs"
NU=$(cat $PORT_FILER 2>/dev/null | shasum -a 256 | cut -c1-16)
KVITTERET=$(cut -d' ' -f1 "$KVIT" 2>/dev/null)
if [ "$NU" != "$KVITTERET" ]; then
  echo "⛔ samtykke-porten er UBEVIST for denne kode."
  echo "   kvittering: ${KVITTERET:-ingen} · koden nu: $NU"
  echo "   Koer EN gang (viser EEN dialog i 2 sekunder) og udgiv derefter:"
  echo "     CMCP_DIALOGS=1 ./test/run-all.sh"
  exit 1
fi
echo "   samtykke-porten bevist $(cut -d' ' -f2 "$KVIT") for denne kode ✓"

# ⛔ CI VAR ROED I 15 KOERSLER, og jeg opdagede det foerst da en raadgiver
#    laeste loggen. Fejlen - "mutation of captured var 'ud' in
#    concurrently-executing code" - kan min Swift 6.3 IKKE reproducere; runneren
#    koerer macos-14 med en aeldre oversaetter der kalder det en fejl.
#
#    Jeg forsoegte foerst at bygge en lokal port med -strict-concurrency og med
#    -swift-version 6. Ingen af dem udsender den diagnose paa den kode CI
#    afviste. En vagt der ikke kan fyre, er vaerre end ingen: den goer én tryg.
#
#    Den eneste maaling der VIRKER, er CI selv. Derfor: udgiv ikke fra en
#    commit hvor CI ikke er groen. Et tag paa en roed commit ville i oevrigt
#    lave en GitHub-udgivelse uden binaer, fordi release.yml bygger paa samme
#    runner.
echo "== 2b/7 CI skal vaere groen paa den commit der udgives =="
HEADSHA=$(git rev-parse HEAD)
CIDOM=$(gh run list -R Agent360dk/computerMCP -w CI --limit 20 \
          --json headSha,conclusion,status \
          -q "[.[] | select(.headSha==\"$HEADSHA\")] | .[0].conclusion" 2>/dev/null)
case "$CIDOM" in
  success) echo "   CI groen paa $(git rev-parse --short HEAD) ✓" ;;
  "" | null)
    echo "⛔ CI har ikke koert paa denne commit endnu ($(git rev-parse --short HEAD))."
    echo "   Skub foerst, vent paa groent, udgiv derefter. Et tag paa en uproevet"
    echo "   commit kan give en GitHub-udgivelse uden binaer."
    exit 1 ;;
  *)
    echo "⛔ CI er '$CIDOM' paa $(git rev-parse --short HEAD). Udgiver ikke."
    echo "   gh run list -R Agent360dk/computerMCP -w CI --limit 3"
    exit 1 ;;
esac

echo "== 3/7 versionerne skal vaere ens =="
for f in mcp-server/package.json server.json; do
  grep -q "\"version\": \"$V\"" "$f" || { echo "⛔ $f staar ikke paa $V"; exit 1; }
done
grep -q "^## $V" CHANGELOG.md || { echo "⛔ CHANGELOG.md mangler afsnittet ## $V"; exit 1; }

echo "== 4/7 vaerktoejstallet skal matche koden =="
# ⛔ Denne vagt stod foerst som `grep -qi "$N"`. MAALT 18/9: den bestod paa
# "font-size:14px", "macOS 14 or later" og "macOS only (14+)" - altsaa paa alt,
# uden at kigge paa vaerktoejstallet én gang. En vagt der bygges mod dagens fejl
# og bestaar dagens fejl, er vaerre end ingen vagt: den goer én tryg.
# Nu kraeves tallet i en form der IKKE kan vaere et versionsnummer eller en CSS-vaerdi.
N=$(node -e "import('./mcp-server/tools.js').then(m=>console.log(m.TOOLS.length))")
# ⛔ Listen stoppede ved "twenty". Ved 21 vaerktoejer gav `cut -f22` en tom
#    streng, og vagten ville have afvist hver eneste fil - eller vaerre,
#    matchet paa ingenting. En vagt med en graense skal naa laengere end
#    det den vogter.
WORDS="zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty"
WORD=$(echo "$WORDS" | cut -d' ' -f$((N+1)))
bad=0
for f in README.md docs/index.html docs/tools.html docs/llms.txt; do
  # enten "14 tools"/"14 vaerktoejer" eller ordformen "Fourteen tools"
  if grep -qiE "(^|[^0-9])$N (tools|vaerktoejer)|\b$WORD (tools|vaerktoejer)\b" "$f"; then
    echo "   ✓ $f siger $N"
  else
    echo "   ⛔ $f siger IKKE $N ($WORD) vaerktoejer"; bad=1
  fi
done
# og den femte version: hjaelperens egen streng
HV=$("$(ls mcp-server/vendor/cmcp-helper 2>/dev/null || echo helper/.build/release/cmcp-helper)" version 2>/dev/null | tr -d '[:space:]')
case "$HV" in *"$V"*) echo "   ✓ hjaelperen siger $V" ;;
  *) echo "   ⛔ hjaelperen siger '$HV', ikke $V - koer scripts/build-release.sh"; bad=1 ;;
esac
[ $bad -eq 0 ] || { echo "⛔ stoppet: teksten og koden er ikke enige"; exit 1; }
echo "   koden udstiller $N vaerktoejer"

# NAER-FEJL 20/9: jeg var ved at koere udgivelsen med en DOED npm-token.
#    Trin 5 ville have lavet et offentligt tag og en GitHub-udgivelse for
#    v0.2.0, og trin 6 ville saa vaere fejlet paa 401. Et tag paa en version
#    der ikke findes paa npm, kan ikke tages paent tilbage.
#    Det billigste tjek i hele scriptet hoerer derfor FOER det foerste
#    uigenkaldelige skridt - ikke lige foer det det selv vogter.
echo "== 4b/7 npm-kontoen skal vaere logget ind =="
if ! ( cd mcp-server && npm whoami >/dev/null 2>&1 ); then
  echo "   STOP: npm siger 401 - ikke logget ind."
  echo "   Koer 'npm login' (hav din 2FA klar), og start forfra."
  echo "   Intet er maerket eller udgivet; alt herover var kun tjek."
  exit 1
fi
echo "   npm: $( cd mcp-server && npm whoami ) OK"

echo "== 5/7 maerk og skub FOER der udgives =="
# ⛔ Y3b. Foer stod npm publish foerst. Fejlede registret bagefter under `set -e`,
#    var pakken ude i verden mens git ikke engang havde et maerke - og en
#    udgivelse kan ikke kaldes tilbage. Nu er raekkefoelgen: alt det der kan
#    fortrydes, foerst.
npm whoami >/dev/null 2>&1 || { echo "⛔ npm-tokenen er ikke gyldig. Gustav skal lave en ny (2FA)."; exit 1; }
git tag -a "v$V" -m "v$V"
git push origin main --tags
gh release create "v$V" --title "v$V" --notes-file <(awk "/^## $V/{f=1;next}/^## /{f=0}f" CHANGELOG.md) 2>/dev/null \
  || echo "   (udgivelsen fandtes i forvejen)"

echo "== 6/7 npm =="
( cd mcp-server && npm publish --access public )

# ⛔ Foerst NU er forbeholdet usandt. `PUBLICERET` er den eneste kilde til hvad
#    npx faktisk serverer, og sync-tal.py fjerner forbeholdet overalt naar den
#    er lig med pakkens version. Uden denne linje ville sitet blive ved med at
#    sige "npx serves 0.1.0" efter en lykket udgivelse.
# Udgivelsen lykkedes - forbeholdet er nu retmaessigt vaek, og faelden skal
# ikke rulle noget tilbage.
trap - EXIT
TIDLIGERE_UDGIVET="$V"
echo "   PUBLICERET staar paa $V, og forbeholdet er fjernet fra alle flader."
echo "   ⛔ Husk at committe og skubbe de aendringer - ellers staar det gamle live."

echo "== 7/7 MCP-registret =="
mcp-publisher login github && mcp-publisher publish
# ⛔ Y4c. Repo-beskrivelsen er den streng hvert katalog hoester. Staar der et
#    vaerktoejstal, skal det aendres i SAMME oejeblik som pakken - ikke foer
#    (saa lyver den for npx-brugere) og ikke efter (saa lyver den for alle).
DESC=$(gh api repos/Agent360dk/computerMCP --jq .description 2>/dev/null)
case "$DESC" in
  *" $N tools"*) echo "   ✓ repo-beskrivelsen siger allerede $N" ;;
  *) echo "   ⚠️  repo-beskrivelsen siger ikke '$N tools' - ret den nu:"
     echo "      gh repo edit Agent360dk/computerMCP --description \"...$N tools...\"" ;;
esac

echo "✅ $V er ude fire steder. Tjek: npm view @agent360/computer-mcp version"
