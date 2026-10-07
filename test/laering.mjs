// LÆRINGSFILEN: computer_learning skriver én linje lokalt, renset for tal og
// mailadresser, og sender intet af sig selv.
//
// ⛔ HVORFOR DEN FINDES (28/9-2026)
//    Gustav: «lav en learningsfil som alles computermcp kan opdatere, så vi ser den
//    og kan forbedre computermcp». Samme dag gav agenten op tre steder, hvor der
//    fandtes en vej videre, og intet sted blev det skrevet ned. Prøven sikrer at
//    læringen lander i filen, at en persons nummer og mail aldrig gør, og at
//    svaret siger ærligt at intet er sendt.
import './egen-tilstand.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const STATE = mkdtempSync(join(tmpdir(), 'cmcp-laering-'));
const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')],
  // Attrap-spoerger (husets vagt 26): ingen proeve maa kunne rejse en aegte macOS-dialog.
  { env: { ...process.env, CMCP_STATE_DIR: STATE, CMCP_STATUS_IKON: '0', CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-laering').sti }, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
const kald = async (navn, args) => { const r = await rpc('tools/call', { name: navn, arguments: args }); const t = r.result?.content?.[0]?.text ?? ''; let d = null; try { d = JSON.parse(t); } catch {} return { fejl: !!r.result?.isError, tekst: t, data: d }; };

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'laering', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const vaerktoejer = (await rpc('tools/list')).result?.tools || [];
  check('1 værktøjet findes', vaerktoejer.some(t => t.name === 'computer_learning'));
  const vejl = (await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } })).result?.instructions || '';
  check('1b vejledningen peger på det, når et trin intet gjorde', /computer_learning/.test(vejl));

  const r = await kald('computer_learning', {
    kind: 'workaround', app: 'net.whatsapp.WhatsApp', tool: 'computer_set_value',
    what: 'set_value put "Benjamin" in the search field of the chat with +45 60 17 45 69 and nothing was searched; mail benjamin@example.com',
    worked: 'press the field, then computer_type'
  });
  const fil = join(STATE, 'learnings.jsonl');
  const linjer = existsSync(fil) ? readFileSync(fil, 'utf8').trim().split('\n') : [];
  const sidste = linjer.length ? JSON.parse(linjer.at(-1)) : {};
  check('2 læringen står i filen ved siden af revisionsloggen', !r.fejl && linjer.length === 1 && sidste.worked === 'press the field, then computer_type', `${linjer.length} linje(r)`);
  check('2b et telefonnummer når aldrig filen', !/60 17 45 69|60174569/.test(readFileSync(fil, 'utf8')), sidste.what);
  check('2c en mailadresse når aldrig filen', !/benjamin@example\.com/.test(readFileSync(fil, 'utf8')));
  check('2d svaret siger at intet er sendt', /nothing was sent/.test(r.data?.note || ''), r.data?.note);
  check('2e svaret har et færdigt delelink til GitHub', /^https:\/\/github\.com\/Agent360dk\/computerMCP\/issues\/new\?title=/.test(r.data?.share || ''));
  check('2f delelinket bærer heller ikke nummeret', !/60%2017%2045%2069|60174569/.test(r.data?.share || ''));

  const r2 = await kald('computer_learning', { what: '   ' });
  check('3 en tom læring afvises', r2.fejl, r2.tekst.slice(0, 80));
  const r3 = await kald('computer_learning', { what: 'a second one', kind: 'missing' });
  check('3b den næste lægges til, den første står der stadig', r3.data?.entries === 2, `${r3.data?.entries} linjer`);
} finally {
  srv.kill();
  rmSync(STATE, { recursive: true, force: true });
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
