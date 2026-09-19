#!/bin/bash
# Bevis for loefte 1 paa et RIGTIGT felt, med den binaer vi faktisk udsender.
#
# `redaction-proof.sh` maaler en fixtur med den lokalt byggede binaer. Den er
# god, men beviser to ting vi ikke saelger: at vores egen testapp kan sloeres,
# og at koden i .build virker. Brugeren installerer `vendor/`-binaeren og
# aabner et RIGTIGT program.
#
# Web-feltet er det svaere tilfaelde: et kodeordsfelt i en side baerer rollen
# AXTextField med UNDERROLLEN AXSecureTextField. En kontrol der kun ser paa
# rollen, fanger alle native felter og slipper hver eneste browser igennem.
#
# ⛔ Skalaen udledes af optagelsen selv. `redaction-proof.sh` hardkoder
#    `W / 1710.0`; paa en 1920-punkts skaerm sampler den forkerte pixels.
#
# ⛔ MAALT 19/9: `screenshot --app <bundleId>` FEJLER for fire af fem programmer
#    (Chrome, Finder, Preview, wispr-flow) med en ScreenCaptureKit-streamingfejl,
#    i samme sekund som fuldskaerms-optagelse virker. Det lykkedes kun for ét
#    program, og at aktivere det fejlende program foerst hjalp ikke. Rodaarsagen
#    er ikke fundet. Derfor optager proeven hele skaermen.
#
#    Det usloerede kontrolbillede indeholder dermed kortvarigt hele skrivebordet.
#    Det er en bevidst afvejning: UDEN C beviser proeven kun at billedet er sort,
#    ikke at VI gjorde det sort. Filen ligger i TMPDIR, forlader aldrig maskinen,
#    og slettes af `trap` uanset udfald.
# ⛔ STATUS 19/9: proeven har BEVIST loeftet én gang paa et rigtigt felt -
#    A: 1 sikkert felt i en rigtig browser · B: 9/9 proevepunkter sorte med
#    sloering · C: 0/9 sorte uden. C er beviset for at VI gjorde det sort.
#
#    Men den er endnu IKKE paalidelig nok til `run-all.sh`. Den springer ofte
#    over fordi siden ikke er fremme i det sekund der maales. Den springer over
#    frem for at bestaa - saa den kan ikke give et falsk groent - men en proeve
#    der springer over otte ud af ti gange, beviser lige saa lidt som ingen.
#
#    Naeste skridt: find ud af hvorfor `open -a` + `activate` ikke altid giver
#    et synligt kodeordsfelt. Indtil da koeres den i haanden, ikke i suiten.
set -uo pipefail

# ⛔ DEN AABNER ET VINDUE OG STJAELER FOKUS. Derfor koerer den ikke uden at
#    nogen har bedt om det. MAALT 19/9: gentagne koersler efterlod en stak
#    faner i Gustavs Chrome, og fordi proevesiden ligger i en temp-mappe der
#    slettes bagefter, blev hver fane til en HVID fejlside. Dertil hentede
#    `activate` Chrome frem midt i hans arbejde.
#
#    En proeve der afbryder mennesket, maa kraeve et eksplicit ja. Saet
#    CMCP_LIVE=1 for at koere den.
if [ "${CMCP_LIVE:-}" != "1" ]; then
  echo "SPR. redaction-live aabner et vindue og tager fokus - koer med CMCP_LIVE=1 (bevist intet)"
  exit 0
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HELPER="${CMCP_HELPER:-$ROOT/mcp-server/vendor/cmcp-helper}"
APP="${CMCP_LIVE_APP:-com.google.Chrome}"
TMP="${TMPDIR:-/tmp}/cmcp-live-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "DUMP: $*"; exit 1; }

[ -x "$HELPER" ] || fail "den udsendte hjaelper findes ikke: $HELPER"

