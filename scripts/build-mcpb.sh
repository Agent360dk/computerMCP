#!/bin/bash
# Byg en self-contained Claude Desktop / Smithery MCPB-bundle.
#
# ⛔ HVORFOR VENDORED, IKKE npx (29/9, distributions-research)
#    MCPB-designet er «bundler alle afhængigheder, virker offline, ingen sky».
#    Et manifest med command:"npx" fejler det designet (kræver npm-netværk hver
#    opstart) og bruger ikke Claude Desktops medbragte Node. Derfor pakkes
#    server-filerne + node_modules + vendor/ (helper-binær + status-app) ind, og
#    manifestet peger paa `node ${__dirname}/server/index.js`.
#
#    Brug: bash scripts/build-mcpb.sh [output-mappe]
#    Kraever: `npm i -g @anthropic-ai/mcpb`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist-mcpb}"
SRV="$OUT/build/server"

echo "1/5 ryd + opret $OUT/build"
rm -rf "$OUT/build"; mkdir -p "$SRV"

echo "2/5 kopier server-filer + vendor (samme sæt som npm 'files')"
for f in index.js tools.js policy.js audit.js helper.js status.js godkend.js programlaas.js sloejfe.js vagt.js package.json; do
  cp "$ROOT/mcp-server/$f" "$SRV/"
done
cp -R "$ROOT/mcp-server/bin" "$SRV/bin"
cp -R "$ROOT/mcp-server/vendor" "$SRV/vendor"
find "$SRV" -name .DS_Store -delete

echo "3/5 installer produktions-deps ind i bundlen (offline-klar)"
( cd "$SRV" && npm install --omit=dev --no-audit --no-fund >/dev/null )

echo "4/5 manifest + valider"
cp "$ROOT/bundle/manifest.json" "$OUT/build/manifest.json"
( cd "$OUT/build" && mcpb validate manifest.json )

echo "5/5 pak"
( cd "$OUT/build" && mcpb pack . "$OUT/computer-mcp.mcpb" )
echo "FAERDIG: $OUT/computer-mcp.mcpb"
