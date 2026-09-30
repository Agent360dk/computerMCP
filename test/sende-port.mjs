// SENDE-PORTEN: kan en besked til et rigtigt menneske gaa ud, uden at mennesket
// saa HVEM og HVAD - og sagde ja til netop den?
//
// ⛔ HVORFOR DEN FINDES (29/9-2026, dommen 28/9 D4 + trin 7)
//    En besked kan ikke kaldes tilbage. Foer i dag fandtes intet beskedapp-begreb
//    i porten: `computer_press` paa Send i WhatsApp gik igennem i allow uden at
//    nogen blev spurgt. Dommens seks modforsoeg skal alle give roedt:
//      (a) send-knappen · (b) Return/Enter · (c) linjeskift i computer_type ·
//      (d) en falsk modtager fra modellen · (e) genbrugt nonce · (f) ja efter fristen.
//    (e) og (f) er portens egne regler og maales i ikon-godkend.mjs (A7, A13, E3).
//    Her: (a)-(d), genkontrollen under laasen, og en modtager der ikke kan laeses.
//
//    Rigtig server, FALSK ikon og FALSK hjaelper med scriptede skaerm-svar:
//    ingen skaerm, ingen rigtig beskedapp, intet sendt.
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const STATE = mkdtempSync(join(tmpdir(), 'cmcp-sende-'));
const HJ = lavFalskHjaelper('cmcp-sende');
const SP = lavFalskSpoerger('ja', 'cmcp-sende-sp');
const WA = 'net.whatsapp.WhatsApp';
const SAMTALE = { window: 'WhatsApp', headings: ['Benjamin Riber', 'online'], field: { role: 'AXTextArea', value: 'computer-MCP virker' } };
const APPS = { apps: [{ name: 'WhatsApp', bundleId: WA, active: false }, { name: 'Finder', bundleId: 'com.apple.finder', active: true }] };
const svar = (ekstra = {}) => HJ.saetSvar({ apps: APPS, samtale: SAMTALE, 'press --dry': { would_press: { name: 'Send', role: 'AXButton' } }, ...ekstra });
svar();

// Det falske ikon: svarer efter `ikonSvar`, og kan aendre skaermen FOER det svarer.
let ikonSvar = 'ja', foerSvar = null;
const spurgt = [];
await new Promise(res => createServer(sock => {
  let buf = '';
  sock.on('data', d => {
    buf += d; const i = buf.indexOf('\n'); if (i < 0) return;
    const q = JSON.parse(buf.slice(0, i)); spurgt.push(q);
    if (foerSvar) { foerSvar(); foerSvar = null; }
    const m = ikonSvar === 'ja' ? { ok: true, verified: 'owner' } : { ok: true, verified: 'none' };
    sock.write(JSON.stringify({ nonce: q.nonce, ...m }) + '\n');
  });
  sock.on('error', () => {});
}).listen(join(STATE, 'ikon.sock'), res));

const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], {
  env: { ...process.env, CMCP_STATE_DIR: STATE, CMCP_MODE: 'allow', CMCP_HELPER: HJ.sti, CMCP_ASK_TIMEOUT: '3',
         CMCP_STATUS_IKON: '0', CMCP_OSASCRIPT: SP.sti, CMCP_BACKGROUND: '1' },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; const v = new Map(); let n = 0;
srv.stdout.on('data', d => { buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(l); v.get(m.id)?.(m); v.delete(m.id); } catch {} } });
const rpc = (method, params = {}) => new Promise((res, rej) => { const id = ++n; v.set(id, res);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  setTimeout(() => rej(new Error('timeout ' + method)), 30000); });
const kald = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args });
  return { fejl: !!r.result?.isError, tekst: r.result?.content?.[0]?.text || JSON.stringify(r.error || {}) }; };
