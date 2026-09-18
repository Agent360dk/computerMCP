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
# ⛔ Denne vagt stod foerst som `grep -qi "$N"`. MAALT 18/9: den bestod paa
# "font-size:14px", "macOS 14 or later" og "macOS only (14+)" - altsaa paa alt,
# uden at kigge paa vaerktoejstallet én gang. En vagt der bygges mod dagens fejl
# og bestaar dagens fejl, er vaerre end ingen vagt: den goer én tryg.
# Nu kraeves tallet i en form der IKKE kan vaere et versionsnummer eller en CSS-vaerdi.
N=$(node -e "import('./mcp-server/tools.js').then(m=>console.log(m.TOOLS.length))")
WORDS="zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
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

echo "== 4/6 npm =="
npm whoami >/dev/null 2>&1 || { echo "⛔ npm-token er ikke gyldig. Gustav skal lave en ny (2FA)."; exit 1; }
( cd mcp-server && npm publish --access public )

echo "== 5/6 MCP-registret =="
mcp-publisher login github && mcp-publisher publish

echo "== 6/6 git =="
git tag -a "v$V" -m "v$V"
git push origin main --tags
echo "✅ $V er ude fire steder. Tjek: npm view @agent360/computer-mcp version"
