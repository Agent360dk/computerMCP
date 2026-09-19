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
#    Derfor: den stille suite koerer altid, og dialog-daekningen accepteres fra
#    en kvittering der navngiver praecis hvilke filer den beviste. Har en af de
#    fire filer flyttet sig siden, er kvitteringen ugyldig, og udgivelsen
#    stopper med den ene kommando der retter det.
./test/run-all.sh

KVIT=".dialog-kvittering"
# ⛔ FUNDET AF RAADGIVEREN 19/9: listen var for kort, og vagten bestod sin
#    EGEN omgaaelse. Hvert vaerktoejs niveau bor i `tools.js`, og porten
#    doemmer paa netop det niveau. Saet `computer_type` til READ dér, og
#    porten spoerger aldrig mere - mens fingeraftrykket staar uroert og
#    udgivelsen gaar igennem. `helper.js` afgoer hvad "det forreste program"
#    betyder, altsaa hvem porten doemmer imod. Begge er nu med.
PORT_FILER="mcp-server/policy.js mcp-server/index.js mcp-server/tools.js mcp-server/helper.js test/failclosed.mjs test/claims.mjs"
NU=$(cat $PORT_FILER 2>/dev/null | shasum -a 256 | cut -c1-16)
KVITTERET=$(cut -d' ' -f1 "$KVIT" 2>/dev/null)
if [ "$NU" != "$KVITTERET" ]; then
  echo "⛔ samtykke-porten er UBEVIST for denne kode."
  echo "   kvittering: ${KVITTERET:-ingen} · koden nu: $NU"
  echo "   Koer EN gang (viser ca. 8 dialoger i 2 sek hver) og udgiv derefter:"
  echo "     CMCP_DIALOGS=1 ./test/run-all.sh"
  exit 1
fi
echo "   samtykke-porten bevist $(cut -d' ' -f2 "$KVIT") for denne kode ✓"

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
