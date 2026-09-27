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
  python3 - "$d/Sources/cmcp-helper/${MUT_FIL:-Skaerm.swift}" "$fra" "$til" <<'PY'
import sys
p, a, b = sys.argv[1:4]
s = open(p).read()
assert s.count(a) == 1, a
open(p, 'w').write(s.replace(a, b))
PY
  (cd "$d" && swift build -c release 2>&1 | tail -5) ; [ -x "$d/.build/release/cmcp-helper" ] || { echo "::error::$navn kunne ikke bygges"; fejl=1; return; }
  if CMCP_HELPER="$d/.build/release/cmcp-helper" node test/giv-tilbage.mjs; then
    echo "::error::mutanten $navn overlevede - proeven maaler ikke"; fejl=1
  else
    echo "mutanten $navn er roed"
  fi
}
mut M1-giver-ikke-tilbage 'NSRunningApplication(processIdentifier: foer.forrestPid)?.activate(options: [])' ''
mut M2-maaler-ikke 'guard foer.forrestPid > 0, efter.forrestPid != foer.forrestPid else { return ["took_screen": false] }' 'return ["took_screen": false]'
# M3: launch giver ikke forgrunden tilbage (main.swift)
MUT_FIL=main.swift mut M3-launch-giver-ikke-tilbage 'if (g["took_screen"] as? Bool) == true { for (k, v) in g { ls[k] = v } }' 'if false { for (k, v) in g { ls[k] = v } }'
# M4: kun et skift til maalprogrammet gives tilbage (reglen foer koersel 10)
mut M4-kun-maalprogrammet 'efter.forrestPid == maal || !menneskeRoerteNetop()' 'efter.forrestPid == maal'
exit $fejl
