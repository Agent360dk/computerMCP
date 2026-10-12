#!/bin/bash
# Udgiver én version fire steder paa én gang: git, GitHub, npm, MCP-registret.
#
# Findes fordi de fire versionstal glider fra hinanden naar de saettes i haanden.
# 18/9 stod sitet paa fjorten vaerktoejer mens npm leverede tolv, fordi
# udgivelsen var blokeret paa en doed token og alt andet var gaaet videre.
#
# Brug: scripts/release.sh 0.2.1
set -euo pipefail
V="${1:?brug: release.sh <version> [--tjek]}"
# ⛔ «Klar til at trykke paa knappen» kan ikke bevises af et script der
#    UDGIVER naar man proever det. Med --tjek koeres alt det der kan maales
#    hjemmefra (tekst, binaer, proever, versioner, vaerktoejstal, npm-konto),
#    og saa stopper den FOER foerste skridt der forlader maskinen.
KUN_TJEK=0
[ "${2:-}" = "--tjek" ] && KUN_TJEK=1
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

# ⛔ 25/9 (Fable): ingen vagt mod et urent arbejdstrae. `git tag` maerker HEAD,
#    men `npm publish` pakker ARBEJDSTRAEET - og kvitteringen laeser filerne paa
#    disken. Samme klasse som «railway up uploader arbejdstraeet». Et rent trae
#    er den eneste maade hvorpaa maerke, pakke og kvittering er det samme.
if [ -n "$(git status --porcelain)" ]; then
  echo "⛔ arbejdstraeet er ikke rent - commit eller fjern foerst:"
  git status --short | sed 's/^/   /'
  exit 1
fi

# ⛔ OPUS (2/10): uden dette tjek kan lokal main staa paa en commit origin/main
#    IKKE har (fx en anden chats traee) - scriptet ville taenke HEAD'en v$V,
#    skubbe maerket offentligt paa en forkert commit, og saa faa SELVE
#    main-pushet nedenfor afvist af branch-beskyttelsen. Maerket ville alligevel
#    staa derude, forkert. Stop foer noget som helst skubbes.
git fetch origin main --quiet
HEAD_NU="$(git rev-parse HEAD)"
ORIGIN_MAIN="$(git rev-parse origin/main)"
if [ "$HEAD_NU" != "$ORIGIN_MAIN" ]; then
  echo "⛔ HEAD ($HEAD_NU) er ikke det samme som origin/main ($ORIGIN_MAIN)."
  echo "   Udgivelsen maerker og pakker HEAD - er den ikke identisk med origin/main,"
  echo "   maerkes/pakkes en commit GitHub ikke har endnu (eller en forkert én)."
  echo "   git checkout main && git pull - og koer saa scriptet igen."
  exit 1
fi

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
# ⛔ 7/10 (panel R8, E): en fejlet forespoergsel (net, GitHub-timeout) blev under
#    set -e enten et tavst stop eller laest som «CI har ikke koert». Den er UKENDT.
if ! CIDOM=$(gh run list -R Agent360dk/computerMCP -w CI --limit 20 \
          --json headSha,conclusion,status \
          -q "[.[] | select(.headSha==\"$HEADSHA\")] | .[0].conclusion" 2>/dev/null); then
  echo "⛔ CI-status kunne ikke laeses fra GitHub (net eller timeout) - den er UKENDT, ikke «ikke koert»."
  echo "   Intet er maerket eller udgivet. Proev igen om lidt."
  exit 1
fi
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
# 7/10 (panel R11, B5): Claude Code-pluginnet og markedet foelger PUBLICERET, ikke pakken -
#    paa main skal de pege paa en version npm HAR. Trin 0 satte PUBLICERET og koerte
#    sync-tal.py, saa her staar de lokalt paa $V; committet kommer i dok-PR'en efter publish.
for f in plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json; do
  grep -q "\"version\": \"$(cat PUBLICERET)\"" "$f" || { echo "⛔ $f foelger ikke PUBLICERET ($(cat PUBLICERET)) - koer python3 scripts/sync-tal.py"; exit 1; }
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
WORDS="zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven twenty-eight twenty-nine thirty thirty-one thirty-two thirty-three thirty-four thirty-five thirty-six thirty-seven thirty-eight thirty-nine forty"
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

