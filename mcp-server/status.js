// Hvad goer agenten LIGE NU? Til menulinje-ikonet.
//
// Tilfoejet 22/9 efter Gustavs oenske: et ikon der viser at computer-mcp koerer,
// en rullemenu hvor man vaelger hvilken agent, og live-tekst med hvad den goer.
//
// Hver server skriver EEN fil: sessions/<session>.json. Ikonet laeser mappen.
// Ingen socket, ingen port, ingen ny vej ind i serveren: ikonet kan kun LAESE,
// og filen kan intet godkende.
//
// ⛔ Teksten bygges af `liveTekst()` i index.js: skrivning vises som laengder
//    («Type 42 characters»), og tryk og menuer kun med programmets navn -
//    aldrig modellens soegetekst. Rettet 22/9: her stod at describe() aldrig
//    viser indhold. Det var kun sandt for type/paste/set_value.
import { writeFileSync, renameSync, unlinkSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

const DIR = process.env.CMCP_STATE_DIR || join(homedir(), '.local', 'state', 'computer-mcp');
export const SESSIONS_DIR = join(DIR, 'sessions');
const HISTORIK = 20;
export const STATUS_IKON_ID = 'dk.agent360.computer-mcp.status';

let tilstand = null;
let fil = null;

function skriv() {
  if (!tilstand) return;
  try {
    if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
    // Skrevet til en midlertidig fil og flyttet: ikonet maa aldrig laese en
    // halv fil, og en omdoebning er atomisk paa samme disk.
    const tmp = fil + '.tmp';
    writeFileSync(tmp, JSON.stringify(tilstand), { mode: 0o600 });
    renameSync(tmp, fil);
  } catch { /* status er pynt ved siden af arbejdet - den maa aldrig vaelte et kald */ }
}

/// ⛔ MAALT 23/9: 34 statusfiler, 15 levende processer, 19 efterladte fra
///    chats der blev lukket haardt. De taelles ikke med (ikonet tjekker pid),
///    men de bliver liggende for evigt. Hver server rydder derfor op efter de
///    doede, naar den selv starter.
function ryddDoede() {
  try {
    for (const f of readdirSync(SESSIONS_DIR)) {
      if (!f.endsWith('.json')) continue;
      const sti = join(SESSIONS_DIR, f);
      try {
        const d = JSON.parse(readFileSync(sti, 'utf8'));
        try { process.kill(d.pid, 0); } catch (e) { if (e.code !== 'EPERM') unlinkSync(sti); }
      } catch { unlinkSync(sti); }   // ulaeselig fil er ogsaa affald
    }
  } catch { /* oprydning maa aldrig vaelte en opstart */ }
}

export function statusStart({ session, client, version }) {
  fil = join(SESSIONS_DIR, `${session}.json`);
  tilstand = {
    session, pid: process.pid, client: client || null, version,
    started: new Date().toISOString(), updated: new Date().toISOString(),
    now: null, recent: []
  };
  skriv();
  ryddDoede();
  const ryd = () => { try { unlinkSync(fil); } catch {} };
  process.on('exit', ryd);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { ryd(); process.exit(0); });
  }
}

/// En handling er begyndt, eller afvist foer den begyndte.
export function statusHandling(tekst, udfald) {
  if (!tilstand) return;
  const post = { ts: new Date().toISOString(), text: String(tekst).slice(0, 160), outcome: udfald };
  tilstand.recent.push(post);
  if (tilstand.recent.length > HISTORIK) tilstand.recent.shift();
  tilstand.now = udfald === 'running' ? post : null;
  tilstand.updated = post.ts;
  skriv();
}

/// Den handling der koerer nu, er faerdig.
export function statusFaerdig(udfald) {
  if (!tilstand) return;
  const sidste = tilstand.recent[tilstand.recent.length - 1];
  if (sidste && sidste.outcome === 'running') sidste.outcome = udfald;
  tilstand.now = null;
  tilstand.updated = new Date().toISOString();
  skriv();
}

/// Start ikonet, hvis det ikke allerede koerer.
///
/// ⛔ Slaaes fra med CMCP_STATUS_IKON=0, og proeverne GOER det: et ikon der
///    dukker op i menneskets menulinje hver gang en proeve starter en server,
///    er praecis den slags forstyrrelse produktet lover ikke at lave.
export function startIkon(vendorDir) {
  if (process.env.CMCP_STATUS_IKON === '0') return 'disabled';
  const bin = join(vendorDir, 'ComputerMCPStatus.app', 'Contents', 'MacOS', 'cmcp-status');
  if (!existsSync(bin)) return 'missing';
  try {
    const pidFil = join(DIR, 'status.pid');
    if (existsSync(pidFil)) {
      const pid = Number(readFileSync(pidFil, 'utf8'));
      if (pid > 0) { try { process.kill(pid, 0); return 'running'; } catch {} }
    }
  } catch {}
  try {
    // ⛔ MAALT 23/9: at starte programmet direkte TOG FOKUS - ogsaa uden vindue
    //    og uden boks. Hver gang en server startede ikonet, mistede mennesket
    //    sit forreste program. `open -g -j` er macOS' egen vej til at starte et
    //    program uden at det kommer frem: -g = ikke i forgrunden, -j = skjult.
    const app = bin.replace(/\/Contents\/MacOS\/[^/]+$/, '');
    // ⛔ `open` sender IKKE vores miljoe videre til programmet - det arver
    //    launchd's. Uden `--env` ville ikonet laese den forkerte state-mappe,
    //    og proever med en midlertidig mappe ville se paa menneskets rigtige.
    const barn = spawn('/usr/bin/open', ['-g', '-j', '--env', `CMCP_STATE_DIR=${DIR}`, '-a', app], {
      detached: true, stdio: 'ignore',
      env: { ...process.env, CMCP_STATE_DIR: DIR }
    });
    barn.unref();
    return 'started';
  } catch { return 'failed'; }
}

/// MCP-klientens eget navn (fx «claude-code»), saa rullemenuen kan skelne agenter.
export function statusKlient(navn) {
  if (!tilstand || tilstand.client === navn) return;
  tilstand.client = String(navn).slice(0, 60);
  skriv();
}
