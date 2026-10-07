// HVERT SPOERGSMAAL I MENULINJEN FAAR SIN MAALING I LOGGEN (punkt P).
//
// ⛔ 7/10 (panel R8-R9): «1 af 23 besvaret» kunne ikke efterproeves - loggen gemte
//    intet om inputaktivitet, versioner eller hvad der blev vist. Proeven koerer en
//    rigtig server mod et FALSK ikon i en midlertidig mappe (aldrig menneskets
//    ikon.sock) og en falsk hjaelper hvis `idle` proeven selv bestemmer.
import './egen-tilstand.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'mcp-server', 'package.json'), 'utf8')).version;
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const D = mkdtempSync(join(tmpdir(), 'cmcp-tilstede-'));
const STATE = join(D, 'state');
const IDLE = join(D, 'idle.txt');
const STUB = join(D, 'stub.sh');
writeFileSync(STUB, `#!/bin/sh
case "$1" in
  idle) cat ${IDLE} ;;
  apps) echo '{"ok":true,"apps":[{"bundleId":"com.apple.finder","name":"Finder","pid":4242,"active":false}]}' ;;
  menus) echo '{"ok":true,"menus":[]}' ;;
  *) echo '{"ok":true}' ;;
esac
`);
chmodSync(STUB, 0o755);
// null = hjaelperen svarer uden et tal; 'fejl' = hjaelperen svarer slet ikke med JSON.
const idle = (v) => writeFileSync(IDLE, v === 'fejl' ? 'ikke json' : JSON.stringify(v === null ? { ok: true } : { ok: true, idle: v }));

// Ikonet svarer efter `svar` - null betyder: svar aldrig (udloeb).
let svar = null;
const { mkdirSync } = await import('node:fs');
mkdirSync(STATE, { recursive: true, mode: 0o700 });
const ikon = createServer(sock => {
  let buf = '';
  sock.on('data', d => {
    buf += d; const i = buf.indexOf('\n'); if (i < 0) return;
    const q = JSON.parse(buf.slice(0, i));
    // Idle skifter et halvt sekund EFTER spoergsmaalet er stillet (maalingen ved start
    // er saa faerdig), og svaret kommer lidt efter - saa ask og end kan skelnes.
    const s = svar;
    setTimeout(() => { if (s && 'slutIdle' in s) idle(s.slutIdle); }, 500);
    setTimeout(() => { if (s?.svar) sock.write(JSON.stringify({ nonce: q.nonce, ...s.svar }) + '\n'); }, 700);
  });
  sock.on('error', () => {});
});
await new Promise(r => ikon.listen(join(STATE, 'ikon.sock'), r));

