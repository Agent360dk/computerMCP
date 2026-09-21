# ⛔ DENNE FIL ER TIL REGISTRENES INTROSPEKTIONS-SANDKASSE. INTET ANDET.
#
#    Computer MCP styrer en Mac. I en Linux-container er der ingen Mac, ingen
#    tilgaengeligheds-API og ingen skaerm - hjaelper-binaeren kan ikke koere,
#    og hvert eneste vaerktoej vil fejle hvis man kalder det.
#
#    Hvorfor den saa findes: Glama og lignende kataloger bygger hver server i
#    en Linux-sandkasse og spoerger den «hvilke vaerktoejer har du». Svaret
#    bliver til den kvalitets-karakter listerne kraever. MAALT 21/9-2026:
#    uden en Dockerfile udleder Glama selv én, vores fejlede, og siden stod
#    «Not graded» - hvilket igen spaerrede optagelsen paa awesome-mcp-servers.
#
#    MAALT samme dag: med CMCP_HELPER sat til en sti der ikke findes, starter
#    serveren og svarer `tools/list` med alle 28 vaerktoejer. Introspektion
#    kraever ikke en Mac; det goer kun BRUGEN.
#
#    ⛔ Koer den ikke i produktion. Der er ingen maskine at styre herinde.
FROM node:22-slim

WORKDIR /app
COPY mcp-server/package.json mcp-server/package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
COPY mcp-server/ ./

# Siger hoejt at hjaelperen ikke findes her, saa serveren ikke leder efter en
# binaer der aldrig kan koere paa Linux.
#
# ⛔ SAET IKKE CMCP_MODE HER. MAALT 21/9: readonly viser 12 vaerktoejer,
#    standarden viser 28 - og det er tallet katalogets karakter bygges paa.
#    Et forsoeg paa at vaere forsigtig her ville give praecis det forkerte tal
#    vi er ved at rette.
ENV CMCP_HELPER=/nonexistent

CMD ["node", "index.js"]