echo "== 4c/7 maerket v$V maa ikke findes i forvejen =="
# ⛔ MAALT 24/9: `v0.2.0` FANDTES ALLEREDE - lokalt OG paa GitHub - og pegede paa
#    kode fra 20/9, 88 commits bagud. Trin 5 (`git tag -a`) ville fejle med
#    «already exists» EFTER toerkoerslens stoppunkt, saa `--tjek` sagde «alt
#    groent» om en udgivelse der ville braekke paa det foerste ja.
#    Og kommentaren ovenfor (naer-fejlen 20/9) advarede praecis mod at et maerke
#    ligger offentligt paa en version npm ikke har. Det er sket: npm serverer 0.1.0.
#    At flytte et offentligt maerke omskriver historik andre kan have hentet.
#    Det er et valg, ikke noget scriptet goer af sig selv.
LOKALT_TAG=$(git rev-parse -q --verify "refs/tags/v$V" 2>/dev/null || true)
# ⛔ 7/10 (panel R8, E): `|| true` gjorde en fejlet forespoergsel til «maerket er ledigt».
#    `--exit-code` giver 2 naar maerket ikke findes; alt andet end 0/2 er UKENDT.
set +e; FJERN_RAA=$(git ls-remote --exit-code --tags origin "refs/tags/v$V" 2>/dev/null); LSRC=$?; set -e
case $LSRC in
  0) FJERN_TAG=$(printf '%s\n' "$FJERN_RAA" | head -1 | cut -f1) ;;
  2) FJERN_TAG="" ;;
  *) echo "⛔ GitHub kunne ikke spoerges om maerket v$V (git ls-remote gav $LSRC) - UKENDT, ikke ledigt."
     echo "   Intet er maerket eller udgivet. Proev igen om lidt."
     exit 1 ;;
esac
if [ -n "$LOKALT_TAG" ] || [ -n "$FJERN_TAG" ]; then
  echo "   STOP: maerket v$V findes allerede${FJERN_TAG:+ - OGSAA paa GitHub}."
  echo "   Det peger paa $(git rev-list -n1 "v$V" 2>/dev/null | cut -c1-9), HEAD er $(git rev-parse --short HEAD) ($(git rev-list --count "v$V"..HEAD 2>/dev/null) commits imellem)."
  echo "   To veje, begge dit valg:"
  echo "     a) udgiv som en NY version (fx 0.2.1) og lad det offentlige maerke staa"
  echo "     b) flyt v$V til HEAD - det omskriver et offentligt maerke paa GitHub"
  echo "   Intet er maerket eller udgivet; alt herover var kun tjek."
  exit 1
fi
echo "   v$V er ledigt"

if [ "$KUN_TJEK" = "1" ]; then
  echo
  echo "== TJEK FAERDIGT =="
  echo "   Alt der kan maales hjemmefra er groent for v$V."
  echo "   Det der mangler, forlader maskinen og kraever et ja:"
  echo "     5/7  git tag + push til GitHub"
  echo "     6/7  npm publish (kraever Touch ID paa noeglen) + 0.1.0 markeres forældet"
  echo "     7/7  MCP-registret (aabner et GitHub-login i browseren)"
  echo "   Efter 6/7 committes og skubbes PUBLICERET og siderne automatisk."
  echo "   Koer uden --tjek naar du vil udgive."
  exit 0
fi

echo "== 5/7 maerk og skub FOER der udgives =="
# ⛔ Y3b. Foer stod npm publish foerst. Fejlede registret bagefter under `set -e`,
#    var pakken ude i verden mens git ikke engang havde et maerke - og en
#    udgivelse kan ikke kaldes tilbage. Nu er raekkefoelgen: alt det der kan
#    fortrydes, foerst.
npm whoami >/dev/null 2>&1 || { echo "⛔ npm-tokenen er ikke gyldig. Gustav skal lave en ny (2FA)."; exit 1; }
git tag -a "v$V" -m "v$V"
# ⛔ OPUS (2/10): "main" her var meningsløst OG farligt - HEAD er lige verificeret
#    identisk med origin/main ovenfor, saa der er intet nyt at skubbe til main;
#    og en protected branch afviser alligevel et direkte "push origin main".
#    Det eneste dette skridt reelt skal skubbe, er maerket.
git push origin "refs/tags/v$V"
# ⛔ 25/9 (Astra): her stod `... 2>/dev/null || echo "(fandtes i forvejen)"` - enhver
#    fejl (login, netvaerk, rettigheder) blev meldt som at udgivelsen fandtes.
if gh release view "v$V" >/dev/null 2>&1; then
  echo "   (GitHub-udgivelsen v$V fandtes i forvejen)"
else
  # ⛔ R24 (Opus): noterne tog kun `## $V`. 0.2.1 blev aldrig udgivet, saa den foerste
  #    udgivelse siden 0.1.0 manglede halvdelen. Nu: alt fra `## $V` ned til afsnittet for
  #    den sidst UDGIVNE version (PUBLICERET foer denne koersel) - eller kun `## $V`, hvis
  #    den ikke staar i CHANGELOG.
  NOTER_STOP="^## $TIDLIGERE_UDGIVET"; grep -q "^## $TIDLIGERE_UDGIVET" CHANGELOG.md || NOTER_STOP="^## "
  gh release create "v$V" --title "v$V" --notes-file <(awk -v start="^## $V" -v stop="$NOTER_STOP" '$0 ~ start {f=1; next} f && $0 ~ stop {f=0} f' CHANGELOG.md) \
    || { echo "⛔ GitHub-udgivelsen fejlede - npm er IKKE roert endnu"; exit 1; }
fi

