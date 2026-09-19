// Flere agenter paa én maskine.
//
// En chat mere er en proces mere: hver MCP-klient starter sin egen server, og
// de skriver i SAMME log. To ting skal holde, ellers er "alt skrives ned" kun
// sandt for den foerste af dem:
//
//   1. Linjerne maa ikke blande sig i hinanden. To processer der skriver
//      samtidig uden O_APPEND giver halve linjer, og en halv linje i et
//      revisionsspor er vaerre end ingen linje - den ser hel ud.
//   2. Man skal kunne se HVEM der gjorde hvad. Atten linjer uden afsender
//      besvarer ikke spoergsmaalet loggen findes for.
//
// Proeven koerer i readonly: handlingen afvises, men revisionslinjen skrives
// foerst - og det er linjen vi maaler.
//
// MUTATIONSBEVIS 19/9 - koert, ikke husket:
//   mutation A: hver linje skrevet som TO appendFileSync i traek
//               -> BESTAAET. Mutationen var for svag: to synkrone appends i
//                  samme proces naar aldrig at blive afbrudt af den anden.
//   mutation B: samme, men med 6 ms doedvande imellem
//               -> DUMPET, 14 af 50 linjer uden for JSON.
//
// ⛔ Laeren af A: denne proeve er en SANDSYNLIGHEDS-vagt, ikke et bevis. Den
//    fanger flossede linjer naar racen faktisk sker. En regression der kun
//    aabner et mikrosekunds vindue, kan slippe forbi en enkelt koersel.
//    Vil man vaere sikker, er svaret O_APPEND i kernen - som er praecis det
//    `appendFileSync` giver os, og derfor det vagten findes for at beskytte.
import { spawn } from 'child_process';
import { readFileSync, existsSync, mkdtempSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = mkdtempSync(join(tmpdir(), 'cmcp-concurrent-'));
const AUDIT = join(STATE, 'audit.jsonl');
const PER_SERVER = 25;

// ⛔ FALSK HJAELPER (19/9): denne proeve beder om en AEGTE handling og regner
//    med at porten afviser den. Holder porten ikke, ville handlingen lande paa
//    menneskets skaerm - og proeven findes jo netop for det tilfaelde. Med
//    `CMCP_HELPER` peget paa en attrap kan en roed port ikke naa skaermen, og
//    proeven kan stadig se at handlingen kom.
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';
// Disse proever koerer i readonly og naar aldrig en dialog - men en attrap
// koster intet og fjerner den sidste vej hvor en boks kunne dukke op.
const spoergerAttrap = lavFalskSpoerger('udloeb');
const attrap = lavFalskHjaelper('cmcp-concurrent');

const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

function client(env) {
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')],
    { env: { ...process.env, CMCP_MODE: 'readonly', CMCP_STATE_DIR: STATE,
              CMCP_HELPER: attrap.sti,
              CMCP_OSASCRIPT: spoergerAttrap.sti, ...env },
      stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const pending = new Map(); let id = 0;
  srv.stdout.on('data', d => { buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!l.trim()) continue; try { const m = JSON.parse(l);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} } });
  const rpc = (method, params = {}) => new Promise((res, rej) => {
    const my = ++id; pending.set(my, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
    setTimeout(() => { if (pending.has(my)) { pending.delete(my); rej(new Error('timeout ' + method)); } }, 60000);
  });
  return { srv, rpc, async ready() {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '1' } });
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }};
}

const a = client({ CMCP_CLIENT: 'chat-a' });
const b = client({ CMCP_CLIENT: 'chat-b' });
await Promise.all([a.ready(), b.ready()]);

// Begge skriver paa én gang, fletvis, saa skrivningerne faktisk overlapper.
const work = [];
for (let i = 0; i < PER_SERVER; i++) {
  work.push(a.rpc('tools/call', { name: 'computer_key', arguments: { combo: 'escape' } }));
  work.push(b.rpc('tools/call', { name: 'computer_key', arguments: { combo: 'escape' } }));
}
await Promise.all(work);
a.srv.kill(); b.srv.kill();
await new Promise(r => setTimeout(r, 400));

check('loggen blev skrevet', existsSync(AUDIT), AUDIT);
const raw = existsSync(AUDIT) ? readFileSync(AUDIT, 'utf8').trim().split('\n').filter(Boolean) : [];

// 1. ingen halve linjer
let parsed = [], broken = 0;
for (const l of raw) { try { parsed.push(JSON.parse(l)); } catch { broken++; } }
check('ingen linje blev klippet midt over', broken === 0 && raw.length === PER_SERVER * 2,
      `${raw.length} linjer, ${broken} uden for JSON (ventede ${PER_SERVER * 2})`);

// 2. hver linje siger hvem der skrev den
const missing = parsed.filter(e => !e.session).length;
check('hver linje baerer et afsender-maerke', missing === 0, `${missing} uden session`);

// 3. og de TO servere er ikke det samme maerke. Uden dette tjek ville
//    "skriv altid den samme konstant" bestaa proeve 2.
const sessions = [...new Set(parsed.map(e => e.session).filter(Boolean))];
check('de to servere kan skelnes fra hinanden', sessions.length === 2, sessions.join(', '));

// 4. klientnavnet foelger med, saa loggen kan laeses uden at kende uuid'erne
const clients = [...new Set(parsed.map(e => e.client).filter(Boolean))].sort();
check('klientnavnet staar i linjen', clients.join(',') === 'chat-a,chat-b', clients.join(', ') || 'ingen');

// 5. og hver server skrev sin halvdel - ikke den ene det hele
const counts = sessions.map(s => parsed.filter(e => e.session === s).length);
check('begge servere naaede at skrive', counts.length === 2 && counts.every(c => c === PER_SERVER),
      counts.join(' + '));

console.log();
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
