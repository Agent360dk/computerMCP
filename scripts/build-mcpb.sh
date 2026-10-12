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
# ⛔ 7/10: her stod en HAANDHOLDT filliste. Den manglede tilstede.js (punkt P), saa
#    bundlen ville gaa ned ved opstart. Nu bruges npm's egen "files" - én liste, ét sted
#    (test/pakke-filer.mjs vogter at hele import-kaeden er med).
cp "$ROOT/mcp-server/package.json" "$SRV/"
for f in $(node -e "console.log(require('$ROOT/mcp-server/package.json').files.join('\n'))"); do
  f="${f%/}"
  [ -e "$ROOT/mcp-server/$f" ] || { echo "FEJL: $f staar i package.json files, men findes ikke"; exit 1; }
  cp -R "$ROOT/mcp-server/$f" "$SRV/"
done
find "$SRV" -name .DS_Store -delete

echo "3/5 installer produktions-deps ind i bundlen (offline-klar)"
( cd "$SRV" && npm install --omit=dev --no-audit --no-fund >/dev/null )

echo "4/5 manifest + valider"
# Versionen foelger pakken - manifestet bar et fast «0.2.1».
node -e "const m=require('$ROOT/bundle/manifest.json'); m.version=require('$ROOT/mcp-server/package.json').version; require('fs').writeFileSync('$OUT/build/manifest.json', JSON.stringify(m,null,2)+'\n')"
( cd "$OUT/build" && mcpb validate manifest.json )

echo "5/5 pak"
( cd "$OUT/build" && mcpb pack . "$OUT/computer-mcp.mcpb" )
echo "FAERDIG: $OUT/computer-mcp.mcpb"