# Proeven rejser sin EGEN side. Afhaenger den af at en operatoer har den rigtige
# fane fremme i det rigtige sekund, maaler den skrivebordets tilfaeldigheder -
# og springer over otte ud af ti gange, hvilket er det samme som ikke at findes.
#
# Siden er gul med vilje: D sammenligner de to optagelser udenfor feltet, og en
# stor ensfarvet flade goer en utilsigtet overmaling synlig med det samme.
cat > "$TMP/pw.html" <<'HTML'
<!doctype html><meta charset=utf-8><title>cmcp bevis</title>
<body style="margin:0;background:#FFD400;font:16px -apple-system;padding:80px">
<h2 style="margin:0 0 20px">Proeve-felt (ingen rigtig konto)</h2>
<label>Adgangskode<br><input id=pw type=password value="DETTE-MAA-ALDRIG-SES-9f3a"
 style="font-size:38px;padding:18px;width:680px;letter-spacing:3px"></label>
HTML
open -a "${CMCP_LIVE_BROWSER:-Google Chrome}" "$TMP/pw.html" 2>/dev/null
sleep "${CMCP_LIVE_WAIT:-4}"

# ⛔ Browseren skal vaere FORREST naar der optages. MAALT 19/9: laa den bag
#    editoren, viste pixels inden for dens vinduesramme editorens indhold - og
#    editoren opdaterede sig selv mellem de to optagelser. D dumpede da paa
#    noget der slet ikke var browserens.
"$HELPER" activate --app "$APP" >/dev/null 2>&1
sleep 2
FRONT=$("$HELPER" apps 2>/dev/null | python3 -c "import json,sys;print(next((a['bundleId'] for a in json.load(sys.stdin).get('apps',[]) if a.get('active')), ''))" 2>/dev/null)
if [ "$FRONT" != "$APP" ]; then
  echo "SPR. kunne ikke faa $APP forrest (forrest er '$FRONT') - maalingen ville vaere af et andet program (bevist intet)"
  exit 0
fi

# Vinduets rammer: alt uden for browseren er stoej vi ikke kan styre.
"$HELPER" windows --app "$APP" > "$TMP/win.json" 2>/dev/null

