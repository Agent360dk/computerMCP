// README'S LOG-UDDRAG KOMMER FRA EN RIGTIG KOERSEL - ALDRIG FRA NOGENS EGEN LOG (punkt L).
//
// ⛔ 7/10 (panel R8-R9): «proof, not promises» kraever at README viser loggen som den
//    er. Uddraget maa ikke komme fra et menneskes rigtige revisionslog (den beskriver
//    hans maskine), og det maa ikke vaere skrevet i haanden. Scriptet koerer den
//    rigtige server i en tom, midlertidig mappe, med en hjaelper og en spoerger der
//    ikke kan roere skaermen, og gemmer loggen som test/fixtures/audit-readme.jsonl.
//    test/readme-log.mjs kraever at README-uddraget staar byte for byte i den fil, og
//    at filens kaede holder.
//
//      node scripts/log-uddrag.mjs        # skriver fixturen og README-blokken igen
//
//    Koeres ved hvert versionsloeft: linjen med spoergsmaalet baerer serverens version,
//    og proeven kraever at den er pakkens. Blokken skrives i BEGGE README'er (repoets og
//    npm's), saa claims 45 stadig ser dem som een.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger, lavStandinIkon } from '../test/falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UD = join(ROOT, 'test', 'fixtures', 'audit-readme.jsonl');
const STATE = mkdtempSync(join(tmpdir(), 'cmcp-log-uddrag-'));
const h = lavFalskHjaelper('cmcp-log-uddrag');
h.saetSvar({
  // Mennesket arbejder i Safari; agenten skriver i TextEdit bag ved.
  apps: { apps: [{ name: 'Safari', bundleId: 'com.apple.Safari', pid: 500, active: true },
                 { name: 'TextEdit', bundleId: 'com.apple.TextEdit', pid: 501, active: false },
                 { name: 'Finder', bundleId: 'com.apple.finder', pid: 502, active: false },
                 { name: '1Password', bundleId: 'com.1password.1password', pid: 503, active: false }] },
});
// Ingen svarer: et udloeb er et nej, og det er det loggen skal vise.
const sp = lavFalskSpoerger('udloeb', 'cmcp-log-uddrag-sp');
// Standardopsaetningen har menulinje-ikonet: spoergsmaalet gaar dertil. Attrappen
// tager imod og svarer aldrig (som et menneske der ikke er der).
mkdirSync(STATE, { recursive: true, mode: 0o700 });
const ikon = createServer(sock => { sock.on('data', () => {}); sock.on('error', () => {}); });
await new Promise(r => ikon.listen(join(STATE, 'ikon.sock'), r));
// Maalingen laeser ikonets version paa det ikon der ejer tilstandsmappen (status.pid):
// et stand-in med pakkens version - aldrig menneskets rigtige ikon (Astra R10).
const VERSION = JSON.parse(readFileSync(join(ROOT, 'mcp-server', 'package.json'), 'utf8')).version;
const standin = lavStandinIkon(STATE, VERSION);

const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], {
  env: { ...process.env, CMCP_STATE_DIR: STATE, CMCP_HELPER: h.sti, CMCP_OSASCRIPT: sp.sti, CMCP_ASK_TIMEOUT: '1',
         CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1', CMCP_MODE: 'allow' },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise((r, rej) => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); setTimeout(() => rej(new Error('timeout ' + m)), 30000); });
try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'readme-example', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  for (const [name, args] of [
    ['computer_apps', {}],
    ['computer_type', { app: 'TextEdit', text: 'Dear Anna, the meeting moves to 3 pm.' }],
    ['computer_menu', { app: 'Finder', path: 'File > Move to Trash' }],
    ['computer_type', { app: '1Password', text: 'hunter2' }],
  ]) {
    const r = await rpc('tools/call', { name, arguments: args });
    console.log(`${name}: ${(r.result?.content?.[0]?.text || '').split('\n')[0].slice(0, 90)}`);
  }
} finally { srv.kill(); ikon.close(); standin.stop(); }
const log = readFileSync(join(STATE, 'audit.jsonl'), 'utf8');
writeFileSync(UD, log);
rmSync(STATE, { recursive: true, force: true });
const linjer = log.trim().split('\n');
console.log(`\n${linjer.length} linjer skrevet til ${UD.slice(ROOT.length + 1)}`);

// README-blokken: fra agentens foerste skrivning til enden - uredigeret.
const fra = linjer.findIndex(l => l.includes('"tool":"computer_type"'));
const blok = '<!-- log-uddrag:start -->\n```jsonl\n' + linjer.slice(fra).join('\n') + '\n```\n<!-- log-uddrag:end -->';
for (const f of ['README.md', join('mcp-server', 'README.md')]) {
  const sti = join(ROOT, f), s = readFileSync(sti, 'utf8');
  const m = s.match(/<!-- log-uddrag:start -->[\s\S]*?<!-- log-uddrag:end -->/g);
  if (m?.length !== 1) { console.error(`${f}: fandt ${m?.length || 0} log-uddrag-blokke (skal vaere 1)`); process.exit(1); }
  writeFileSync(sti, s.replace(m[0], () => blok));
  console.log(`${f}: blokken skrevet (${linjer.length - fra} linjer)`);
}
