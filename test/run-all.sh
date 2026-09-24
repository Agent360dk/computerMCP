#!/bin/bash
# Koerer hele suiten og gemmer FULD udskrift pr. proeve.
# Findes fordi jeg 18/9 kun printede sidste linje, saa en dumpet koersel
# efterlod "DUMPET: 2 tjek" og ingen oplysning om hvilke to. Beviset skal
# overleve koerslen, ellers er en flaksende proeve ikke til at undersoege.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${TMPDIR:-/tmp}/cmcp-suite-$(date +%H%M%S).log"
# ⛔ FUNDET AF RAADGIVEREN 19/9, og det er et brud paa produktets eget loefte.
#    `failclosed.mjs` og `server-e2e.mjs` satte ingen egen state-mappe, saa de
#    skrev i MENNESKETS rigtige revisionslog. MAALT i
#    ~/.local/state/computer-mcp/audit.jsonl: 539 poster i ask/allow som ingen
#    af hans agenter har bedt om - 116 afviste Terminal-aktiveringer, 61 klik i
#    (5,5), 95 tastetryk. Loggen skal kunne besvare "hvad gjorde agenten paa min
#    maskine". Den kan den ikke, naar proeverne skriver i den.
#
#    Hele suiten skriver nu i sin egen mappe. De eksisterende linjer er
#    menneskets data og roeres ikke.
export CMCP_STATE_DIR="${CMCP_STATE_DIR:-${TMPDIR:-/tmp}/cmcp-suite-state-$$}"
# ⛔ 22/9: hver server starter menulinje-ikonet. Uden denne linje ville hver
#    proeve der starter en server, saette et ikon i menneskets menulinje.
export CMCP_STATUS_IKON=0
rc=0
run() {
  echo "===== $1 =====" >> "$LOG"
  ( cd "$ROOT" && eval "$2" ) >> "$LOG" 2>&1
  local r=$?
  [ $r -ne 0 ] && rc=1
  printf "%-22s %s\n" "$1" "$([ $r -eq 0 ] && echo BESTAAET || echo "DUMPET (exit $r)")"
}
# ⛔ MAALT 19/9: to af suiterne viser i alt OTTE aegte macOS-dialoger pr.
#    koersel. De er der med vilje - en dialog der ikke kan ses, beviser intet
#    om at en ubesvaret dialog bliver til et afslag, og det er produktets
#    vigtigste egenskab. Men jeg koerte suiten omkring ti gange paa en dag, og
#    Gustav fik dermed ~80 afbrydelser paa en maskine hvor hele loeftet er at
#    produktet IKKE tager skaermen. Han spurgte to gange hvad de hvide bokse var.
#
#    CMCP_QUIET=1 springer de to suiter over - og de rapporteres som SPRUNGET
#    OVER, aldrig som bestaaet. Et flag der fjernede stoejen ved at lade som om
#    noget var maalt, ville vaere vaerre end stoejen.
#
#    Grov frem for fin med vilje: et halv-guardet dialog-tjek er et hul man
#    ikke ser. En hel suite der siger "jeg koerte ikke" er aerlig.
if [ "${CMCP_DIALOGS:-}" != "1" ]; then
  echo "Samtykke-porten proeves gennem en attrap: ingen bokse, og proeverne koerer hver gang."
  echo "  Det ene der ikke maales her: at osascript selv giver op efter N sekunder (OS-kontrakten)."
else
  echo "CMCP_DIALOGS=1: denne koersel maaler OS-kontrakten mod det RIGTIGE osascript."
  echo "  Den viser aegte dialoger. Koer den kun naar mennesket har sagt ja."
fi
echo

