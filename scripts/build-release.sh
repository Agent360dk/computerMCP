#!/bin/bash
# Bygger den binaer der faktisk sendes ud.
#
# Forskellen fra `swift build` er tre ting, og alle tre betyder noget for
# en der installerer med npx og aldrig har set Xcode:
#   1. universal (arm64 + x86_64), saa den koerer paa baade Apple silicon og Intel
#   2. ad-hoc signeret, ellers spoerger macOS om lov foerste gang
#   3. lagt i mcp-server/vendor/, hvor serveren leder foer den falder tilbage
#      paa en lokalt bygget udgave
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/mcp-server/vendor"
SCRATCH="$ROOT/helper/.build/uni"

echo "1/5 bygger universal ..."
( cd "$ROOT/helper" && swift build -c release --arch arm64 --arch x86_64 --scratch-path .build/uni >/dev/null )
BIN="$SCRATCH/apple/Products/Release/cmcp-helper"
[ -f "$BIN" ] || { echo "FEJL: byggede ingen binaer"; exit 1; }

echo "2/5 signerer ad-hoc ..."
# `-s -` er ad-hoc: ingen udvikler-konto kraeves, og macOS holder op med at
# spoerge om lov ved foerste koersel. Det er IKKE en notarisering og skal
# ikke praesenteres som en.
codesign --force --sign - --timestamp=none "$BIN"
codesign --verify --verbose=1 "$BIN" 2>&1 | tail -1

echo "3/5 laegger den i pakken ..."
mkdir -p "$OUT"
cp "$BIN" "$OUT/cmcp-helper"
chmod +x "$OUT/cmcp-helper"

echo "3b/5 menulinje-ikonet som .app ..."
# Et ikon skal vaere et rigtigt program med et bundle-id: saa bliver det vist
# med sit eget navn, og LSUIElement holder det ude af Dock og Cmd-Tab.
SBIN="$SCRATCH/apple/Products/Release/cmcp-status"
[ -f "$SBIN" ] || { echo "FEJL: byggede intet ikon"; exit 1; }
APP="$OUT/ComputerMCPStatus.app"
mkdir -p "$APP/Contents/MacOS"
cp "$SBIN" "$APP/Contents/MacOS/cmcp-status"
VERSION=$(node -p "require('$ROOT/mcp-server/package.json').version")
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dk.agent360.computer-mcp.status</string>
  <key>CFBundleName</key><string>Computer MCP</string>
  <key>CFBundleExecutable</key><string>cmcp-status</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
</dict></plist>
PLIST
codesign --force --sign - --timestamp=none "$APP"
codesign --verify --verbose=1 "$APP" 2>&1 | tail -1

echo "4/5 efterproever ..."
ARCHS=$(lipo -archs "$OUT/cmcp-helper")
VER=$("$OUT/cmcp-helper" version)
SIZE=$(ls -lh "$OUT/cmcp-helper" | awk '{print $5}')
echo "   arkitekturer: $ARCHS"
echo "   svar:         $VER"
echo "   stoerrelse:   $SIZE"
case "$ARCHS" in
  *arm64*x86_64*|*x86_64*arm64*) echo "OK - klar til udgivelse";;
  *) echo "FEJL: ikke universal"; exit 1;;
esac

echo "5/5 npm-README udledes af repoets ..."
# ⛔ MAALT 19/9: der er TO README'er - denne og repoets - og npm viser DENNE.
#    Den var 79 linjer bagud og naevnte hverken skaerme eller menuer, mens
#    repoets var current. To filer der skal sige det samme, driver fra hinanden
#    hver gang nogen retter den ene. Saa den ene udledes nu af den anden.
#
#    EEN ting fjernes undervejs: billedet oeverst, fordi stien `docs/...` ikke
#    findes i npm-pakken. Og henvisninger til docs/ omskrives til absolutte
#    GitHub-adresser af samme grund. Alt andet foelger med - ogsaa afsnittet om
#    at bygge fra kilden, som er nyttigt for den der vil laese koden.
python3 - "$ROOT" <<'PYEOF'
import io, re, sys
rod = sys.argv[1]
s = io.open(rod + '/README.md', encoding='utf-8').read()
s = re.sub(r'<img src="docs/[^>]*>\n\n', '', s, count=1)
s = s.replace('](docs/', '](https://github.com/Agent360dk/computerMCP/blob/main/docs/')
io.open(rod + '/mcp-server/README.md', 'w', encoding='utf-8').write(s)
print('   npm-README: %d linjer, udledt af repoets' % s.count(chr(10)))
PYEOF
