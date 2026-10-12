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
import './ryd-op.mjs';
import './egen-tilstand.mjs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
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
// Feltet og Send-knappen paa samme raekke i samme vindue - saadan ligger de i en chat-app.
const FELT_RAMME = { x: 160, y: 600, w: 400, h: 40 };
const KNAP = { window: 'WhatsApp', frame: { x: 570, y: 605, w: 30, h: 30 } };
const SAMTALE = { window: 'WhatsApp', headings: ['Benjamin Riber', 'online'], column: true, field: { role: 'AXTextArea', value: 'computer-MCP virker', frame: FELT_RAMME } };
const APPS = { apps: [{ name: 'WhatsApp', bundleId: WA, active: false }, { name: 'Finder', bundleId: 'com.apple.finder', active: true },
                      { name: 'Google Chrome', bundleId: 'com.google.Chrome', active: false }, { name: 'Mail', bundleId: 'com.apple.mail', active: false }] };
const svar = (ekstra = {}) => HJ.saetSvar({ apps: APPS, samtale: SAMTALE, 'press --dry': { would_press: { name: 'Send', role: 'AXButton', ...KNAP } }, ...ekstra });
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
  check('a ...og viser hvem det gaar til, laest fra skaermen over feltet', /To \(read from the screen, above the text field\): Benjamin Riber/.test(qa?.text || ''), qa?.text);
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
  svar({ at: { found: true, bundleId: WA, role: 'AXButton', title: '', description: 'Send', ...KNAP } });
  await kald('computer_click', { app: 'WhatsApp', x: 500, y: 500 });
  check('d2 et klik paa send-knappen spoerger', spurgt.length === foer + 1, `${spurgt.length - foer}`);
  foer = spurgt.length;
  svar({ at: { found: true, bundleId: 'com.apple.finder', role: 'AXButton', title: 'Other' } });
  const kd3 = handlinger().filter(x => x === 'click').length;
  const d3 = await kald('computer_click', { app: 'WhatsApp', x: 500, y: 500 });
  check('d3 et klik hvor noget andet ligger foran: fejler lukket (afvist eller spurgt), intet klikket uden ja',
        (d3.fejl || spurgt.length === foer + 1) && handlinger().filter(x => x === 'click').length === kd3, d3.tekst.slice(0, 90));
  svar();

  // Genkontrol under laasen: mennesket siger ja - men feltet skifter foer tasten trykkes.
  foer = spurgt.length; ikonSvar = 'ja';
  const k0 = handlinger().filter(x => x === 'key').length;
  foerSvar = () => svar({ samtale: { ...SAMTALE, field: { role: 'AXTextArea', value: 'en HELT anden besked' } } });
  const g = await kald('computer_key', { app: 'WhatsApp', combo: 'return' });
  check('g det der sendes, aendrede sig efter ja: intet sendt', g.fejl && /changed after the person approved/.test(g.tekst)
        && handlinger().filter(x => x === 'key').length === k0, g.tekst.slice(0, 100));
  svar();

  // u (runde 1, Astra 3): kan modtager eller tekst IKKE laeses, kan et ja ikke bindes til
  //   det der sendes - saa sendes intet, og mennesket spoerges ikke om noget ulaeseligt.
  for (const [navn, sam] of [['modtager', { window: '', headings: [], field: { role: 'AXTextArea', value: 'hej' } }],
                             ['tekst', { ...SAMTALE, field: { role: 'AXTextArea' } }]]) {
    foer = spurgt.length; svar({ samtale: sam });
    const k0 = handlinger().filter(x => x === 'key').length;
    const r = await kald('computer_key', { app: 'WhatsApp', combo: 'return' });
    check(`u ulaeselig ${navn}: afvist, ikke spurgt, intet sendt`, r.fejl && /could not be read/.test(r.tekst) && spurgt.length === foer
          && handlinger().filter(x => x === 'key').length === k0, r.tekst.slice(0, 100));
  }
  svar();

  // R6 (runde 1, Astra 1 + Fable F3): «Afsend», en navnloes ikon-knap og mellemrum paa en knap sender ogsaa.
  ikonSvar = 'nej';
  for (const [navn, el] of [['«Afsend»', { name: 'Afsend', role: 'AXButton' }], ['«Besvar»', { name: 'Besvar', role: 'AXButton' }],
                            ['en navnloes knap', { role: 'AXButton' }]]) {
    foer = spurgt.length; svar({ 'press --dry': { would_press: { ...el, ...KNAP } } });
    await kald('computer_press', { app: 'WhatsApp', role: 'AXButton', index: 3 });
    check(`r6 ${navn} spoerger`, spurgt.length === foer + 1, `${spurgt.length - foer}`);
  }
  // Med fokus paa knappen kan beskedteksten ikke laeses -> afvist (fejl lukket). Det der
  // taeller: tasten naar aldrig frem uden et ja.
  foer = spurgt.length; svar({ samtale: { ...SAMTALE, field: { role: 'AXButton' } } });
  const ks = handlinger().filter(x => x === 'key').length;
  const sp = await kald('computer_key', { app: 'WhatsApp', combo: 'space' });
  check('r6 mellemrum med fokus paa en knap: behandlet som send (her afvist), tasten trykkes ikke', sp.fejl
        && /could not be read/.test(sp.tekst) && handlinger().filter(x => x === 'key').length === ks, sp.tekst.slice(0, 90));
  foer = spurgt.length; svar();
  const ksp = handlinger().filter(x => x === 'key').length;
  const spt = await kald('computer_key', { app: 'WhatsApp', combo: 'space' });
  check('r6 ...men mellemrum i tekstfeltet spoerger ikke - og tasten trykkes', spurgt.length === foer && !spt.fejl
        && handlinger().filter(x => x === 'key').length === ksp + 1, `${spurgt.length - foer} · ${spt.tekst.slice(0, 60)}`);

  // R6 (Fable P3): en webchat i en browser er ogsaa en afsendelse - en almindelig side er ikke.
  foer = spurgt.length; svar({ samtale: { ...SAMTALE, window: 'WhatsApp - Google Chrome' } });
  await kald('computer_key', { app: 'Google Chrome', combo: 'return' });
  check('r6 Return i WhatsApp Web i en browser spoerger', spurgt.length === foer + 1, `${spurgt.length - foer}`);
  foer = spurgt.length; svar({ samtale: { ...SAMTALE, window: 'Wikipedia - Google Chrome' } });
  const k1 = handlinger().filter(x => x === 'key').length;
  await kald('computer_key', { app: 'Google Chrome', combo: 'return' });
  check('r6 ...Return paa en almindelig side spoerger ikke', spurgt.length === foer && handlinger().filter(x => x === 'key').length === k1 + 1, `${spurgt.length - foer}`);

  // R7 (Fable F8): i mail er Return en ny linje - og en mail med afsnit kan skrives.
  foer = spurgt.length; svar({ samtale: { ...SAMTALE, window: 'Ny besked' } });
  const t1 = handlinger().filter(x => x === 'type').length;
  const mt = await kald('computer_type', { app: 'Mail', text: 'Hej Benjamin,\n\ncomputer-MCP virker.' });
  check('r7 en mail med afsnit skrives uden at spoerge', !mt.fejl && spurgt.length === foer && handlinger().filter(x => x === 'type').length === t1 + 1, mt.tekst.slice(0, 80));
  foer = spurgt.length;
  const kmr = handlinger().filter(x => x === 'key').length;
  const mr = await kald('computer_key', { app: 'Mail', combo: 'return' });
  check('r7 Return i mail spoerger ikke - og tasten trykkes', spurgt.length === foer && !mr.fejl
        && handlinger().filter(x => x === 'key').length === kmr + 1, `${spurgt.length - foer} · ${mr.tekst.slice(0, 60)}`);
  foer = spurgt.length;
  await kald('computer_key', { app: 'Mail', combo: 'cmd+return' });
  check('r7 Cmd+Return i mail spoerger (Fable R2 8)', spurgt.length === foer + 1, `${spurgt.length - foer}`);
  foer = spurgt.length;
  await kald('computer_key', { app: 'Mail', combo: 'cmd+shift+d' });
  check('r7 ...men cmd+shift+D i mail spoerger', spurgt.length === foer + 1, `${spurgt.length - foer}`);
  foer = spurgt.length; svar();
  const ctl = await kald('computer_type', { app: 'WhatsApp', text: 'hej\u0003' });
  check('r7 andre styretegn i en chat afvises ogsaa (Fable F4)', ctl.fejl && /line break sends/.test(ctl.tekst), ctl.tekst.slice(0, 80));

  // R4 (runde 1, Astra 2): et klik der pegede paa Attach ved dommen og paa Send under
  //   laasen, maa ikke gaa igennem. Proeven holder laasen og skifter knappen imens.
  svar({ at: { found: true, bundleId: WA, role: 'AXButton', title: 'Attach', description: '' } });
  const LAAS = join(STATE, 'laase'); mkdirSync(LAAS, { recursive: true });
  writeFileSync(join(LAAS, WA + '.lock'), String(process.pid));
  const c0 = handlinger().filter(x => x === 'click').length;
  foer = spurgt.length;
  const atFoer = HJ.kald().filter(k => k.argv[0] === 'at').length;
  const venter = kald('computer_click', { app: 'WhatsApp', x: 500, y: 500 });
  // ⛔ 1/10: her stod en fast ventetid paa 1,2 s - under last naaede dommen ikke at se
  //    «Attach» foer knappen blev byttet (1 af 3 roede paa Gustavs Mac). Nu ventes der
  //    til serveren HAR slaaet knappen op, og saa en ekstra tand for at den naar laasen.
  for (let i = 0; i < 100 && HJ.kald().filter(k => k.argv[0] === 'at').length === atFoer; i++) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 400));
  svar({ at: { found: true, bundleId: WA, role: 'AXButton', title: 'Send', description: '' } });
  unlinkSync(join(LAAS, WA + '.lock'));
  const r4 = await venter;
  check('r4 Attach ved dommen, Send under laasen: intet klikket', r4.fejl && /changed after the person approved/.test(r4.tekst)
        && handlinger().filter(x => x === 'click').length === c0, r4.tekst.slice(0, 100));
  svar();

  // R5 (runde 1, Astra 3): en ny overskrift eller vinduestitel efter ja er en anden samtale.
  foer = spurgt.length; ikonSvar = 'ja';
  const k2 = handlinger().filter(x => x === 'key').length;
  foerSvar = () => svar({ samtale: { ...SAMTALE, headings: ['Benjamin Riber', 'online', 'Alice'], window: 'Alice' } });
  const g2 = await kald('computer_key', { app: 'WhatsApp', combo: 'return' });
  check('r5 samtalen skiftede efter ja (tredje overskrift, titel): intet sendt', g2.fejl && /changed after the person approved/.test(g2.tekst)
        && handlinger().filter(x => x === 'key').length === k2, g2.tekst.slice(0, 100));
  svar();
  // r5b: KUN vinduets titel skifter (samme overskrifter, samme tekst) - et andet vindue
  //      er en anden samtale. Det er fingeraftrykkets del; beskrivelsen ser det ikke.
  const k3 = handlinger().filter(x => x === 'key').length;
  foerSvar = () => svar({ samtale: { ...SAMTALE, window: 'WhatsApp - Alice' } });
  const g3 = await kald('computer_key', { app: 'WhatsApp', combo: 'return' });
  check('r5b kun vinduet skiftede efter ja: intet sendt', g3.fejl && /changed after the person approved/.test(g3.tekst)
        && handlinger().filter(x => x === 'key').length === k3, g3.tekst.slice(0, 100));
  svar();
  // Q3 (runde 2, Astra 3): binding til modtager, felt og vindue.
  ikonSvar = 'nej';
  const afvist = async (navn, sam, ekstra, kaldet = ['computer_key', { app: 'WhatsApp', combo: 'return' }], grund = /could not|not in the conversation/) => {
    foer = spurgt.length; svar({ samtale: sam, ...ekstra });
    const r = await kald(...kaldet);
    check(navn, r.fejl && grund.test(r.tekst) && spurgt.length === foer, r.tekst.slice(0, 110));
  };
  await afvist('q3 uden kolonne (feltets placering ulaeselig): afvist, ikke spurgt', { ...SAMTALE, column: false }, {});
  await afvist('q3 et soegefelt med fokus er ikke en besked: afvist', { ...SAMTALE, field: { role: 'AXTextField', subrole: 'AXSearchField', value: 'Benjamin' } }, {});
  await afvist('q3 Send-knappens vindue kan ikke laeses: afvist (Astra R3 2)', SAMTALE,
               { 'press --dry': { would_press: { name: 'Send', role: 'AXButton', frame: KNAP.frame } } },
               ['computer_press', { app: 'WhatsApp', role: 'AXButton', title: 'Send' }]);
  await afvist('q3 Send-knappen ligger ikke ved beskedfeltet: afvist', SAMTALE,
               { 'press --dry': { would_press: { name: 'Send', role: 'AXButton', window: 'WhatsApp', frame: { x: 570, y: 80, w: 30, h: 30 } } } },
               ['computer_press', { app: 'WhatsApp', role: 'AXButton', title: 'Send' }]);
  // Runde 4 (Astra 2): tre veje uden om bindingen.
  await afvist('r4a samme titel og hoejde, men langt til hoejre for feltet: afvist', SAMTALE,
               { 'press --dry': { would_press: { name: 'Send', role: 'AXButton', window: 'WhatsApp', frame: { x: 1500, y: 605, w: 30, h: 30 } } } },
               ['computer_press', { app: 'WhatsApp', role: 'AXButton', title: 'Send' }]);
  {
    foer = spurgt.length; svar({ samtale: SAMTALE, 'press --dry': { ok: false, error: 'opslaget fejlede', code: 'ax-timeout' } });
    const p0 = handlinger().filter(x => x === 'press').length;
    const r = await kald('computer_press', { app: 'WhatsApp', role: 'AXButton', title: 'Send' });
    check('r4b opslaget af Send-kontrollen fejler: afvist, ikke spurgt, intet trykket', r.fejl && spurgt.length === foer
          && handlinger().filter(x => x === 'press').length === p0, r.tekst.slice(0, 110));
  }
  // r4e (7/10, fuld mutantport paa 0.2.2-kandidaten): siden punkt I afviser tryk-porten
  //    allerede et fejlet «press --dry», saa r4b naar aldrig bindingen - mutant R4 overlevede.
  //    Et KLIK med navngivet app har ingen tidlig afvisning: et fejlet opslag af kontrollen
  //    under punktet skal stadig binde - afvist, ikke spurgt, intet klikket.
  {
    foer = spurgt.length; svar({ samtale: SAMTALE, at: { ok: false, error: 'opslaget fejlede', code: 'ax-timeout' } });
    const c0 = handlinger().filter(x => x === 'click').length;
    const r = await kald('computer_click', { app: 'WhatsApp', x: 585, y: 620 });
    check('r4e opslaget af kontrollen under et klik fejler: afvist, ikke spurgt, intet klikket', r.fejl && spurgt.length === foer
          && handlinger().filter(x => x === 'click').length === c0, r.tekst.slice(0, 110));
  }
  {
    foer = spurgt.length;
    svar({ samtale: { ...SAMTALE, window: 'Wikipedia - Google Chrome' },
           'press --dry': { would_press: { name: 'Send', role: 'AXButton', window: 'WhatsApp - Google Chrome', frame: KNAP.frame } } });
    const p0 = handlinger().filter(x => x === 'press').length;
    const r = await kald('computer_press', { app: 'Google Chrome', role: 'AXButton', title: 'Send' });
    check('r4c browser: fokus paa en almindelig side, Send i et WhatsApp-vindue: aldrig trykket uden ja', (r.fejl || spurgt.length === foer + 1)
          && handlinger().filter(x => x === 'press').length === p0, r.tekst.slice(0, 110));
  }
  {
    // r4d (runde 5, Astra 2): browser, fokus paa en almindelig side, Send-kontrol hvis vindue
    //      IKKE kan laeses -> ukendt vindue, doemmes som en chat: aldrig trykket uden ja.
    foer = spurgt.length;
    svar({ samtale: { ...SAMTALE, window: 'Wikipedia - Google Chrome' },
           'press --dry': { would_press: { name: 'Send', role: 'AXButton', frame: KNAP.frame } } });
    const p0 = handlinger().filter(x => x === 'press').length;
    const r = await kald('computer_press', { app: 'Google Chrome', role: 'AXButton', title: 'Send' });
    check('r4d browser: Send-kontrol med ulaeseligt vindue: aldrig trykket uden ja', (r.fejl || spurgt.length === foer + 1)
          && handlinger().filter(x => x === 'press').length === p0, r.tekst.slice(0, 110));
  }
  await afvist('q3 Send-knappen ligger i et andet vindue end samtalen: afvist', SAMTALE,
               { 'press --dry': { would_press: { name: 'Send', role: 'AXButton', window: 'Arkiv', frame: KNAP.frame } } },
               ['computer_press', { app: 'WhatsApp', role: 'AXButton', title: 'Send' }]);
  foer = spurgt.length; svar({ samtale: { ...SAMTALE, headings: ['Benjamin Riber', 'online', 'hej ses i morgen'] } });
  await kald('computer_key', { app: 'WhatsApp', combo: 'return' });
  const qTo = spurgt[foer]?.text || '';
  check('q3 kun den foerste overskrift vises som modtager (Fable R2 4)', /To \(read from the screen, above the text field\): Benjamin Riber Message/.test(qTo) && !/ses i morgen/.test(qTo), qTo.slice(0, 160));

  // W (1/10, MAALT i Gustavs rigtige WhatsApp): navnet staar i en KNAP oeverst i samtalen,
  //   og overskrifterne over feltet er datoer. Hjaelperens «recipient» vinder over dem.
  foer = spurgt.length; svar({ samtale: { ...SAMTALE, headings: ['I dag'], recipient: 'Benjamin Riber' } });
  await kald('computer_key', { app: 'WhatsApp', combo: 'return' });
  const qW = spurgt[foer]?.text || '';
  check('w1 modtageren fra samtalens top vises - ikke datoen over feltet', /: Benjamin Riber Message/.test(qW) && !/: I dag Message/.test(qW), qW.slice(0, 160));
  // ...og uden modtager og uden overskrifter: afvist som foer (intet gaettes).
  await afvist('w2 hverken modtager eller overskrift: intet sendt', { ...SAMTALE, headings: [] }, {},
               ['computer_key', { app: 'WhatsApp', combo: 'return' }]);

  // Q4 (runde 2, Astra 4 + Fable 7): browseren.
  await afvist('q4 browser med ulaeselig titel behandles som chat (fejl lukket): intet sendt', { window: '', headings: [], field: {} }, {},
               ['computer_key', { app: 'Google Chrome', combo: 'return' }]);
  foer = spurgt.length; svar({ samtale: { ...SAMTALE, window: 'Gmail - Slack' } });
  await kald('computer_key', { app: 'Google Chrome', combo: 'return' });
  check('q4 «Gmail - Slack» er en chat: Return spoerger', spurgt.length === foer + 1, `${spurgt.length - foer}`);
  foer = spurgt.length; svar({ samtale: { ...SAMTALE, window: 'Signal processing - Wikipedia' } });
  const kw = handlinger().filter(x => x === 'key').length;
  await kald('computer_key', { app: 'Google Chrome', combo: 'return' });
  check('q4 «Signal processing - Wikipedia» er ikke en chat', spurgt.length === foer && handlinger().filter(x => x === 'key').length === kw + 1, `${spurgt.length - foer}`);
  foer = spurgt.length; svar({ samtale: { ...SAMTALE, window: 'Inbox (3) - x@gmail.com - Gmail' } });
  await kald('computer_key', { app: 'Google Chrome', combo: 'return' });
  check('q4 webmail: Return spoerger ikke', spurgt.length === foer, `${spurgt.length - foer}`);
  foer = spurgt.length;
  await kald('computer_key', { app: 'Google Chrome', combo: 'cmd+return' });
  check('q4 webmail: Cmd+Return spoerger', spurgt.length === foer + 1, `${spurgt.length - foer}`);

  // Q9 (runde 2, Fable 2): et klik paa en navnloes GRUPPE er ikke en send; paa en navnloes KNAP er det.
  foer = spurgt.length; svar({ at: { found: true, bundleId: WA, role: 'AXGroup', title: '', description: '' } });
  const kc = handlinger().filter(x => x === 'click').length;
  const gk = await kald('computer_click', { app: 'WhatsApp', x: 300, y: 300 });
  check('q9 klik paa en navnloes gruppe: ikke en afsendelse, klikket sker', spurgt.length === foer && !gk.fejl
        && handlinger().filter(x => x === 'click').length === kc + 1, gk.tekst.slice(0, 80));
  foer = spurgt.length; svar({ at: { found: true, bundleId: WA, role: 'AXButton', title: '', description: '', ...KNAP } });
  await kald('computer_click', { app: 'WhatsApp', x: 300, y: 300 });
  check('q9 klik paa en navnloes knap spoerger', spurgt.length === foer + 1, `${spurgt.length - foer}`);
  // Runde 3 (Astra 3): en UKENDT rolle (opslaget fejlede) er ikke ufarlig ved et klik.
  foer = spurgt.length; svar({ at: { found: true, bundleId: WA, role: '', title: '', description: '', ...KNAP } });
  const kq = handlinger().filter(x => x === 'click').length;
  await kald('computer_click', { app: 'WhatsApp', x: 300, y: 300 });
  check('q9 klik paa et element med ukendt rolle spoerger, klikkes ikke uden ja', spurgt.length === foer + 1
        && handlinger().filter(x => x === 'click').length === kq, `${spurgt.length - foer}`);
  svar();

  check('ingen dialog blev rejst i hele proeven', SP.gangeSpurgt() === 0, `${SP.gangeSpurgt()}`);
} finally {
  srv.kill();
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