# ⛔ MAALT 19/9: den medsendte binaer var 4 minutter aeldre end kilden, og en
#    mutation af sloeringen stod derfor GROEN. `swift build -c release` skriver
#    til .build/release (kun arm64); den universale binaer bor i
#    .build/apple/Products/Release og bliver KUN opdateret af en build med
#    --arch arm64 --arch x86_64. Jeg kopierede den forkerte - og maalte intet.
#    En proeve mod en forældet binaer er ikke en svag proeve; den er et instrument
#    der svarer paa et andet spoergsmaal end det stillede.
NYESTE_KILDE=$(find "$ROOT/helper/Sources" -name '*.swift' -newer "$ROOT/mcp-server/vendor/cmcp-helper" 2>/dev/null | head -5)
# ⛔ MAALT 24/9: vagten tjekkede KUN vendor/. Men proeverne kan falde tilbage
#    paa bygge-mappens binaer, og `stille-vej.mjs` brugte den som FOERSTE valg -
#    sidst skrevet kl. 23:02 aftenen foer, mens alle dagens rettelser laa i
#    vendor/. Proeven maalte gaarsdagens kode, og intet her sagde fra.
#    En vagt der kun ser den ene af to binaerer, vogter halvdelen.
if [ -z "$NYESTE_KILDE" ] && [ -f "$ROOT/helper/.build/release/cmcp-helper" ]; then
  NYESTE_KILDE=$(find "$ROOT/helper/Sources" -name '*.swift' -newer "$ROOT/helper/.build/release/cmcp-helper" 2>/dev/null | head -5)
  [ -n "$NYESTE_KILDE" ] && NYESTE_KILDE="$NYESTE_KILDE
   (det er BYGGE-MAPPENS binaer der er gammel: helper/.build/release/cmcp-helper)"
fi
if [ -n "$NYESTE_KILDE" ]; then
  echo "⛔ STOP: den medsendte binaer er AELDRE end kilden. Disse filer er nyere:"
  echo "$NYESTE_KILDE" | sed 's|^|   |'
  echo "   Alt herunder ville maale den GAMLE binaer. Byg og kopier foerst:"
  echo "   cd helper && swift build -c release --arch arm64 --arch x86_64"
  echo "   cp helper/.build/apple/Products/Release/cmcp-helper mcp-server/vendor/cmcp-helper"
  echo "   cp helper/.build/apple/Products/Release/cmcp-helper helper/.build/release/cmcp-helper"
  exit 1
fi

# Attrapperne er Swift og bygges kun naar kilden er nyere end binaeren.
# Uden dem springer paastand 3 og 10 over - altsaa produktets foerste loefte.
bash "$ROOT/scripts/byg-fixtures.sh" || echo "⚠ kunne ikke bygge attrapperne - paastand 3 og 10 springer over"

run "sloering (enhed)"   "python3 test/redaction-unit.py"
run "MCP-protokol (e2e)" "node test/server-e2e.mjs"
# `claims.mjs` guarder sig selv pr. tjek, saa den koerer ALTID - vagterne uden
# dialog (indsproejtning, udklipsholder, vaerktoejstal) skal proeves hver gang.
# `failclosed.mjs` er dialogen fra ende til anden og har intet at koere uden.
run "paastande"          "node test/claims.mjs"
# ⛔ 19/9: her stod at proeven blev SPRUNGET OVER uden CMCP_DIALOGS=1. Den
#    daekker produktets vigtigste egenskab - en ubesvaret dialog er et afslag -
#    og den var dermed ubevist i naesten hver koersel. Nu gaar spoergsmaalet
#    gennem en attrap, saa den koerer HVER gang og viser ingenting.
run "fejl-lukket"        "node test/failclosed.mjs"

