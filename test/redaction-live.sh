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
export HELPER
APP="${CMCP_LIVE_APP:-com.google.Chrome}"
TMP="${TMPDIR:-/tmp}/cmcp-live-$$"
mkdir -p "$TMP"
# MAALT 19/9: denne proeve efterlod EN FANE PR. KOERSEL i Gustavs Chrome.
# Temp-mappen blev slettet af trappen, men fanen blev staaende - og pegede saa
# paa en fil der ikke fandtes laengere, dvs. en HVID fejlside. Otte af dem laa
# der da han spurgte hvad det hvide vindue var.
#
# En proeve paa et produkt hvis loefte er "uden at tage skaermen", maa rydde op
# efter sig selv. Fanen lukkes nu i samme trap som filerne.
luk_fanen() {
  osascript >/dev/null 2>&1 <<'AS' || true
tell application "Google Chrome"
  repeat with w in (windows as list)
    repeat with t in (tabs of w as list)
      try
        if (URL of t) contains "pw.html" then close t
      end try
    end repeat
  end repeat
end tell
AS
}
trap 'luk_fanen; rm -rf "$TMP"' EXIT
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

# ⛔ MAALT 19/9: proeven kan ikke regne med at faa fokus. Paa Gustavs maskine
#    holder Agent360 IDE den indbyggede skaerm, fordi agentens egen udskrift
#    ruller i den - og saa laa proevesiden bagved, D saa 4 % uaendret, og
#    maalingen var ugyldig hver eneste gang.
#
#    Proeven flytter derfor sit EGET vindue til en anden skaerm, hvis der er en.
#    Saa er siden synlig uanset hvem der har fokus, og D har et roligt billede.
#    Den roerer kun det vindue den selv aabnede: titlen "cmcp bevis".
if [ -z "${CMCP_LIVE_NO_MOVE:-}" ]; then
  osascript <<'AS' >/dev/null 2>&1 || true
tell application "System Events"
  set skaerme to count of desktops
end tell
if skaerme > 1 then
  tell application "Google Chrome"
    repeat with w in windows
      try
        if (title of active tab of w) contains "cmcp bevis" then
          set bounds of w to {-3820, 60, -1960, 1060}
          exit repeat
        end if
      end try
    end repeat
  end tell
end if
AS
  sleep 2
fi

# ⛔ Browseren skal vaere FORREST naar der optages. MAALT 19/9: laa den bag
#    editoren, viste pixels inden for dens vinduesramme editorens indhold - og
#    editoren opdaterede sig selv mellem de to optagelser. D dumpede da paa
#    noget der slet ikke var browserens.
"$HELPER" activate --app "$APP" >/dev/null 2>&1
sleep 2
# ⛔ "Er Chrome forrest" var en svag stedfortraeder for det vi faktisk vil vide:
#    fotograferede vi VORES side, eller noget der laa oven paa den? Og den
#    spurgte forkert paa en maskine med flere skaerme: her holder Agent360 IDE
#    fokus paa den indbyggede skaerm, mens Chrome udmaerket kan ligge synlig paa
#    en anden. Proeven sprang derfor over hver gang, uden at noget var galt.
#
#    Den maaler det nu direkte, i trin E nedenfor: proevesiden er #FFD400, og
#    hvis pixlerne rundt om feltet i det USLOEREDE billede er den gule, saa ER
#    det vores side der blev fotograferet. Ligger noget oven paa, er de ikke gule.
#    Staerkere end forrest-tjekket, og uafhaengigt af hvem der har fokus.
FRONT=$("$HELPER" apps 2>/dev/null | python3 -c "import json,sys;print(next((a['bundleId'] for a in json.load(sys.stdin).get('apps',[]) if a.get('active')), ''))" 2>/dev/null)
[ "$FRONT" = "$APP" ] || echo "   (bemaerk: $FRONT har fokus, ikke $APP - trin E afgoer om siden alligevel blev fotograferet)"

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

