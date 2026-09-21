#!/bin/bash
# Beviskortet. Hver linje UDLEDES - ingen af tallene staar i scriptet.
#
# Gustav, 19/9: "de skal ogsaa kunne bevise at tingene virker som rent faktisk
# bevist". En signoff-tabel er skrevet af den der har mest interesse i at den er
# groen. Det her er en kommando.
#
# Og sidste blok MUTERER og kraever en ROED. Uden den er alle linjer over groen
# maling: de kan bestaa paa en suite der ikke maaler noget.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
faldt=0
ja()     { printf "  [ok]     %-48s %s\n" "$1" "$2"; }
nej()    { printf "  [FALDT]  %-48s %s\n" "$1" "$2"; faldt=$((faldt+1)); }
umaalt() { printf "  [umaalt] %-48s %s\n" "$1" "$2"; }

echo "BEVISKORT - computer-mcp - $(date -u +%Y-%m-%dT%H:%MZ)"
echo "commit: $(git rev-parse --short HEAD) - gren: $(git branch --show-current)"
echo
echo "- hvad koden siger -"
N=$(node -e "import('./mcp-server/tools.js').then(m=>console.log(m.TOOLS.length))")
L=$(node -e "import('./mcp-server/tools.js').then(m=>console.log(m.TOOLS.filter(t=>t.tier==='read').length))")
ja "vaerktoejer i koden" "$N ($L laesende, $((N-L)) skrivende)"
S=$(node -e "import('./mcp-server/policy.js').then(m=>console.log(m.TAGER_SKAERMEN.size))" 2>/dev/null || echo 0)
ja "kan tage skaermen" "$S - naegtes med CMCP_BACKGROUND=1"

echo
echo "- husets egne vagter, koert enkeltvis -"
for f in test/redaction-unit.py test/server-e2e.mjs test/claims.mjs test/failclosed.mjs test/errors.mjs test/concurrent.mjs test/claims-offline.mjs; do
  [ -f "$f" ] || continue
  if [ "${f##*.}" = "py" ]; then ud=$(python3 "$f" 2>&1); else ud=$(node "$f" 2>&1); fi
  r=$?
  ok=$(printf '%s' "$ud" | grep -cE "^OK|sort OK")
  du=$(printf '%s' "$ud" | grep -cE "^DUMP")
  sp=$(printf '%s' "$ud" | grep -cE "^SPR\.")
  ekstra=""; [ "$sp" != "0" ] && ekstra=", $sp sprunget over"
  if [ "$du" = "0" ] && [ "$r" = "0" ]; then ja "$(basename "$f")" "$ok groenne$ekstra"
  else nej "$(basename "$f")" "$du roede"; fi
done

echo
echo "- det der ligger uden for maskinen -"
UDGIVET=$(curl -s --max-time 10 https://registry.npmjs.org/@agent360/computer-mcp 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s)['dist-tags'].latest)}catch{console.log('UMAALT')}})")
KILDE=$(node -e "console.log(require('./mcp-server/package.json').version)")
if [ "$UDGIVET" = "UMAALT" ]; then umaalt "npm" "kunne ikke naas"
elif [ "$UDGIVET" = "$KILDE" ]; then ja "npm = kilden" "$UDGIVET"
else nej "npm er bagud" "npx giver $UDGIVET, kilden er $KILDE"; fi

FORAN=$(git rev-list origin/main..HEAD --count 2>/dev/null || echo 0)
if [ "$FORAN" = "0" ]; then ja "alt er skubbet" "0 commits foran origin"
else nej "ikke skubbet" "$FORAN commits ligger lokalt"; fi

CI=$(gh run list -R Agent360dk/computerMCP -w CI --limit 20 --json headSha,conclusion \
      -q "[.[] | select(.headSha==\"$(git rev-parse HEAD)\")] | .[0].conclusion" 2>/dev/null)
case "$CI" in
  success) ja "CI groen paa denne commit" "$(git rev-parse --short HEAD)" ;;
  ""|null) umaalt "CI paa denne commit" "har ikke koert - skub foerst" ;;
  *)       nej "CI paa denne commit" "$CI" ;;
esac

echo
echo "- det der ikke kan udledes her -"
umaalt "om et traek bliver TAGET IMOD" "kraever en modtager, altsaa en skaerm"
umaalt "macOS' skaermoptagelses-paamindelse" "kan foerst ses over en maaned"
umaalt "OS-kontrakten: osascript giver selv op" "kraever EEN aegte dialog: CMCP_DIALOGS=1"
umaalt "at vi selv taender Chromiums trae" "mekanismen er maalt 0->728; ledningen kraever en FRISK Chromium-proces"

echo
echo "- MUTATION: sover vagterne? -"
# ⛔ FOERSTE UDGAVE MUTEREDE BAGGRUNDS-PORTEN I index.js og fik 0 roede - og
#    meldte "VAGTERNE SOVER". Det var falsk alarm: porten findes i TO lag, og
#    da det ene blev fjernet, holdt det andet. Forsvar i dybden virkede, og
#    kortet kaldte det tavshed.
#
#    En mutation skal ramme et sted der er det ENESTE der holder et loefte.
#    Her: sloeringen i revisionsloggen. Fjernes den, staar hemmeligheder i
#    klartekst i den fil hvis loefte er at de aldrig goer.
#
#    Og kortet tjekker at mutationen FAKTISK aendrede filen. Et doedt moenster
#    ligner ellers en sovende vagt, og det er den farligste forveksling der
#    findes: begge ser groenne ud naar man retter den forkerte ting.
BAK=$(mktemp)
cp mcp-server/audit.js "$BAK"
gendan() { cp "$BAK" mcp-server/audit.js; rm -f "$BAK"; }
trap gendan EXIT INT TERM
FOER_MD5=$(md5 -q mcp-server/audit.js)
# Mutationen rammer selve SLOERINGEN - ét sted, som ikke flytter sig naar
# kaldstedet skrives om. 20/9 pegede kortet paa kaldstedet, jeg aendrede
# den linjes form, og kortet meldte straks "MUTATIONEN RAMTE INTET" - som
# det skal. Et doedt moenster ligner ellers en sovende vagt.
sed -i '' 's/^  if (typeof text !== .string.) return null;/  return text;/' mcp-server/audit.js
EFTER_MD5=$(md5 -q mcp-server/audit.js)
if [ "$FOER_MD5" = "$EFTER_MD5" ]; then
  gendan; trap - EXIT INT TERM
  nej "MUTATIONEN RAMTE INTET" "moenstret er doedt - kortet kan ikke bevise noget"
else
  MUT=$(node test/claims.mjs 2>&1 | grep -cE "^DUMP")
  gendan; trap - EXIT INT TERM
  if [ "$MUT" -gt 0 ]; then ja "vagterne vaagner" "$MUT paastande blev roede af mutationen"
  else nej "VAGTERNE SOVER" "mutationen gav 0 roede - suiten maaler ingenting"; fi
fi
REN=$(git status --porcelain mcp-server/audit.js | wc -l | tr -d ' ')
if [ "$REN" = "0" ]; then ja "filen gendannet" "git diff er tom"
else nej "FILEN ER IKKE GENDANNET" "ryd op i haanden"; fi

echo
if [ "$faldt" = "0" ]; then echo "BEVISKORT: intet faldt."; else echo "BEVISKORT: $faldt faldt."; fi
exit "$faldt"
