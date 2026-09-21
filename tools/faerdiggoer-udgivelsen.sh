#!/usr/bin/env bash
# Alt der venter paa at npm serverer 0.2.0, i én kommando.
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
if command -v mcp-publisher >/dev/null 2>&1; then
  mcp-publisher publish || { echo "   registret afviste - se ovenfor"; faldt=1; }
else
  echo "   mcp-publisher findes ikke lokalt; henter den engangs"
  npx -y @modelcontextprotocol/publisher publish || { echo "   registret afviste"; faldt=1; }
fi
echo -n "   registret siger nu: "
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=computer-mcp" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(next((e['server']['version'] for e in d.get('servers',[]) if e.get('_meta',{}).get('io.modelcontextprotocol.registry/official',{}).get('isLatest')),'(ikke fundet)'))"

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
echo "   Naeste skridt er i haanden, med vilje:"
echo "     git commit -F - <<'M'"
echo "     udgivet: $VENTET staar paa npm, forbeholdene er vaek"
echo "     M"
echo "     git push origin main"

[ "$faldt" -eq 0 ] && sig "ALT GROENT" || { sig "NOGET FALDT - se ovenfor"; exit 1; }