# ⛔ MAALT 19/9: her laa en hel dags uforklaret flakiness. Proeven fotograferede
#    skaerm 0 - en ekstern monitor - mens Chrome aabnede paa den indbyggede.
#    D sagde konstant "skaermen aendrede sig" (praecis 292/400, to gange i traek,
#    hvilket ikke er flimmer men systematik), fordi de to optagelser var af en
#    skaerm hvor MIN EGEN agent-udskrift rullede.
#
#    Nu vaelges skaermen af feltets egne koordinater: sikre felter er globale
#    punkter, hver skaerm oplyser sit origo og sin stoerrelse, og den skaerm der
#    INDEHOLDER feltet er den der skal fotograferes.
DISPLAY_N=$(python3 - "$TMP" <<'PYEOF'
import json, subprocess, sys, os, tempfile
tmp = sys.argv[1]
r = max(json.load(open(tmp + "/rects.json"))["rects"], key=lambda r: r["w"] * r["h"])
cx, cy = r["x"] + r["w"] / 2, r["y"] + r["h"] / 2
H = os.environ.get("HELPER") or ""
for i in range(8):
    png = os.path.join(tempfile.mkdtemp(), "p.png")
    try:
        d = json.loads(subprocess.run([H, "screenshot", "--display", str(i), "--out", png],
                                      capture_output=True, text=True, timeout=60).stdout)
        os.unlink(png)
    except Exception:
        break
    if not d.get("ok"):
        break
    ox, oy = d.get("displayOriginX", 0), d.get("displayOriginY", 0)
    w, h = d["screenWidthPoints"], d["screenHeightPoints"]
    if ox <= cx < ox + w and oy <= cy < oy + h:
        print(i); break
else:
    print(0)
PYEOF
)
DISPLAY_N=${DISPLAY_N:-0}
echo "   feltet ligger paa skaerm $DISPLAY_N - det er den der fotograferes"

# Taettest muligt paa hinanden: skaermen lever, og hvert sekund imellem er stoej.
"$HELPER" screenshot --display "$DISPLAY_N" --out "$TMP/raw.png" --no-redact > "$TMP/raw.json" || fail "usloeret optagelse fejlede"
"$HELPER" screenshot --display "$DISPLAY_N" --out "$TMP/red.png" > "$TMP/red.json"  || fail "sloeret optagelse fejlede"

# P-M1: samme skaerm, samme felt, samme sekund. Det er den ENESTE retfaerdige
# sammenligning - to maalinger paa to tidspunkter maaler skrivebordet, ikke de
# to vaerktoejer. Findes Peekaboo ikke, springes E over og resten koerer.
PB="${CMCP_PEEKABOO:-$(command -v peekaboo || true)}"
if [ -n "$PB" ] && [ -x "$PB" ]; then
  "$PB" image --mode screen --path "$TMP/pb.png" >/dev/null 2>&1 || true
fi

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

# ⛔ Rektanglerne er GLOBALE punkter; billedet har sit eget (0,0) i skaermens
#    oeverste venstre hjoerne. Uden at traekke origo fra, sampler vi et sted der
#    ikke findes paa netop dette billede - og faar "ikke sloeret" paa en sloering
#    der virker. Maalt: skaermene ligger paa (-3840,27), (-1920,27) og (0,0).
OX = meta.get("displayOriginX", 0)
OY = meta.get("displayOriginY", 0)
print(f"   skaermens origo: ({OX}, {OY}) - trukket fra alle koordinater")

def samples(r):
    x0, y0 = (r["x"]-OX)*scale, (r["y"]-OY)*scale
    w, h = r["w"]*scale, r["h"]*scale
    return [(int(x0+w*fx), int(y0+h*fy))
            for fx in (0.3,0.5,0.7) for fy in (0.35,0.5,0.65)
            if 0 <= int(x0+w*fx) < W and 0 <= int(y0+h*fy) < H]

is_black = lambda p: sum(p) <= 30
ok = True
target = max(rects, key=lambda r: r["w"]*r["h"])
pts = samples(target)
if not pts:
    # ⛔ AABEN 19/9: AX' rektangler og SCDisplay's origo ligger IKKE i samme rum.
    #    Maalt: skaermene meldes paa (-3840,27), (-1920,27) og (0,0) - det y=27
    #    roeber en anden konvention end AX' (AX har oeverste venstre hjoerne af
    #    HOVEDskaermen som (0,0) med y nedad). Traekker man SCDisplay-origo fra et
    #    AX-rektangel, lander man uden for billedet naar vinduet staar paa en
    #    sekundaer skaerm.
    #
    #    Det er ikke gaettet faerdigt, og derfor DUMPER den her i stedet for at
    #    sample et forkert sted og kalde det et bevis. Naeste skridt er at maale
    #    de to rum mod hinanden med eet kendt vindue, ikke at raade sig frem.
    print("DUMP: rektanglet ligger uden for optagelsen -"
          " AX-koordinater og skaermens origo er ikke samme rum (aabent, 19/9)")
    sys.exit(1)

