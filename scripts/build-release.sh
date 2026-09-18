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

echo "1/4 bygger universal ..."
( cd "$ROOT/helper" && swift build -c release --arch arm64 --arch x86_64 --scratch-path .build/uni >/dev/null )
BIN="$SCRATCH/apple/Products/Release/cmcp-helper"
[ -f "$BIN" ] || { echo "FEJL: byggede ingen binaer"; exit 1; }

echo "2/4 signerer ad-hoc ..."
# `-s -` er ad-hoc: ingen udvikler-konto kraeves, og macOS holder op med at
# spoerge om lov ved foerste koersel. Det er IKKE en notarisering og skal
# ikke praesenteres som en.
codesign --force --sign - --timestamp=none "$BIN"
codesign --verify --verbose=1 "$BIN" 2>&1 | tail -1

echo "3/4 laegger den i pakken ..."
mkdir -p "$OUT"
cp "$BIN" "$OUT/cmcp-helper"
chmod +x "$OUT/cmcp-helper"

echo "4/4 efterproever ..."
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
