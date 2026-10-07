// READONLY AFGOERES FOER SENDE-PORTEN.
//
// ⛔ 7/10 (panel R8, punkt J): i readonly afviser `decide` alle skrivende kald, men
//    sende-porten koerte foer: den laeste samtalen paa skaermen (`samtale`) og afviste
//    med sin egen grund. Loggen sagde «Send control could not be tied» om et kald der
//    var afvist af readonly. Nu: readonly-grunden, og ingen opslag for et kald der
//    alligevel ikke maa ske.
import './egen-tilstand.mjs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const WA = 'net.whatsapp.WhatsApp';
const HJ = lavFalskHjaelper('cmcp-readonly-foerst');
HJ.saetSvar({
  // WhatsApp ligger BAG (Finder forrest), saa ingen anden port afviser foer readonly.
  apps: { apps: [{ name: 'WhatsApp', bundleId: WA, pid: 4250, active: false }, { name: 'Finder', bundleId: 'com.apple.finder', pid: 4251, active: true }] },
  samtale: { recipient: 'Mor', field: { role: 'AXTextArea', value: 'hej', frame: { x: 0, y: 0, w: 400, h: 40 } }, window: 'Mor' },
  'press --dry': { would_press: { name: 'Send', role: 'AXButton', frame: { x: 410, y: 0, w: 30, h: 30 } } },
  at: { found: true, bundleId: WA, role: 'AXButton', title: 'Send', frame: { x: 410, y: 0, w: 30, h: 30 } },
});
const STATE = mkdtempSync(join(tmpdir(), 'cmcp-readonly-foerst-'));
const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], {
  env: { ...process.env, CMCP_MODE: 'readonly', CMCP_HELPER: HJ.sti, CMCP_STATE_DIR: STATE,
         CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1' },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise((r, rej) => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); setTimeout(() => rej(new Error('timeout ' + m)), 20000); });
try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ro', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const opslag = () => HJ.kald().map(k => k.argv.join(' '));
  for (const [navn, args] of [['computer_press', { app: 'WhatsApp', title: 'Send' }], ['computer_click', { app: 'WhatsApp', x: 420, y: 10 }]]) {
    const foer = opslag().length;
    const r = await rpc('tools/call', { name: navn, arguments: args });
    const t = r.result?.content?.[0]?.text || '';
    const nye = opslag().slice(foer);
    check(`${navn} i readonly afvises med readonly-grunden`, r.result?.isError === true && /readonly/.test(t), t.slice(0, 70).replace(/\s+/g, ' '));
    check(`${navn} i readonly: ingen samtale- eller toerkoersels-opslag`, !nye.some(a => /^samtale|--dry/.test(a)), nye.join(' | ') || 'ingen opslag');
    check(`${navn} i readonly: intet naaede hjaelperen som handling`, !nye.some(a => /^(press|click)\b/.test(a) && !/--dry/.test(a)));
  }
} finally {
  srv.kill(); rmSync(STATE, { recursive: true, force: true });
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
