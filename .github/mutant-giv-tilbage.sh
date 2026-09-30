#!/bin/bash
# Mutationsbevis for test/giv-tilbage.mjs. Proeven tager med vilje forgrunden og
# koerer derfor kun paa en fremmed Mac - saa dens mutationsbevis goer det samme.
# To fejl bygges ind i hjaelperen; begge SKAL give roedt.
set -u
fejl=0
mut() {
  local navn="$1" fra="$2" til="$3" d="$RUNNER_TEMP/mut-$1"
  # Uden byggemappen: den baerer faste stier til originalen (koersel 3 kunne ikke bygge).
  mkdir -p "$d" && cp -R helper/Package.swift helper/Sources "$d"/
  [ -f helper/Package.resolved ] && cp helper/Package.resolved "$d"/
  # ⛔ 30/9 (Astra R2 7): et anker der ikke fandtes, stoppede ikke noget - scriptet
  #    byggede den UMUTEREDE kode og kaldte resultatet et bevis. Nu er det en fejl.
  if ! python3 - "$d/Sources/cmcp-helper/${MUT_FIL:-Skaerm.swift}" "$fra" "$til" <<'PY2'
import sys
p, a, b = sys.argv[1:4]
s = open(p).read()
assert s.count(a) == 1, a
open(p, 'w').write(s.replace(a, b))
PY2
  then echo "::error::$navn: ankeret findes ikke praecis én gang"; fejl=1; return; fi
  (cd "$d" && swift build -c release 2>&1 | tail -5) ; [ -x "$d/.build/release/cmcp-helper" ] || { echo "::error::$navn kunne ikke bygges"; fejl=1; return; }
  local ud rc
  ud=$(CMCP_HELPER="$d/.build/release/cmcp-helper" node "${PROEVE:-test/giv-tilbage.mjs}" 2>&1); rc=$?
  # Roed = exit 1 OG en DUMP-linje. Exit 0 = overlevede. Alt andet = instrumentet svarede ikke.
  if [ $rc -eq 0 ]; then echo "::error::mutanten $navn overlevede - proeven maaler ikke"; fejl=1
  # Runde 3 (Astra 6): KUN den prove mutanten er skrevet til taeller (FORVENTET), ikke en vilkaarlig anden.
  # Runde 5 (Astra): hele det forventede praefiks skal staa FORREST paa en DUMP-linje.
  elif [ $rc -eq 1 ] && printf '%s\n' "$ud" | awk -v p="DUMP ${FORVENTET:-}" 'index($0, p) == 1 { f = 1 } END { exit !f }'; then echo "mutanten $navn er roed ($(printf '%s\n' "$ud" | awk -v p="DUMP ${FORVENTET:-}" 'index($0, p) == 1 { print; exit }' | cut -c1-90))"
  else echo "::error::$navn: instrumentet svarede ikke (rc=$rc) - det er ikke et bevis"; fejl=1; fi
}
FORVENTET=2b mut M1-giver-ikke-tilbage 'NSRunningApplication(processIdentifier: foer.forrestPid)?.activate(options: [])' ''
FORVENTET='2 et tryk' mut M2-maaler-ikke 'guard foer.forrestPid > 0, efter.forrestPid != foer.forrestPid else { return ["took_screen": false] }' 'return ["took_screen": false]'
# M3: launch giver ikke forgrunden tilbage (main.swift)
FORVENTET='3 et program' MUT_FIL=main.swift mut M3-launch-giver-ikke-tilbage 'if (g["took_screen"] as? Bool) == true { for (k, v) in g { ls[k] = v } }' 'if false { for (k, v) in g { ls[k] = v } }'
# M4 (28/9): menneske-tjekket maa ikke spurioest blokere give-tilbage. Paa en
# maskine UDEN menneske skal forgrunden stadig gives tilbage - saa hvis nogen
# faar menneske-grenen til altid at fyre (og dermed altid lade forgrunden staa),
# SKAL proeven blive roed.
FORVENTET=2b mut M4-menneske-tjek-blokerer 'if menneskeRoerteNetop() {' 'if true {'
# M5-M6 (29/9, panelet): kodeordsfelter faar heller ikke tastetryk fra `type`.
# M5: fokus-opslaget siger altid «ikke sikkert» -> proeve 3/3k/3b skal blive roed.
# M6: tjekket kun foer foerste tegn -> fokus der flytter undervejs (3c) skal blive roed.
FORVENTET='3 et kodeordsfelt' PROEVE=test/skriv-ankommer.mjs MUT_FIL=Accessibility.swift mut M5-type-i-kodeordsfelt \
  'static func sikkerStatus(_ el: AXUIElement, kendtRolle: String? = nil) -> Bool? {' \
  'static func sikkerStatus(_ el: AXUIElement, kendtRolle: String? = nil) -> Bool? {
        if true { return false }'
FORVENTET=3c PROEVE=test/skriv-ankommer.mjs MUT_FIL=Input.swift mut M6-kun-tjek-ved-start \
  'if let stop, stop() { return sendt }' 'if let stop, sendt == 0, stop() { return sendt }'
# M7-M8 (1/10, runde 5): paste stopper foer Cmd+V naar laanet slutter.
# M7: det foerste stop (foer udklipsholderen roeres) er vaek -> «before anything changed» maa ikke kunne naas.
FORVENTET='1 SIGUSR1' PROEVE=test/paste-stop.mjs MUT_FIL=Accessibility.swift mut M7-paste-roerer-udklip-foer-stop \
  '        if pasteStop { return (false, "stopped before anything changed: the screen loan ended", false) }' ''
# M8: stoppet laeses aldrig -> paste fortsaetter til Cmd+V (kun paa en fremmed maskine).
FORVENTET='1 SIGUSR1' PROEVE=test/paste-stop.mjs MUT_FIL=Accessibility.swift mut M8-paste-hoerer-ikke-stop \
  '        return sigismember(&s, SIGUSR1) == 1' '        return false'
exit $fejl
