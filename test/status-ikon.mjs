// Menulinje-ikonet: viser det de agenter der koerer, og hvad de goer?
//
// Tilfoejet 22/9. Proeven starter to rigtige servere og maaler ikonets menu
// gennem `cmcp-status --dump` - samme kode bygger teksten til den rigtige
// menu, men --dump viser intet paa skaermen. Selve ikonet startes ALDRIG her:
// CMCP_STATUS_IKON=0 for begge servere.
//
// Fire ting skal holde:
//   1. Begge agenter staar i menuen, med hver sit klientnavn.
//   2. Live-teksten siger hvad der skete, og om det blev afvist.
//   3. Det der blev tastet, staar ALDRIG i statusfilen eller i menuen.
//   4. En agent der stopper, forsvinder - ogsaa en der blev draebt uden
//      at naa at rydde op efter sig.
import { spawn, execFileSync } from 'child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Ingen proeve maa saette et ikon i menneskets menulinje - heller ikke koert uden run-all.sh.
process.env.CMCP_STATUS_IKON = '0';
const STATE = mkdtempSync(join(tmpdir(), 'cmcp-status-'));
const IKON = join(ROOT, 'mcp-server', 'vendor', 'ComputerMCPStatus.app', 'Contents', 'MacOS', 'cmcp-status');
const spoergerAttrap = lavFalskSpoerger('udloeb');
const attrap = lavFalskHjaelper('cmcp-status');

const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

function client(klientnavn, ekstra = {}) {
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')],
    { env: { ...process.env, CMCP_MODE: 'readonly', CMCP_STATE_DIR: STATE,
              CMCP_HELPER: attrap.sti, CMCP_OSASCRIPT: spoergerAttrap.sti,
              CMCP_STATUS_IKON: '0', ...ekstra },
      stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', fejl = ''; const pending = new Map(); let id = 0;
  srv.stderr.on('data', d => { fejl += d; });
  srv.stdout.on('data', d => { buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!l.trim()) continue; try { const m = JSON.parse(l);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} } });
  const rpc = (method, params = {}) => new Promise((res, rej) => {
    const my = ++id; pending.set(my, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
    setTimeout(() => { if (pending.has(my)) { pending.delete(my); rej(new Error('timeout ' + method)); } }, 60000);
  });
  return { srv, rpc, stderr: () => fejl, async ready() {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: klientnavn, version: '1' } });
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }};
}

const dump = () => JSON.parse(execFileSync(IKON, ['--dump'], { env: { ...process.env, CMCP_STATE_DIR: STATE } }).toString());
const vent = ms => new Promise(r => setTimeout(r, ms));

check('ikonet er bygget', existsSync(IKON), IKON);

const HEMMELIG = 'hemmelig-' + Math.random().toString(36).slice(2, 10);
const a = client('chat-alfa');
const b = client('chat-beta');
await Promise.all([a.ready(), b.ready()]);

await a.rpc('tools/call', { name: 'computer_type', arguments: { text: HEMMELIG, app: 'Notes' } });
await b.rpc('tools/call', { name: 'computer_apps', arguments: {} });
await vent(200);

const d1 = dump();
check('overskriften siger to agenter', d1.title === 'Computer MCP — 2 agents running', d1.title);
check('begge agenter staar i menuen med hver sit klientnavn',
      d1.items.some(i => i.startsWith('chat-alfa')) && d1.items.some(i => i.startsWith('chat-beta')),
      JSON.stringify(d1.items));
const liveA = d1.live.find(t => t.startsWith('chat-alfa')) || '';
check('live-teksten siger hvad agenten gjorde', /Type \d+ characters/.test(liveA), liveA.split('\n')[2]);
check('...og at det blev afvist', /⊘ .*Type \d+ characters/.test(liveA), liveA.split('\n')[2]);
const liveB = d1.live.find(t => t.startsWith('chat-beta')) || '';
check('en laesning staar ogsaa, som ✓', /✓ .*apps/.test(liveB), liveB.split('\n')[2]);