blacks = [is_black(red.getpixel(p)) for p in pts]
raws   = [is_black(raw.getpixel(p)) for p in pts]

# E0. Er det VORES side vi har fotograferet? ⛔ DETTE SPOERGSMAAL KOMMER FOERST.
#     19/9 laa det efter D, og saa afviste D maalingen som "skaermen aendrede
#     sig" uden at nogen fik at vide OM siden overhovedet var synlig. En
#     forfining maa aldrig svare foer praemissen. Er siden ikke der, er alt
#     det oevrige stoej.
#     Oprindeligt spoergsmaal: Proevesiden er #FFD400. Ligger et
#     andet vindue oven paa feltet, er pixlerne rundt om det ikke gule - og saa
#     maaler B og C noget helt andet end de paastaar.
GUL = (255, 212, 0)
def naer_gul(p, slip=26):
    return all(abs(a-b) <= slip for a, b in zip(p, GUL))
tx0 = (target["x"]-OX)*scale; ty0 = (target["y"]-OY)*scale
tw, th = target["w"]*scale, target["h"]*scale
ring = []
for dx in (-0.25, 0.5, 1.25):
    for dy in (-1.4, 2.4):
        px, py = int(tx0+tw*dx), int(ty0+th*dy)
        if 0 <= px < W and 0 <= py < H: ring.append((px, py))
gule = sum(1 for p in ring if naer_gul(raw.getpixel(p)))
print(f"E0. vores side: {gule}/{len(ring)} punkter rundt om feltet er proevesidens gule")
if not ring or gule < max(1, len(ring)*2//3):
    print()
    print("SPR. det var ikke proevesiden der blev fotograferet - noget laa oven paa.")
    print("     (bevist intet - ikke bestaaet)")
    sys.exit(0)

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
    X0, Y0 = int((box["x"]-OX)*scale), int((box["y"]-OY)*scale)
    X1, Y1 = int((box["x"]+box["w"]-OX)*scale), int((box["y"]+box["h"]-OY)*scale)
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
    if any((r["x"]-OX)*scale <= px <= (r["x"]+r["w"]-OX)*scale and
           (r["y"]-OY)*scale <= py <= (r["y"]+r["h"]-OY)*scale for r in rects): continue
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

# E. P-M1: sloerer Peekaboo det samme felt, paa den samme skaerm, i det samme
#    sekund? DET MAA IKKE afgoere om VORES proeve bestaar - det er en maaling af
#    et andet produkt, ikke en kontrakt vores kode skal opfylde. E roerer aldrig `ok`.
#
#    OG DEN BESVARER KUN SPOERGSMAALET FOR DETTE FELT. Et sikkert felt i en
#    browser baerer rolle AXTextField med UNDERROLLE AXSecureTextField. Sloerer
#    de ikke HER, siger det intet om et NATIVT kodeordsfelt, hvor rollen selv er
#    AXSecureTextField. To udsagn, to maalinger.
import os
pbp = tmp + "/pb.png"
if os.path.exists(pbp):
    try:
        pb = Image.open(pbp).convert("RGB")
        if pb.size != red.size:
            print("E. Peekaboo: anden billedstoerrelse (%s mod %s) - ikke sammenlignelig" % (pb.size, red.size))
        else:
            pbs = [is_black(pb.getpixel(q)) for q in pts]
            print("E. Peekaboo: %d/%d proevepunkter sorte i SAMME felt" % (sum(pbs), len(pts)))
            if sum(pbs) == 0:
                print("   -> Peekaboo sloerer IKKE dette web-kodeordsfelt (maalt, ikke laest)")
            elif all(pbs):
                print("   -> Peekaboo sloerer det OGSAA. Sammenligningen paa sitet maa da ikke")
                print("      paastaa andet - ret sitet foer noget udgives.")
            else:
                print("   -> delvist sort: uafklaret, gentag maalingen")
    except Exception as e:
        print("E. Peekaboo: kunne ikke laeses (%s)" % e)
else:
    print("E. Peekaboo: ikke maalt (binaeren ikke fundet, eller optagelsen fejlede)")

print()
print("BESTAAET" if ok else "DUMPET")
sys.exit(0 if ok else 1)
PY