run "fejlbeskeder"       "node test/errors.mjs"
run "flere agenter"      "node test/concurrent.mjs"
run "revisionskaeden"    "node test/audit-chain.mjs"
run "den stille vej"    "CMCP_KRAEV_STILLE=1 node test/stille-vej.mjs"
run "baggrund+stille"    "node test/baggrund-stille.mjs"
run "sessions-porten"   "node test/sessionsport.mjs"
run "e2e-forloeb"       "node test/e2e-forloeb.mjs"
run "statusikonet"      "node test/status-ikon.mjs"
run "godkend fra ikonet" "node test/ikon-godkend.mjs"
run "samtidige agenter"  "node test/samtidige-agenter.mjs"
run "foraeldre-vagten"   "node test/vagt.mjs"
# ⛔ DEN ENESTE proeve der saetter CMCP_BACKGROUND=0 - «maa tage skaermen».
#    Den maaler de larmende veje paa vores EGEN attrap, og den har en selv-vagt
#    der afviser at koere hvis et skrivende kald mangler `app`, eller hvis et af
#    de fem der ikke kan rettes mod et program sniger sig ind. Vagten er
#    mutationsbevist begge veje (blind form -> roed, brudt anker -> roed).
run "larmende veje"      "node test/larmende-veje.mjs"
# ⛔ Den foerste besked en fremmed nogensinde ser. `missing-accessibility` var
#    naevnt to steder i repoet - hjaelperen der rejser den, serveren der
#    oversaetter den - og INGEN proeve roerte dem. Tilladelserne kan ikke
#    fjernes paa menneskets maskine, saa hjaelperen erstattes af en attrap der
#    svarer praecis den fejlkode macOS ville give.
run "tilladelser"        "node test/tilladelser.mjs"
# ⛔ 19/9: Gustav bad tre gange om at de hvide bokse stopper. Maalt samme aften:
#    hver eneste boks han havde set kom fra en kommando JEG skrev - otte fra en
#    suite-koersel, to fra en maaling. Ingen planlagte job, ingen baggrunds-
#    proces, intet fra produktet selv. Problemet var ikke at dialogerne fandtes;
#    det var at jeg kunne tilkalde dem uden at taenke.
#
#    Kvitteringen loeser det: en groen dialog-koersel skriver HVILKEN kode den
#    beviste. release.sh accepterer den, hvis koden ikke har flyttet sig siden.
#    Dialogerne koeres dermed EN gang pr. aendring af samtykke-porten - ikke en
#    gang pr. udgivelsesforsoeg.
KVIT="$ROOT/.dialog-kvittering"
# ⛔ TO GANGE RETTET, og anden gang var fordi produktet flyttede sig under den.
#
#    Foerst var listen for KORT: den daekkede ikke `tools.js`, hvor hvert
#    vaerktoejs niveau bor - saa en tier-aendring kunne slaa porten fra uden at
#    ugyldiggoere kvitteringen. Vagten bestod sin egen omgaaelse.
#
#    Saa blev den for BRED. Da samtykke-porten fik en attrap, blev ALT vores
#    eget bevist ved hver koersel uden et vindue. Tilbage staar praecis ét
#    faktum der kraever en aegte dialog: at macOS selv giver op efter
#    `giving up after N`. Kun to filer kan aendre DET - `policy.js`, som bygger
#    kommandoen og tolker svaret, og `failclosed.mjs`, som maaler det.
#
#    Med den brede liste ugyldiggjorde enhver rettelse i en proevefil
#    kvitteringen og kraevede en ny boks paa menneskets skaerm. En vagt der
#    koster en afbrydelse hver gang man retter en test, bliver slaaet fra.
PORT_FILER="mcp-server/policy.js test/failclosed.mjs"
port_fingeraftryk() { ( cd "$ROOT" && cat $PORT_FILER 2>/dev/null | shasum -a 256 | cut -c1-16 ); }
if [ "${CMCP_DIALOGS:-}" = "1" ] && [ $rc -eq 0 ]; then
  printf '%s %s\n' "$(port_fingeraftryk)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$KVIT"
  echo "kvittering skrevet: samtykke-porten er bevist for denne udgave af koden."
fi
echo "fuld udskrift: $LOG"
# Det maa ikke kunne glemmes at halvdelen af samtykke-daekningen ikke koerte.
[ "${CMCP_DIALOGS:-}" != "1" ] && echo "⚠ OS-kontrakten (osascript giver selv op) er ikke maalt i denne koersel - alt VORES er."
[ $rc -ne 0 ] && { echo "--- dumpede linjer ---"; grep -E "^DUMP|^FEJL" "$LOG"; }
exit $rc
