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
# ⛔ 7/10 (panel R8, E): et fejlet login fortsatte til publish (`faldt=1` og videre).
#    Nu: viser registret allerede versionen, sker intet; ellers login, og fejler det,
#    STOP - ingen publish efter et fejlet login.
registret() {
  curl -sf "https://registry.modelcontextprotocol.io/v0/servers?search=computer-mcp" \
    | python3 -c "
import json, sys
NAVN = 'io.github.Agent360dk/computer-mcp'
d = json.load(sys.stdin)
f = [e for e in d.get('servers', []) if e.get('server', {}).get('name') == NAVN
     and e.get('_meta', {}).get('io.modelcontextprotocol.registry/official', {}).get('isLatest')]
print(f[0]['server']['version'] if f else 'IKKE FUNDET')"
}
FOER="$(registret || echo 'intet svar')"
echo "   registret: $FOER (ventet $VENTET)"
if [ "$FOER" != "$VENTET" ]; then
  PUB=mcp-publisher; command -v mcp-publisher >/dev/null 2>&1 || PUB="npx -y @modelcontextprotocol/publisher"
  $PUB login github || { echo "⛔ login til registret fejlede - intet er sendt til registret. Koer scriptet igen."; exit 1; }
  $PUB publish || { echo "⛔ registret afviste udgivelsen - se ovenfor. Koer scriptet igen."; exit 1; }
  EFTER="$(registret || echo 'intet svar')"
  echo "   registret nu: $EFTER"
  [ "$EFTER" = "$VENTET" ] || { echo "⛔ registret viser ikke $VENTET endnu (svar: $EFTER) - maal igen om lidt"; faldt=1; }
fi

sig "2 · dokumentations-PR'en (forbeholdene vaek)"
# ⛔ 7/10 (panel R2-R8, E): her stod en kildeaendrende beviskoersel (tools/bevis.sh
#    aendrer midlertidigt mcp-server/audit.js), en git add uden npm-README'en og en
#    gren med et andet navn end release.sh's. Nu én faelles logik for PR'en:
#    tools/dok-pr.sh finder tilstanden (PR findes, gren findes, ingen gren) og laver
#    kun det der mangler. Beviskortet koeres for sig: bash tools/bevis.sh.
bash tools/dok-pr.sh || faldt=1

echo
if [ $faldt -eq 0 ]; then
  echo "✅ npm, registret og dokumentations-PR'en staar paa $VENTET."
else
  echo "⛔ noget fejlede ovenfor - intet er gaaet tabt; koer scriptet igen."
  exit 1
fi
