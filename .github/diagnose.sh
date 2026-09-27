#!/bin/bash
# Hvad en fremmed Mac viste efter en koersel: et billede af skaermen og hvert
# scenarie-programs tilgaengeligheds-trae. Kun paa GitHubs koerer - aldrig paa
# en maskine et menneske bruger.
D="$RUNNER_TEMP/diag"; mkdir -p "$D"
screencapture -x "$D/$1.png" || true
for a in com.google.Chrome com.apple.Chess com.apple.AddressBook com.apple.systempreferences com.apple.ActivityMonitor com.apple.finder; do
  mcp-server/vendor/cmcp-helper windows --app "$a" > "$D/$1-$a-vinduer.json" 2>&1 || true
  mcp-server/vendor/cmcp-helper inspect --app "$a" --depth 40 --limit 800 > "$D/$1-$a.json" 2>&1 || true
done
mcp-server/vendor/cmcp-helper apps > "$D/$1-apps.json" 2>&1 || true
mdutil -s / > "$D/$1-spotlight.txt" 2>&1 || true
