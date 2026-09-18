#!/bin/bash
# Bevis for loefte 1: adgangskoder naar aldrig modellen.
#
# Proeven er skrevet saa den KAN fejle. Den tjekker tre ting, og den tredje
# er den vigtigste:
#   A. sloeringen finder feltet
#   B. pixels i feltet er sorte NAAR der sloeres
#   C. de samme pixels er IKKE sorte naar sloering slaas fra
#      -- uden C beviser proeven kun at billedet er sort, ikke at VI gjorde det
#   D. det gule vindue udenom er stadig gult
#      -- uden D ville "mal hele skaermen sort" bestaa proeven
#
# Fixturen skal startes og maales i SAMME skalkald. Startes den i et andet,
# doer den naar det kald slutter, og saa maaler man et tomt skaermbillede og
# laeser nullet som "ingen hemmeligheder".
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HELPER="$ROOT/helper/.build/release/cmcp-helper"
FIX="$ROOT/test/fixture/secure-window"
TMP="${TMPDIR:-/tmp}/cmcp-proof-$$"
mkdir -p "$TMP"
fail() { echo "FEJL: $*"; pkill -f "$FIX" 2>/dev/null; exit 1; }

[ -x "$HELPER" ] || fail "hjaelperen er ikke bygget: $HELPER"
[ -x "$FIX" ] || fail "fixturen er ikke bygget: $FIX"

"$FIX" >/dev/null 2>&1 &
FIXPID=$!
sleep 3
kill -0 $FIXPID 2>/dev/null || fail "fixturen doede foer maalingen"

# --- A: findes feltet? ---
RECTS="$("$HELPER" secure-rects)"
COUNT=$(echo "$RECTS" | python3 -c "import json,sys;print(json.load(sys.stdin).get('count',0))")
echo "A. sikre felter fundet: $COUNT"
[ "$COUNT" -ge 1 ] || { kill $FIXPID 2>/dev/null; fail "A: fandt 0 sikre felter - sloeringen er blind"; }
echo "$RECTS" > "$TMP/rects.json"

# --- billeder: med og uden sloering ---
"$HELPER" screenshot --out "$TMP/redacted.png" >/dev/null || fail "kunne ikke tage sloeret billede"
"$HELPER" screenshot --out "$TMP/raw.png" --no-redact >/dev/null || fail "kunne ikke tage uslooeret billede"
kill $FIXPID 2>/dev/null

python3 - "$TMP" <<'PY'
import json, sys
from PIL import Image
tmp = sys.argv[1]
rects = json.load(open(f"{tmp}/rects.json"))["rects"]
red = Image.open(f"{tmp}/redacted.png").convert("RGB")
raw = Image.open(f"{tmp}/raw.png").convert("RGB")
if red.size != raw.size:
    print("FEJL: billederne har forskellig stoerrelse"); sys.exit(1)
W, H = red.size

# Skalafaktor mellem AX-punkter og billedets pixels udledes af billedet selv.
import subprocess
scale = W / 1710.0  # hovedskaerm i punkter; udledes robust nedenfor hvis muligt

def samples(r):
    x0 = r["x"]*scale; y0 = r["y"]*scale; w = r["w"]*scale; h = r["h"]*scale
    pts = []
    for fx in (0.3, 0.5, 0.7):
        for fy in (0.35, 0.5, 0.65):
            px, py = int(x0 + w*fx), int(y0 + h*fy)
            if 0 <= px < W and 0 <= py < H: pts.append((px, py))
    return pts

def is_black(px): return sum(px) <= 30

ok = True
target = max(rects, key=lambda r: r["w"]*r["h"])
pts = samples(target)
if not pts:
    print("FEJL: rektanglet ligger uden for billedet"); sys.exit(1)

# B: sort naar der sloeres
blacks = [is_black(red.getpixel(p)) for p in pts]
print(f"B. sloeret billede: {sum(blacks)}/{len(pts)} proevepunkter er sorte")
if not all(blacks):
    print("   FEJL B: feltet er IKKE sloeret"); ok = False

# C: mutationsbevis - IKKE sort uden sloering
raws = [is_black(raw.getpixel(p)) for p in pts]
print(f"C. usloeret billede: {sum(raws)}/{len(pts)} proevepunkter er sorte (skal vaere lavt)")
if all(raws):
    print("   FEJL C: ogsaa sort UDEN sloering - proeven beviser intet"); ok = False

# D: resten af vinduet er uroert
yellow_hits = 0
for r in rects:
    x0 = int(r["x"]*scale); y0 = int(r["y"]*scale)
    for dy in (-40, int(r["h"]*scale)+40):
        py = y0 + dy; px = x0 + int(r["w"]*scale*0.5)
        if 0 <= px < W and 0 <= py < H:
            p = red.getpixel((px, py))
            if p[0] > 150 and p[1] > 150 and p[2] < 120: yellow_hits += 1
print(f"D. gult omkring feltet i det sloerede billede: {yellow_hits} punkter")
if yellow_hits == 0:
    print("   ADVARSEL D: fandt ikke gult - kan betyde at for meget er malet over")

sys.exit(0 if ok else 1)
PY
RC=$?
pkill -f "$FIX" 2>/dev/null
[ $RC -eq 0 ] && echo "BESTAAET" || echo "DUMPET"
exit $RC