echo "== 6/7 npm =="
( cd mcp-server && npm publish --access public )
# ⛔ 7/10 (panel R2+R8, E): faelden stod armeret gennem deprecate. Et afbrudt deprecate
#    (Ctrl-C mens browseren venter) rullede PUBLICERET tilbage og skrev «udgivelsen
#    skete ikke» - EFTER en lykket publish. Nu er den afvaebnet i samme sekund.
trap - EXIT
# ⛔ 25/9 (fyld-tjek): 0.1.0 har fejl-aaben sloering (maalt ved 9e251ce). Den der har
#    laast sig til den, skal have en advarsel - ikke bare dem der opgraderer selv.
# ⛔ 8/10 (panel R13-R14, fejl a): intervallet var «<$V». Ved 0.2.2 ville advarslen om et
#    usloeret skaermbillede ogsaa ramme 0.2.1 - den version der rettede fejlen. Fejlen
#    findes kun foer 0.2.1, saa intervallet er fast.
SAARBAR="<0.2.1"
DEPR_BESKED="Upgrade to $V: earlier versions could return an unredacted screenshot when redaction failed."
# 7/10: reservelinjen var ikke til at koere (ucitéret `<` er en omdirigering, og
#    beskeden stod som «...»). Nu skrives den ud ordret og citeret.
npm deprecate "@agent360/computer-mcp@$SAARBAR" "$DEPR_BESKED" \
  || { echo "   ⚠ npm deprecate fejlede - koer den i haanden, ordret:"
       printf "     npm deprecate '%s' '%s'\n" "@agent360/computer-mcp@$SAARBAR" "$DEPR_BESKED"; }

# ⛔ Foerst NU er forbeholdet usandt. `PUBLICERET` er den eneste kilde til hvad
#    npx faktisk serverer, og sync-tal.py fjerner forbeholdet overalt naar den
#    er lig med pakkens version. Uden denne linje ville sitet blive ved med at
#    sige "npx serves 0.1.0" efter en lykket udgivelse.
# Udgivelsen lykkedes - forbeholdet er nu retmaessigt vaek, og faelden er
# afvaebnet (lige efter publish, se ovenfor).
TIDLIGERE_UDGIVET="$V"
echo "   PUBLICERET staar paa $V, og forbeholdet er fjernet fra alle flader."
# ⛔ 25/9 (Fable): her stod «Husk at committe og skubbe». En paamindelse efter en
#    udgivelse bliver glemt, og saa siger sitet at npx serverer den gamle version.
#    Kun de filer sync-tal aendrede - traeet var rent foer vi startede.
AENDREDE=$(git status --porcelain | awk '{print $2}')
if [ -n "$AENDREDE" ]; then
  # ⛔ OPUS (2/10): "git push origin main" her blev altid afvist - main er
  #    protected (PR kraeves, enforce_admins=true). Faelden er allerede afvaebnet
  #    (npm ER udgivet), saa et set -e-stop her ville efterlade en uklar
  #    halvfaerdig tilstand. En gren + PR er det eneste der rent faktisk virker.
  GREN="release-$V-dok"
  git checkout -q -b "$GREN"
  git add $AENDREDE
  git commit -q -m "release: $V er udgivet - PUBLICERET og siderne foelger med"
  git push -q origin "$GREN"
  if PR_URL=$(gh pr create --base main --head "$GREN" \
      --title "release: $V er udgivet - forbeholdene vaek" \
      --body "npm og GitHub-udgivelsen for $V er allerede ude (irreversibelt). Denne PR synkroniserer kun PUBLICERET og de afledte sider - ingen ny funktionalitet." \
      2>&1); then
    echo "   ✓ PUBLICERET og siderne committet, skubbet til $GREN:"
    echo "     $PR_URL"
    echo "   Merge den PR for at faa teksten med paa main - npm-udgivelsen venter ikke paa den."
  else
    echo "⛔ PR-opret fejlede, men commit'en og grenen er skubbet og trygge:"
    echo "$PR_URL" | sed 's/^/   /'
    echo "   Aabn PR'en i haanden: gh pr create --base main --head $GREN"
  fi
  git checkout -q main
fi

echo "== 7/7 MCP-registret =="
# ⛔ ASTRA runde 2 (25/9): `login && publish` under set -e stoppede IKKE naar login
#    fejlede - set -e gaelder ikke inde i en &&-kaede - og scriptet meldte «ude
#    fire steder». Hvert skridt for sig, og en fejl er en fejl.
mcp-publisher login github || { echo "⛔ login til MCP-registret fejlede - npm ER udgivet, registret er IKKE"; exit 1; }
mcp-publisher publish || { echo "⛔ MCP-registret afviste udgivelsen - npm ER udgivet, registret er IKKE"; exit 1; }
# ⛔ Fjernet 2/10: et vaerktoejstal i repo-beskrivelsen blev bevidst fjernet
#    2/10, fordi tallet var forkert baade mod koden og mod npm. Dette script
#    genindsatte det ved hver udgivelse - en regression mod den beslutning.
#    Repo-beskrivelsen roeres ikke her laengere.

echo "✅ $V er ude fire steder. Tjek: npm view @agent360/computer-mcp version"
