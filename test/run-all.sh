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
run "sloering (enhed)"   "python3 test/redaction-unit.py"
run "MCP-protokol (e2e)" "node test/server-e2e.mjs"
run "fejl-lukket"        "node test/failclosed.mjs"
run "paastande"          "node test/claims.mjs"
run "fejlbeskeder"       "node test/errors.mjs"
run "flere agenter"      "node test/concurrent.mjs"
echo "fuld udskrift: $LOG"
[ $rc -ne 0 ] && { echo "--- dumpede linjer ---"; grep -E "^DUMP|^FEJL" "$LOG"; }
exit $rc