const handlinger = () => HJ.handlingerNaaedeFrem().map(k => k.argv[0]);

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'chat-sende', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // 0. At skrive et udkast er IKKE at sende: ingen spoergsmaal.
  let foer = spurgt.length;
  const s0 = await kald('computer_type', { app: 'WhatsApp', text: 'computer-MCP virker' });
  check('0 et udkast uden linjeskift skrives uden at spoerge', !s0.fejl && spurgt.length === foer && handlinger().includes('type'), s0.tekst.slice(0, 90));

  // (a) Send-knappen: spoerger, med modtager og tekst fra SKAERMEN.
  foer = spurgt.length; ikonSvar = 'ja';
  const sa = await kald('computer_press', { app: 'WhatsApp', role: 'AXButton', title: 'Send' });
  const qa = spurgt[foer];
  check('a send-knappen spoerger mennesket', !!qa, `${spurgt.length - foer} spoergsmaal`);
  check('a ...og viser hvem det gaar til, laest fra skaermen', /To \(read from the screen\): Benjamin Riber/.test(qa?.text || ''), qa?.text);
  check('a ...og hele beskeden, laest tilbage fra feltet', /computer-MCP virker/.test(qa?.text || ''), qa?.text);
  check('a ...kun for denne ene besked', /this one action only/.test(qa?.scope || '') && /cannot be taken back/.test(qa?.scope || ''), qa?.scope);
  check('a ...og efter ja blev der trykket', !sa.fejl && handlinger().filter(x => x === 'press').length === 1, sa.tekst.slice(0, 90));

  // En knap der IKKE sender, spoerger ikke.
  foer = spurgt.length; svar({ 'press --dry': { would_press: { name: 'Attach', role: 'AXButton' } } });
  await kald('computer_press', { app: 'WhatsApp', role: 'AXButton', title: 'Attach' });
  check('a2 en knap der ikke sender, spoerger ikke', spurgt.length === foer, `${spurgt.length - foer}`);
  svar();

  // (b) Return og Enter - med ethvert ekstra modifikator - spoerger. Et nej = intet sendt.
  ikonSvar = 'nej';
  for (const combo of ['return', 'enter', 'cmd+return', 'cmd+cmd+return', 'shift+enter', 'cmd+shift+d']) {
    foer = spurgt.length; const k0 = handlinger().filter(x => x === 'key').length;
    const r = await kald('computer_key', { app: 'WhatsApp', combo });
    check(`b «${combo}» spoerger, og uden ja sendes intet`, spurgt.length === foer + 1 && r.fejl
          && handlinger().filter(x => x === 'key').length === k0, r.tekst.slice(0, 80));
  }

  // (c) Et linjeskift i teksten er en usynlig afsendelse: afvist, intet skrevet.
  for (const [navn, t] of [['\\n', 'hej\nmed dig'], ['\\r', 'hej\r'], ['U+2028', 'hej ']]) {
    foer = spurgt.length; const t0 = handlinger().filter(x => x === 'type').length;
    const r = await kald('computer_type', { app: 'WhatsApp', text: t });
    check(`c linjeskift (${navn}) i en beskedapp: afvist, intet skrevet`, r.fejl && /line break sends/.test(r.tekst)
          && handlinger().filter(x => x === 'type').length === t0 && spurgt.length === foer, r.tekst.slice(0, 80));
  }

  // (d) Modellen kan ikke skrive modtageren: dens egne ord naar ikke spoergsmaalet.
  foer = spurgt.length; ikonSvar = 'nej';
  await kald('computer_press', { app: 'WhatsApp', role: 'AXButton', title: 'Send', contains: 'to Mom' });
  const qd = spurgt[foer];
  check('d en falsk modtager fra modellen naar ikke spoergsmaalet', !!qd && !/Mom/.test(qd.text) && /Benjamin Riber/.test(qd.text), qd?.text);

  // Et klik paa en send-knap spoerger ogsaa - og et klik der ikke kan bestemmes, spoerger.
  foer = spurgt.length;
  svar({ at: { found: true, bundleId: WA, role: 'AXButton', title: '', description: 'Send' } });
  await kald('computer_click', { app: 'WhatsApp', x: 500, y: 500 });
  check('d2 et klik paa send-knappen spoerger', spurgt.length === foer + 1, `${spurgt.length - foer}`);
  foer = spurgt.length;
  svar({ at: { found: true, bundleId: 'com.apple.finder', role: 'AXButton', title: 'Other' } });
  await kald('computer_click', { app: 'WhatsApp', x: 500, y: 500 });
  check('d3 et klik hvor noget andet ligger foran, spoerger (fejler lukket)', spurgt.length === foer + 1, `${spurgt.length - foer}`);
  svar();

  // Genkontrol under laasen: mennesket siger ja - men feltet skifter foer tasten trykkes.
  foer = spurgt.length; ikonSvar = 'ja';
  const k0 = handlinger().filter(x => x === 'key').length;
  foerSvar = () => svar({ samtale: { ...SAMTALE, field: { role: 'AXTextArea', value: 'en HELT anden besked' } } });
  const g = await kald('computer_key', { app: 'WhatsApp', combo: 'return' });
  check('g det der sendes, aendrede sig efter ja: intet sendt', g.fejl && /changed after the person approved/.test(g.tekst)
        && handlinger().filter(x => x === 'key').length === k0, g.tekst.slice(0, 100));
  svar();

  // En modtager der ikke kan laeses: spoergsmaalet SIGER det, i stedet for at gaette.
  foer = spurgt.length; ikonSvar = 'nej';
  svar({ samtale: { window: '', headings: [], field: { role: 'AXTextArea' } } });
  await kald('computer_key', { app: 'WhatsApp', combo: 'return' });
  const qu = spurgt[foer];
  check('u ulaeselig modtager og tekst: spoergsmaalet siger det aabent',
        /To: could not be read/.test(qu?.text || '') && /Message: could not be read/.test(qu?.text || ''), qu?.text);
  check('ingen dialog blev rejst i hele proeven', SP.gangeSpurgt() === 0, `${SP.gangeSpurgt()}`);
} finally {
  srv.kill();
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
