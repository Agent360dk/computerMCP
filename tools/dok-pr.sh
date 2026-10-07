#!/usr/bin/env bash
# tools/dok-pr.sh · dokumentations-PR'en efter en udgivelse (fra genoptag-dok.sh, panel R4-R5, 6-7/10)
# Sørger for at PR'en `release-<V>-dok` findes, efter at npm HAR <V>. Kaldes af
# tools/faerdiggoer-udgivelsen.sh og kan genoptages efter enhver fejl.
# Finder den tilstand der faktisk er (gren lokalt / på origin / PR), og laver kun det der mangler.
#   bash tools/dok-pr.sh --toer   viser hvad der ville ske, ændrer intet
#   bash tools/dok-pr.sh          gør det
set -euo pipefail
cd "$(dirname "$0")/.."
V="$(node -p "require('./mcp-server/package.json').version")"
GREN="release-$V-dok"
REPO=Agent360dk/computerMCP
FILER="PUBLICERET README.md docs mcp-server/README.md server.json"
TOER=0; [ "${1:-}" = "--toer" ] && TOER=1
stop() { echo "⛔ $*"; exit 1; }
goer() { echo "   \$ $*"; [ $TOER = 1 ] || "$@"; }

[ "$(npm view @agent360/computer-mcp@$V version 2>/dev/null)" = "$V" ] || stop "npm har ikke $V - det her er kun fejlvej D (npm HAR $V)"

# ⛔ R4 (Astra): ægte gh svarer `[]` på en tom liste - `.[0]` gav da «null null» og en falsk «PR'en findes».
PR=$(gh pr list --repo $REPO --head "$GREN" --state all --json number,state -q '.[0] | select(. != null) | "\(.number) \(.state)"' 2>/dev/null) || stop "kan ikke læse PR-listen - prøv igen"
if [ -n "$PR" ]; then
  echo "✓ PR'en findes allerede: #$PR - intet at gøre her. Videre til trin 7."
  exit 0
fi

# ⛔ R4 (Astra): `--exit-code` giver 2 når grenen mangler; alt andet end 0/2 er «kan ikke nå origin», ikke fravær.
set +e; git ls-remote --exit-code origin "refs/heads/$GREN" >/dev/null 2>&1; RC=$?; set -e
case $RC in 0) PAA_ORIGIN=1 ;; 2) PAA_ORIGIN=0 ;; *) stop "kan ikke nå origin (git ls-remote gav $RC) - prøv igen" ;; esac
LOKAL=0; git rev-parse --verify -q "refs/heads/$GREN" >/dev/null && LOKAL=1
NU=$(git branch --show-current)
echo "   tilstand: gren lokalt=$LOKAL · på origin=$PAA_ORIGIN · står på '$NU' · ingen PR"

if [ $LOKAL = 1 ] || [ $PAA_ORIGIN = 1 ]; then
  # Grenen findes: brug den, regenerér intet.
  [ $LOKAL = 1 ] || goer git fetch origin "$GREN:$GREN"
  [ "$NU" = "$GREN" ] || { [ -z "$(git status --porcelain)" ] || stop "træet er ikke rent på '$NU' - vis 'git status --short' i chatten"; goer git checkout "$GREN"; }
  if [ $TOER = 1 ] && [ $LOKAL = 0 ]; then
    echo "   (tørkørsel: grenen hentes ikke, så dens ændringer kontrolleres først i den rigtige kørsel)"
  else
    T_GREN=$(git rev-parse --verify -q "$GREN^{tree}") || stop "kan ikke læse grenen $GREN"
    T_MAIN=$(git rev-parse --verify -q "origin/main^{tree}") || stop "kan ikke læse origin/main"
    [ "$T_GREN" != "$T_MAIN" ] || stop "grenen har ingen ændringer mod main - spørg i chatten"
  fi
  goer git push origin "$GREN"
else
  # Ingen gren: sørg for at teksten siger $V, og læg den på en ny gren.
  [ "$NU" = main ] || stop "står på '$NU', forventet main"
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || stop "main er ikke lig origin/main"
  [ "$(cat PUBLICERET)" = "$V" ] || goer sh -c "echo $V > PUBLICERET"
  # ⛔ R5 (Astra): altid, også når PUBLICERET allerede står rigtigt - ellers efterlod en sync-tal-fejl
  #    en halv rettelse, som næste kørsel committede (kun PUBLICERET, forbeholdet stadig på siden).
  goer python3 scripts/sync-tal.py
  [ $TOER = 1 ] || [ -n "$(git status --porcelain -- $FILER)" ] || stop "intet ændret - PUBLICERET og siderne står allerede rigtigt på main? Spørg i chatten"
  goer git checkout -b "$GREN"
  goer git add $FILER
  goer git commit -m "release: $V er udgivet - forbeholdene væk"
  goer git push origin "$GREN"
fi
goer gh pr create --repo $REPO --base main --head "$GREN" \
  --title "release: $V er udgivet - forbeholdene væk" \
  --body "npm har $V. Denne PR synkroniserer kun PUBLICERET og de afledte sider (sync-tal.py)."
goer git checkout main
echo "✓ PR'en $GREN er oprettet. Videre til trin 7."
