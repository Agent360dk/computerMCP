#!/usr/bin/env bash
# Alt der venter paa at npm serverer den nye version (fra package.json), i én kommando.
#
# Findes fordi rækkefølgen er bindende: registret validerer mod npm, og
# forbeholdene paa sitet er formuleret som «npm serverer stadig 0.1.0».
# Sendes de i forkert orden, staar der et forkert tal i kataloger der cacher.
#
# Kør:  bash tools/faerdiggoer-udgivelsen.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

sig() { printf '\n\033[1m%s\033[0m\n' "$*"; }
faldt=0

sig "0 · er npm fremme?"
VENTET="$(node -p "require('./mcp-server/package.json').version")"
PAA_NPM="$(npm view @agent360/computer-mcp version 2>/dev/null || echo 'intet svar')"
echo "   kilden: $VENTET   npm: $PAA_NPM"
if [ "$PAA_NPM" != "$VENTET" ]; then
  echo "   STOP: npm serverer ikke $VENTET endnu. Intet herunder koeres."
  echo
  echo "   Udgiv med:  ./scripts/release.sh $VENTET"
  echo
  echo "   ⛔ IKKE med en bar \`npm publish\`. Den springer build-release.sh over,"
  echo "      som genskriver mcp-server/README.md fra rodens README. Uden det"
  echo "      sender npm en pakkeside der mangler afsnit rodens README har - og"
  echo "      en udgivet version kan ikke rettes bagefter. MAALT 21/9: privatlivs-"
  echo "      afsnittet manglede praecis der."
  exit 1
fi

sig "1 · MCP-registret"
# ⛔ ASTRA (2/10): login og publish skal vaere to skridt, ikke et &&-kaedet -
#    samme fejlklasse som release.sh allerede retter (set -e gaelder ikke i en &&-kaede).
if command -v mcp-publisher >/dev/null 2>&1; then
  mcp-publisher login github || { echo "   login til registret fejlede"; faldt=1; }
  mcp-publisher publish || { echo "   registret afviste - se ovenfor"; faldt=1; }
else
  echo "   mcp-publisher findes ikke lokalt; henter den engangs"
  npx -y @modelcontextprotocol/publisher login github || { echo "   login til registret fejlede"; faldt=1; }
  npx -y @modelcontextprotocol/publisher publish || { echo "   registret afviste"; faldt=1; }
fi
echo -n "   registret siger for VORES server ($VENTET ventet): "
# ⛔ ASTRA (2/10): søgningen kan matche en FREMMED server ved navn-overlap -
#    maalt med et syntetisk svar der gav en anden servers 9.9.9. Kraev praecis
#    navn, og sammenlign med den version vi faktisk lige udgav.
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=computer-mcp" \
  | python3 -c "
import json, sys
NAVN = 'io.github.Agent360dk/computer-mcp'
VENTET = '$VENTET'
d = json.load(sys.stdin)
fundet = [e for e in d.get('servers', [])
          if e.get('server', {}).get('name') == NAVN
          and e.get('_meta', {}).get('io.modelcontextprotocol.registry/official', {}).get('isLatest')]
if not fundet:
    print('(ikke fundet under det praecise navn)'); sys.exit(1)
v = fundet[0]['server']['version']
print(v)
sys.exit(0 if v == VENTET else 1)
" || faldt=1

sig "2 · forbeholdene sletter sig selv"
echo "$VENTET" > PUBLICERET
python3 scripts/sync-tal.py
echo "   filer der stadig naevner 0.1.0:"
grep -rl "0\.1\.0" README.md docs/*.html 2>/dev/null | sed 's/^/     /' || echo "     ingen"

sig "3 · er teksten selv-konsistent efter sletningen?"
python3 scripts/sync-tal.py >/dev/null   # to gange = skal give nul aendring
if [ -n "$(git diff --name-only -- README.md docs/ PUBLICERET)" ]; then
  echo "   aendret (forventet):"; git diff --stat -- README.md docs/ PUBLICERET | sed 's/^/     /'
fi

sig "4 · beviskortet"
bash tools/bevis.sh || faldt=1

sig "5 · i hus"
git add PUBLICERET README.md docs/ server.json 2>/dev/null || true
git status --short | sed 's/^/   /'
echo
# ⛔ OPUS (2/10): main er laast (PR kraeves, enforce_admins=true) - en direkte
#    "git push origin main" afvises altid, ogsaa for en administrator.
if [ -n "$(git status --porcelain -- PUBLICERET README.md docs/ server.json 2>/dev/null)" ]; then
  GREN="udgivelse-$VENTET-dok"
  echo "   Naeste skridt er i haanden, med vilje (main er laast - en direkte push bliver afvist):"
  echo "     git checkout -b $GREN"
  echo "     git commit -F - <<'M'"
  echo "     udgivet: $VENTET staar paa npm, forbeholdene er vaek"
  echo "     M"
  echo "     git push origin $GREN"
  echo "     gh pr create --base main --head $GREN --title \"udgivet: $VENTET - forbeholdene vaek\" --body \"npm og registret bekraeftet paa $VENTET; PUBLICERET og de afledte sider er synkroniseret af sync-tal.py.\""
else
  echo "   intet at committe - PUBLICERET og siderne stod allerede rigtigt."
fi

[ "$faldt" -eq 0 ] && sig "ALT GROENT" || { sig "NOGET FALDT - se ovenfor"; exit 1; }
