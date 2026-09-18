#!/usr/bin/env python3
"""Bevis for sloeringen, uafhaengigt af hvad der staar paa skaermen.

Findes fordi den foerste udgave af proeven maalte den levende skaerm. Stod
udvikleren i fuldskaerm, kunne proeve-vinduet slet ikke komme frem, og proeven
maalte et tomt billede og kaldte det bestaaet. En sikkerhedsproeve der bestaar
naar den ikke kan se noget, er vaerre end ingen proeve.

Fire tjek, og de tre sidste er dem der giver det foerste vaerdi:
  1. omraadet der skal sloeres, ER sort
  2. omraadet udenom er UROERT           -> "mal alt sort" dumper
  3. sloerer man et ANDET sted, er feltet stadig roedt -> "mal altid" dumper
  4. et felt i TOPPEN sloeres i toppen    -> et ombyttet y-akse-fortegn dumper
"""
import subprocess, sys, os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Samme binaer som serveren vaelger, ikke en anden.
# MAALT 18/9: proeverne pegede paa .build/release mens serveren og npm-pakken
# bruger vendor/. Den medsendte binaer manglede en rettelse kilden havde, og
# ingen proeve kunne se det, fordi ingen proeve roerte den.
HELPER = next((p for p in [
    os.environ.get("CMCP_HELPER"),
    os.path.join(ROOT, "mcp-server/vendor/cmcp-helper"),
    os.path.join(ROOT, "helper/.build/release/cmcp-helper"),
] if p and os.path.exists(p)), os.path.join(ROOT, "helper/.build/release/cmcp-helper"))
TMP = os.environ.get("TMPDIR", "/tmp").rstrip("/") + "/cmcp-unit"
os.makedirs(TMP, exist_ok=True)

W, H = 800, 600
TOP = (100, 60, 300, 80)      # x, y, w, h - bevidst i OEVERSTE halvdel
BOTTOM = (100, 460, 300, 80)  # spejlingen af det, i nederste halvdel

def build():
    img = Image.new("RGB", (W, H), (255, 255, 255))
    for (x, y, w, h), col in ((TOP, (255, 0, 0)), (BOTTOM, (0, 0, 255))):
        for px in range(x, x + w):
            for py in range(y, y + h):
                img.putpixel((px, py), col)
    p = f"{TMP}/src.png"
    img.save(p)
    return p

def redact(src, out, rects):
    spec = ";".join(",".join(str(v) for v in r) for r in rects)
    r = subprocess.run([HELPER, "redact", "--in", src, "--out", out, "--rects", spec],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("  hjaelperen fejlede:", r.stdout.strip(), r.stderr.strip())
        return False
    return True

def centre(img, rect):
    x, y, w, h = rect
    return img.getpixel((x + w // 2, y + h // 2))

def black(px): return sum(px) <= 30

fails = []
src = build()
orig = Image.open(src).convert("RGB")
assert centre(orig, TOP) == (255, 0, 0), "fixturen selv er forkert"

# --- 1 + 2 + 4: sloer OEVERSTE felt ---
out1 = f"{TMP}/top.png"
if not redact(src, out1, [TOP]):
    fails.append("kunne ikke koere sloeringen")
else:
    im = Image.open(out1).convert("RGB")
    t = centre(im, TOP); b = centre(im, BOTTOM)
    white = im.getpixel((W - 20, 20))
    print(f"1. det sloerede felt (top):      {t}  -> {'sort OK' if black(t) else 'IKKE SORT'}")
    print(f"2. uroert baggrund:              {white} -> {'hvid OK' if white == (255,255,255) else 'AENDRET'}")
    print(f"4. spejl-feltet i bunden:        {b}  -> {'uroert OK' if not black(b) else 'OGSAA SORT (y-akse vendt forkert)'}")
    if not black(t): fails.append("1: feltet blev ikke sloeret")
    if white != (255, 255, 255): fails.append("2: baggrunden blev aendret")
    if black(b): fails.append("4: bundfeltet blev ogsaa sort - y-aksen er vendt forkert")

# --- 3: mutationsbevis - sloer et TREDJE sted, feltet skal overleve ---
out2 = f"{TMP}/elsewhere.png"
if redact(src, out2, [(600, 300, 120, 60)]):
    im2 = Image.open(out2).convert("RGB")
    t2 = centre(im2, TOP)
    other = im2.getpixel((660, 330))
    print(f"3. feltet naar vi sloerer ANDETSTEDS: {t2} -> {'roedt OK' if t2 == (255,0,0) else 'SORT - sloerer uanset hvad'}")
    print(f"   og det anviste sted:               {other} -> {'sort OK' if black(other) else 'IKKE SORT'}")
    if t2 != (255, 0, 0): fails.append("3: sloerer uanset hvilke rektangler den faar")
    if not black(other): fails.append("3: sloerede ikke det anviste sted")
else:
    fails.append("3: kunne ikke koere")

print()
if fails:
    for f in fails: print("DUMPET:", f)
    sys.exit(1)
print("BESTAAET - alle fire tjek")
