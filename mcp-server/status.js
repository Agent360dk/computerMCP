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

export function statusStart({ session, client, version }) {
  fil = join(SESSIONS_DIR, `${session}.json`);
  tilstand = {
    session, pid: process.pid, client: client || null, version,
    started: new Date().toISOString(), updated: new Date().toISOString(),
    now: null, recent: []
  };
  skriv();
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
    const barn = spawn(bin, [], {
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