RECTS="$("$HELPER" secure-rects 2>/dev/null)"
COUNT=$(echo "$RECTS" | python3 -c "import json,sys;print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo 0)
if [ "$COUNT" -lt 1 ]; then
  echo "SPR. intet sikkert felt paa skaermen - aabn en side med et kodeordsfelt i $APP (bevist intet)"
  exit 0
fi
echo "A. sikre felter fundet: $COUNT"
echo "$RECTS" > "$TMP/rects.json"

# Taettest muligt paa hinanden: skaermen lever, og hvert sekund imellem er stoej.
"$HELPER" screenshot --out "$TMP/raw.png" --no-redact > "$TMP/raw.json" || fail "usloeret optagelse fejlede"
"$HELPER" screenshot --out "$TMP/red.png"            > "$TMP/red.json"  || fail "sloeret optagelse fejlede"

python3 - "$TMP" <<'PY'
import json, sys, random
from PIL import Image
tmp = sys.argv[1]
rects = json.load(open(f"{tmp}/rects.json"))["rects"]
meta  = json.load(open(f"{tmp}/red.json"))
red = Image.open(f"{tmp}/red.png").convert("RGB")
raw = Image.open(f"{tmp}/raw.png").convert("RGB")
if red.size != raw.size:
    print("DUMP: billederne har forskellig stoerrelse"); sys.exit(1)
W, H = red.size
scale = meta.get("pixelsPerPoint") or (W / max(1, meta.get("screenWidthPoints", W)))
print(f"   skala udledt af optagelsen: {scale} pixel pr. punkt  ({W}x{H} px)")

def samples(r):
    x0, y0, w, h = r["x"]*scale, r["y"]*scale, r["w"]*scale, r["h"]*scale
    return [(int(x0+w*fx), int(y0+h*fy))
            for fx in (0.3,0.5,0.7) for fy in (0.35,0.5,0.65)
            if 0 <= int(x0+w*fx) < W and 0 <= int(y0+h*fy) < H]

is_black = lambda p: sum(p) <= 30
ok = True
target = max(rects, key=lambda r: r["w"]*r["h"])
pts = samples(target)
if not pts:
    print("DUMP: rektanglet ligger uden for optagelsen"); sys.exit(1)

blacks = [is_black(red.getpixel(p)) for p in pts]
raws   = [is_black(raw.getpixel(p)) for p in pts]

# ⛔ MAALT 19/9: foerst samplede jeg HELE skaermen udenfor feltet, og D sagde
#    konstant 78 %. Diff-billedet viste hvorfor: den oeverste venstre fjerdedel
#    er editoren, og MIN EGEN tekst rullede i den mens jeg maalte. D havde ret -
#    skaermen aendrede sig - men spoergsmaalet «maler vi bredere end feltet?»
#    hoerer hjemme INDEN FOR det vindue vi ser paa. Alt andet er stoej vi ikke
#    kan styre, og en proeve der kraever et helt stille skrivebord, koerer aldrig.
try:
    wins = json.load(open(f"{tmp}/win.json")).get("windows") or []
except Exception:
    wins = []
frames = [w.get("frame") for w in wins if isinstance(w.get("frame"), dict)]
box = max(frames, key=lambda f: f.get("w",0)*f.get("h",0)) if frames else None
if box:
    X0, Y0 = int(box["x"]*scale), int(box["y"]*scale)
    X1, Y1 = int((box["x"]+box["w"])*scale), int((box["y"]+box["h"])*scale)
    print(f"   sammenligner inden for vinduet: {box['w']}x{box['h']} punkter")
else:
    X0, Y0, X1, Y1 = 0, 0, W, H
    print("   (intet vindue oplyst - sammenligner hele billedet)")
X0, Y0 = max(0,X0), max(0,Y0); X1, Y1 = min(W,X1), min(H,Y1)

random.seed(7); out = []
guard = 0
while len(out) < 400 and guard < 40000:
    guard += 1
    px, py = random.randrange(X0, max(X0+1,X1)), random.randrange(Y0, max(Y0+1,Y1))
    if any(r["x"]*scale <= px <= (r["x"]+r["w"])*scale and
           r["y"]*scale <= py <= (r["y"]+r["h"])*scale for r in rects): continue
    out.append((px, py))
# ⛔ FOERSTE UDGAVE AF D VAR FORKERT, og den dumpede paa et mørkt skrivebord:
#    den taalte "hvor mange punkter udenfor er naesten sorte" - og paa en Mac med
#    moerkt tema er det de fleste. Den maalte brugerens tema, ikke vores kode.
#    Det D skal fange, er om vi maler for bredt. Det er en FORSKEL mellem de to
#    billeder, ikke en farve i det ene.
# ⛔ D ER EN GYLDIGHEDS-PORT, IKKE ET TJEK. Et levende skrivebord aendrer sig
#    mellem to optagelser - markoer, ur, animationer - og saa sammenligner C to
#    FORSKELLIGE skaerme og dumper af den forkerte grund. Maalt 19/9: praecis
#    det skete, og C paastod at billedet ogsaa var sort uden sloering.
#
#    Er for meget aendret udenfor, ved vi ikke om B og C betyder noget. Saa
#    siger proeven SPRUNGET OVER - ikke bestaaet, ikke dumpet. En maaling der
#    ikke kunne maale, er ikke et resultat.
same = sum(1 for p in out if red.getpixel(p) == raw.getpixel(p))
frac = same/len(out)
print(f"D. udenfor:   {same}/{len(out)} punkter uaendrede mellem de to optagelser ({frac:.0%})")
if frac < 0.95:
    print()
    print("SPR. skaermen aendrede sig mellem de to optagelser - maalingen er ugyldig.")
    print("     Koer igen paa et roligt skrivebord. (bevist intet - ikke bestaaet)")
    sys.exit(0)

print(f"B. sloeret:   {sum(blacks)}/{len(pts)} proevepunkter er sorte")
if not all(blacks): print("   DUMP B: feltet er IKKE sloeret"); ok = False
print(f"C. usloeret:  {sum(raws)}/{len(pts)} er sorte (skal vaere lavt)")
if all(raws): print("   DUMP C: ogsaa sort UDEN sloering - proeven beviser intet"); ok = False

print()
print("BESTAAET" if ok else "DUMPET")
sys.exit(0 if ok else 1)
PY
