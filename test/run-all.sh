#!/bin/bash
# Koerer hele suiten og gemmer FULD udskrift pr. proeve.
# Findes fordi jeg 18/9 kun printede sidste linje, saa en dumpet koersel
# efterlod "DUMPET: 2 tjek" og ingen oplysning om hvilke to. Beviset skal
# overleve koerslen, ellers er en flaksende proeve ikke til at undersoege.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="${TMPDIR:-/tmp}/cmcp-suite-$(date +%H%M%S).log"
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
  echo "⚠ dialoger springes over (standard): 'fejl-lukket' og 'paastande' springes over (de viser dialoger)."
  echo "  De to daekker samtykke-porten. release.sh NAEGTER at udgive uden dem."
else
  echo "CMCP_DIALOGS=1: denne koersel viser ca. 8 dialoger i 2 sekunder hver."
fi
echo

run "sloering (enhed)"   "python3 test/redaction-unit.py"
run "MCP-protokol (e2e)" "node test/server-e2e.mjs"
# `claims.mjs` guarder sig selv pr. tjek, saa den koerer ALTID - vagterne uden
# dialog (indsproejtning, udklipsholder, vaerktoejstal) skal proeves hver gang.
# `failclosed.mjs` er dialogen fra ende til anden og har intet at koere uden.
run "paastande"          "node test/claims.mjs"
if [ "${CMCP_DIALOGS:-}" != "1" ]; then
  printf "%-22s %s\n" "fejl-lukket" "SPRUNGET OVER (bevist intet)"
  sprunget=1
else
  run "fejl-lukket"        "node test/failclosed.mjs"
fi
run "fejlbeskeder"       "node test/errors.mjs"
run "flere agenter"      "node test/concurrent.mjs"
echo "fuld udskrift: $LOG"
# Det maa ikke kunne glemmes at halvdelen af samtykke-daekningen ikke koerte.
[ "${sprunget:-}" = "1" ] && echo "⚠ Dialog-tjekkene koerte IKKE - samtykke-porten er UBEVIST i denne koersel. release.sh tvinger dem."
[ $rc -ne 0 ] && { echo "--- dumpede linjer ---"; grep -E "^DUMP|^FEJL" "$LOG"; }
exit $rc
