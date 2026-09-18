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

echo "== 1/6 proever =="
./test/run-all.sh

echo "== 2/6 versionerne skal vaere ens =="
for f in mcp-server/package.json server.json; do
  grep -q "\"version\": \"$V\"" "$f" || { echo "⛔ $f staar ikke paa $V"; exit 1; }
done
grep -q "^## $V" CHANGELOG.md || { echo "⛔ CHANGELOG.md mangler afsnittet ## $V"; exit 1; }

echo "== 3/6 vaerktoejstallet skal matche koden =="
N=$(node -e "import('./mcp-server/tools.js').then(m=>console.log(m.TOOLS.length))")
for f in README.md docs/index.html docs/tools.html docs/llms.txt; do
  grep -qi "$N" "$f" || echo "⚠️  $f naevner ikke tallet $N - tjek den i haanden"
done
echo "   koden udstiller $N vaerktoejer"

echo "== 4/6 npm =="
npm whoami >/dev/null 2>&1 || { echo "⛔ npm-token er ikke gyldig. Gustav skal lave en ny (2FA)."; exit 1; }
( cd mcp-server && npm publish --access public )

echo "== 5/6 MCP-registret =="
mcp-publisher login github && mcp-publisher publish

echo "== 6/6 git =="
git tag -a "v$V" -m "v$V"
git push origin main --tags
echo "✅ $V er ude fire steder. Tjek: npm view @agent360/computer-mcp version"