// 3. Det tastede maa ikke staa nogen steder ikonet kan se.
const filer = readdirSync(join(STATE, 'sessions')).map(f => readFileSync(join(STATE, 'sessions', f), 'utf8')).join('\n');
check('det tastede staar ikke i statusfilerne', !filer.includes(HEMMELIG), `${filer.length} tegn gennemsoegt`);
check('...og ikke i ikonets menu eller live-tekst', !JSON.stringify(d1).includes(HEMMELIG));
check('filerne kan kun laeses af ejeren',
      readdirSync(join(STATE, 'sessions')).every(f =>
        (parseInt(execFileSync('stat', ['-f', '%Lp', join(STATE, 'sessions', f)]).toString().trim(), 8) & 0o077) === 0));

check('serveren siger selv at ikonet er slaaet fra', /status-icon=disabled/.test(a.stderr()), a.stderr().trim().split('\n').pop());

// 4a. Stoppet paent: filen fjernes, agenten forsvinder.
a.srv.kill('SIGTERM');
await vent(500);
const d2 = dump();
check('en stoppet agent forsvinder fra menuen', d2.items.length === 1 && d2.items[0].startsWith('chat-beta'), JSON.stringify(d2.items));

// 4b. Draebt uden oprydning: filen bliver liggende, men ikonet ser at processen er doed.
b.srv.kill('SIGKILL');
await vent(500);
const tilbage = readdirSync(join(STATE, 'sessions')).filter(f => f.endsWith('.json')).length;
const d3 = dump();
check('en draebt agent forsvinder ogsaa, selv om dens fil er efterladt',
      d3.items.length === 0 && tilbage >= 1, `${tilbage} fil(er) efterladt, ${d3.items.length} i menuen`);
check('og overskriften siger nul', d3.title === 'Computer MCP — 0 agents running', d3.title);

// 5. ⛔ Sikkerhedskonsulenten 22/9, Critical: en agent maa ikke kunne trykke i
//    ikonets egen menu med vores eget vaerktoej. Maalt i den mest aabne
//    tilstand der findes: allow, baggrund slaaet fra, og en spoerger der
//    svarer JA. Uden vagten ville kaldet gaa hele vejen igennem.
const jaSpoerger = lavFalskSpoerger('ja', 'cmcp-status-ja');
const aaben = lavFalskHjaelper('cmcp-status-aaben');
const c = client('chat-gamma', { CMCP_MODE: 'allow', CMCP_BACKGROUND: '0',
                                 CMCP_HELPER: aaben.sti, CMCP_OSASCRIPT: jaSpoerger.sti });
await c.ready();
const HEMMELIG2 = 'soegning-' + Math.random().toString(36).slice(2, 10);
const forsoeg = [
  { name: 'computer_press', arguments: { app: 'dk.agent360.computer-mcp.status', contains: 'Tillad' } },
  { name: 'computer_press', arguments: { app: 'Computer MCP', role: 'AXMenuBarItem' } },
  { name: 'computer_menu', arguments: { app: 'computer mcp', path: 'Computer MCP > Hide' } },
];
const svar = [];
for (const f of forsoeg) svar.push(await c.rpc('tools/call', f));
check('et tryk i ikonets egen menu afvises, ogsaa i allow med et ja-svar klar',
      svar.every(r => r.result?.isError && /status icon can never be the target/.test(r.result.content[0].text)),
      svar.map(r => (r.result?.content?.[0]?.text || '').slice(0, 60)).join(' | '));
check('...uden at mennesket blev spurgt', jaSpoerger.gangeSpurgt() === 0, `${jaSpoerger.gangeSpurgt()} gange`);
check('...og uden at noget naaede hjaelperen',
      !aaben.kald().some(k => ['press', 'menu-click'].includes(k.argv[0])),
      JSON.stringify(aaben.kald().map(k => k.argv[0])));
// Og modellens soegetekst maa ikke staa i statusen - loggen fingeraftrykker den.
await c.rpc('tools/call', { name: 'computer_press', arguments: { app: 'Finder', contains: HEMMELIG2 } });
await vent(200);
const cfil = readdirSync(join(STATE, 'sessions')).map(f => readFileSync(join(STATE, 'sessions', f), 'utf8')).join('\n');
check('modellens soegetekst staar ikke i statusen', !cfil.includes(HEMMELIG2) && /Press an element in Finder/.test(cfil),
      cfil.match(/Press[^"]*/)?.[0] || 'ingen Press-linje');
c.srv.kill('SIGTERM');
await vent(300);

attrap.ryd?.(); spoergerAttrap.ryd?.();
if (fails.length) { console.log(`\n${fails.length} DUMPET`); process.exit(1); }
console.log('\nBESTAAET');
