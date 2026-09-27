#!/bin/bash
# Mutationsbevis for test/giv-tilbage.mjs. Proeven tager med vilje forgrunden og
# koerer derfor kun paa en fremmed Mac - saa dens mutationsbevis goer det samme.
# To fejl bygges ind i hjaelperen; begge SKAL give roedt.
set -u
fejl=0
mut() {
  local navn="$1" fra="$2" til="$3" d="$RUNNER_TEMP/mut-$1"
  cp -R helper "$d"
  python3 - "$d/Sources/cmcp-helper/Skaerm.swift" "$fra" "$til" <<'PY'
import sys
p, a, b = sys.argv[1:4]
s = open(p).read()
assert s.count(a) == 1, a
open(p, 'w').write(s.replace(a, b))
PY
  (cd "$d" && swift build -c release > /dev/null) || { echo "::error::$navn kunne ikke bygges"; fejl=1; return; }
  if CMCP_HELPER="$d/.build/release/cmcp-helper" node test/giv-tilbage.mjs; then
    echo "::error::mutanten $navn overlevede - proeven maaler ikke"; fejl=1
  else
    echo "mutanten $navn er roed"
  fi
}
mut M1-giver-ikke-tilbage 'NSRunningApplication(processIdentifier: foer.forrestPid)?.activate(options: [])' ''
mut M2-maaler-ikke 'guard foer.forrestPid > 0, foer.forrestPid != tilPid, efter.forrestPid == tilPid else {' 'guard false else {'
exit $fejl