const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], {
  env: { ...process.env, CMCP_STATE_DIR: STATE, CMCP_MODE: 'allow', CMCP_HELPER: STUB, CMCP_ASK_TIMEOUT: '2',
         CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1' },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise((r, rej) => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); setTimeout(() => rej(new Error('timeout ' + m)), 30000); });
const vent = ms => new Promise(r => setTimeout(r, ms));
const sidsteMenubar = () => readFileSync(join(STATE, 'audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  .filter(l => l.asker === 'menubar').pop();
const kald = { name: 'computer_menu', arguments: { app: 'Finder', path: 'File > Move to Trash' } };

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'tilstede', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // 1. Ja: idle ved spoergsmaal er tallet, slut er «answered».
  idle(12.5); svar = { svar: { ok: true, verified: 'owner' }, slutIdle: 0.4 };
  await rpc('tools/call', kald);
  let l = sidsteMenubar(), p = l?.presence;
  check('1 ja: maalingen staar paa loglinjen', !!p && l.decision === 'allowed', JSON.stringify(p));
  check('1 ja: idle_at_ask er det maalte tal', p?.idle_at_ask === 12.5);
  check('1 ja: idle_at_end er «answered» (ingen ny idle efter et svar)', p?.idle_at_end === 'answered');
  check('1 ja: serverens version', p?.server === VERSION, String(p?.server));
  check('1 ja: box er on/off, flade afledt af box og sessioner', ['on', 'off'].includes(p?.box)
        && p?.surface_derived === (p?.box === 'on' && p?.sessions > 0 ? 'box+menu' : 'menu'), `${p?.box} ${p?.sessions} ${p?.surface_derived}`);
  check('1 ja: ikonets version er en tekst (maalt paa det koerende ikon)', typeof p?.icon === 'string' && p.icon.length > 0, String(p?.icon));

  // 2. Udloeb (ingen svarer): idle ved slut maales - det tal der fortaeller om nogen var der.
  idle(3); svar = { svar: null, slutIdle: 47 };
  await rpc('tools/call', kald);
  l = sidsteMenubar(); p = l?.presence;
  check('2 udloeb: idle_at_ask og idle_at_end er begge maalt', p?.idle_at_ask === 3 && p?.idle_at_end === 47 && l.decision === 'denied', JSON.stringify(p));

  // 3. Hjaelperen kan ikke svare paa idle: «unreadable», aldrig et gaet.
  idle(null); svar = { svar: null, slutIdle: 'fejl' };
  await rpc('tools/call', kald);
  l = sidsteMenubar(); p = l?.presence;
  check('3 ulaeselig idle: «unreadable», ikke et tal', p?.idle_at_ask === 'unreadable' && p?.idle_at_end === 'unreadable', JSON.stringify(p));

  // 4. Nej (sidst - et nej giver 30 s pause for naeste spoergsmaal).
  idle(8); svar = { svar: { ok: false }, slutIdle: 1.5 };
  await rpc('tools/call', kald);
  l = sidsteMenubar(); p = l?.presence;
  check('4 nej: idle_at_end maalt efter svaret', p?.idle_at_ask === 8 && p?.idle_at_end === 1.5 && l.decision === 'denied', JSON.stringify(p));

  // 5. Kaeden holder med de nye felter.
  const a = await rpc('tools/call', { name: 'computer_audit', arguments: { limit: 5 } });
  const t = a.result?.content?.[0]?.text || '';
  check('5 revisionsloggens kaede er intakt', /intact across/.test(t), (t.match(/(intact|BROKEN|UNKNOWN)[^"\n]{0,40}/) || [''])[0]);
  check('5 maalingen baerer ingen tekst ud over tal, versioner og til/fra',
        Object.values(sidsteMenubar().presence).every(v => v === null || typeof v === 'number' || /^[\w. +-]{0,40}$/.test(String(v))));
  // 6. Skaermlaanet (15 af de 22 udloebne 30/9-4/10 var laan) maales ogsaa. Egen
  //    server, saa nej'et i 4 ikke giver pause her.
  const srv2 = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], {
    env: { ...process.env, CMCP_STATE_DIR: STATE, CMCP_MODE: 'allow', CMCP_HELPER: STUB, CMCP_ASK_TIMEOUT: '2',
           CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf2 = '', n2 = 0; const w2 = new Map();
  srv2.stdout.on('data', d => { buf2 += d; let i; while ((i = buf2.indexOf('\n')) >= 0) { const x = buf2.slice(0, i); buf2 = buf2.slice(i + 1); try { const m = JSON.parse(x); w2.get(m.id)?.(m); } catch {} } });
  const rpc2 = (m, q) => new Promise((r, rej) => { const id = ++n2; w2.set(id, r); srv2.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: q }) + '\n'); setTimeout(() => rej(new Error('timeout ' + m)), 30000); });
  try {
    await rpc2('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'tilstede-laan', version: '1' } });
    srv2.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    idle(20); svar = { svar: { ok: false }, slutIdle: 2 };
    await rpc2('tools/call', { name: 'computer_request_screen', arguments: { action: 'request', reason: 'proeve', minutes: 1 } });
    const laan = readFileSync(join(STATE, 'audit.jsonl'), 'utf8').trim().split('\n').map(x => JSON.parse(x))
      .filter(x => x.tool === 'computer_request_screen' && x.asker === 'menubar').pop();
    check('6 skaermlaan: maalingen staar paa laanets loglinje', laan?.presence?.idle_at_ask === 20 && laan?.presence?.idle_at_end === 2,
          JSON.stringify(laan?.presence || laan || 'ingen linje'));
  } finally { srv2.kill(); }
} catch (e) {
  check('proeven koerte', false, e.message);
} finally {
  srv.kill(); ikon.close(); rmSync(D, { recursive: true, force: true });
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
