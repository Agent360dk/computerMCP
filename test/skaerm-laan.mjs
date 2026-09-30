// SKAERM-LAANET: kan en agent faa skaermen - KUN naar mennesket giver den, kun
// saa laenge, og aldrig mens mennesket selv bruger den?
//
// ⛔ HVORFOR DEN FINDES (29/9-2026, panelet: B2 + B5)
//    Foer: forgrund kun via CMCP_BACKGROUND=0 og genstart, pr. proces - 21 servere
//    kunne vaere uenige om én skaerm. Nu ejer menulinje-ikonet kontakten: mennesket
//    laaner EN agent skaermen med Touch ID, i hoejst 15 minutter, og kan tage den
//    tilbage. Laanet ER den aabne forbindelse; lukkes den, er skaermen menneskets.
//
//    Rigtig server, FALSK ikon (ingen menu, intet Touch ID), FALSK hjaelper med
//    scriptet «idle»-svar. Intet flyttes, intet tager skaermen.
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
const vent = ms => new Promise(r => setTimeout(r, ms));

function lavIkon(state) {
  const ikon = { svar: 'ja', laanMs: 60_000, spurgt: [], laan: null, lukketAfServer: 0 };
  return new Promise(res => createServer(sock => {
    let buf = '', svaret = false;
    sock.on('data', d => {
      if (svaret) return;
      buf += d; const i = buf.indexOf('\n'); if (i < 0) return;
      const q = JSON.parse(buf.slice(0, i)); ikon.spurgt.push(q); svaret = true;
      if (ikon.svar === 'ja') {
        sock.write(JSON.stringify({ nonce: q.nonce, ok: true, verified: 'owner', until: Date.now() + ikon.laanMs }) + '\n');
        ikon.laan = sock;                       // forbindelsen holdes AABEN: den er laanet
        sock.on('end', () => { ikon.lukketAfServer++; });
      } else if (ikon.svar === 'optaget') {
        sock.end(JSON.stringify({ nonce: q.nonce, ok: false, verified: 'optaget' }) + '\n');
      } else {
        sock.end(JSON.stringify({ nonce: q.nonce, ok: false, verified: 'none' }) + '\n');
      }
    });
    sock.on('error', () => {});
  }).listen(join(state, 'ikon.sock'), () => res(ikon)));
}

function server(state, hj, ekstra = {}) {
  const sp = lavFalskSpoerger('ja', 'cmcp-laan-sp');
  const env = { ...process.env, CMCP_STATE_DIR: state, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti,
                CMCP_ASK_TIMEOUT: '3', CMCP_STATUS_IKON: '0', CMCP_OSASCRIPT: sp.sti, ...ekstra };
  if (!('CMCP_BACKGROUND' in ekstra)) delete env.CMCP_BACKGROUND;
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const v = new Map(); let n = 0; const meldt = [];
  srv.stdout.on('data', d => { buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(l); if (m.method) meldt.push(m.method); else { v.get(m.id)?.(m); v.delete(m.id); } } catch {} } });
  const rpc = (method, params = {}) => new Promise((res, rej) => { const id = ++n; v.set(id, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => rej(new Error('timeout ' + method)), 30000); });
  return {
    srv, sp, meldt,
    async klar() { await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'chat-laan', version: '1' } });
      srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); },
    async navne() { return ((await rpc('tools/list')).result?.tools || []).map(t => t.name); },
    async kald(name, args) { const r = await rpc('tools/call', { name, arguments: args });
      return { fejl: !!r.result?.isError, tekst: r.result?.content?.[0]?.text || JSON.stringify(r.error || {}) }; }
  };
}
const listeMeldt = (s) => s.meldt.filter(m => m === 'notifications/tools/list_changed').length;

const STATE = mkdtempSync(join(tmpdir(), 'cmcp-laan-'));
const HJ = lavFalskHjaelper('cmcp-laan');
HJ.saetSvar({ idle: { idle: 30 } });
const ikon = await lavIkon(STATE);
const S = server(STATE, HJ);
const flyt = () => HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'move').length;
try {
  await S.klar();
  let navne = await S.navne();
  check('1 i baggrund: move er skjult, request_screen tilbydes', !navne.includes('computer_move') && navne.includes('computer_request_screen'));
  const r0 = await S.kald('computer_move', { x: 5, y: 5 });
  check('1b ...og move afvises, med vejen til at bede om skaermen', r0.fejl && /computer_request_screen/.test(r0.tekst), r0.tekst.slice(0, 90));

  const uden = await S.kald('computer_request_screen', { action: 'request' });
  check('2 uden grund: afvist, ikonet ikke spurgt', uden.fejl && /reason/.test(uden.tekst) && ikon.spurgt.length === 0, uden.tekst.slice(0, 80));

  // 3. Mennesket giver skaermen.
  const foerMeld = listeMeldt(S);
  const ja = await S.kald('computer_request_screen', { action: 'request', reason: 'drag the file to the Trash', minutes: 5 });
  const q = ikon.spurgt[0];
  check('3 laanet: givet', !ja.fejl && /"granted":\s*true/.test(ja.tekst), ja.tekst.slice(0, 90));
  check('3 ...ikonet blev spurgt om SKAERMEN, med grund og minutter', q?.kind === 'screen' && q?.minutes === 5 && /drag the file/.test(q?.text || ''), JSON.stringify(q || {}).slice(0, 140));
  check('3 ...og det siger at agenten pauser og at skaermen kan tages tilbage', /pauses whenever you use the keyboard/.test(q?.scope || '') && /Take the screen back/.test(q?.scope || ''), q?.scope);
  await vent(200);
  navne = await S.navne();
  check('3 ...klienten faar besked om at vaerktoejerne aendrede sig', listeMeldt(S) > foerMeld, `${listeMeldt(S) - foerMeld} meldinger`);
  check('3 ...og move tilbydes nu', navne.includes('computer_move'));

  // 4. Med laanet: move virker - naar mennesket IKKE bruger maskinen.
  const m1 = await S.kald('computer_move', { x: 5, y: 5 });
  check('4 med laanet og ingen menneske-input: move udfoeres', !m1.fejl && flyt() === 1, m1.tekst.slice(0, 80));
  // 5. Mennesket bruger musen: agenten venter, intet flyttes.
  await vent(700);
  HJ.saetSvar({ idle: { idle: 0.1 } });
  const m2 = await S.kald('computer_move', { x: 6, y: 6 });
  check('5 mennesket bruger maskinen: agenten venter, intet flyttes', m2.fejl && /using the keyboard or mouse/.test(m2.tekst) && flyt() === 1, m2.tekst.slice(0, 100));
  HJ.saetSvar({ idle: { idle: 'ulaeseligt' } });   // scriptet: aldrig den rigtige hjaelper
  const m2b = await S.kald('computer_move', { x: 6, y: 6 });
  check('5b kan det ikke laeses om mennesket er der: intet flyttes', m2b.fejl && flyt() === 1, m2b.tekst.slice(0, 100));
  HJ.saetSvar({ idle: { idle: 30 } });

  // 6. Mennesket tager skaermen tilbage: lukket forbindelse = slut.
  const foer6 = listeMeldt(S);
  ikon.laan.destroy();
  await vent(300);
  navne = await S.navne();
  const m3 = await S.kald('computer_move', { x: 7, y: 7 });
  check('6 skaermen taget tilbage: listen meldes, move skjult og afvist', listeMeldt(S) > foer6 && !navne.includes('computer_move') && m3.fejl && flyt() === 1,
        `${listeMeldt(S) - foer6} meldinger · ${m3.tekst.slice(0, 60)}`);

  // 7. Tiden udloeber: vores eget ur, ogsaa hvis ikonet ikke lukker.
  ikon.laanMs = 1200;
  await S.kald('computer_request_screen', { action: 'request', reason: 'move a window', minutes: 1 });
  const lukFoer = ikon.lukketAfServer;
  await vent(1700);
  const m4 = await S.kald('computer_move', { x: 8, y: 8 });
  check('7 laanet udloeb: move afvist uden at ikonet lukkede', m4.fejl && flyt() === 1, m4.tekst.slice(0, 80));
  await vent(200);
  check('7 ...og serveren lukkede selv forbindelsen', ikon.lukketAfServer > lukFoer, `${ikon.lukketAfServer - lukFoer}`);

  // 8. Agenten giver den tilbage selv.
  ikon.laanMs = 60_000;
  await S.kald('computer_request_screen', { action: 'request', reason: 'resize a window', minutes: 3 });
  const lukFoer8 = ikon.lukketAfServer;
  const rel = await S.kald('computer_request_screen', { action: 'release' });
  await vent(200);
  const st = await S.kald('computer_request_screen', { action: 'status' });
  check('8 release: givet tilbage, forbindelsen lukket, status siger baggrund',
        /"released":\s*true/.test(rel.tekst) && ikon.lukketAfServer > lukFoer8 && /background/.test(st.tekst), st.tekst.slice(0, 80));

  // 9. En anden agent har skaermen: afvist, og det er ikke et menneskes nej.
  ikon.svar = 'optaget';
  const opt = await S.kald('computer_request_screen', { action: 'request', reason: 'x', minutes: 1 });
  check('9 skaermen er optaget: afvist med den grund', opt.fejl && /another agent has the screen/.test(opt.tekst), opt.tekst.slice(0, 80));

  // 10. Et nej er et nej.
  ikon.svar = 'nej';
  const nej = await S.kald('computer_request_screen', { action: 'request', reason: 'drag it', minutes: 2 });
  check('10 mennesket siger nej: afvist, move stadig skjult', nej.fejl && !(await S.navne()).includes('computer_move'), nej.tekst.slice(0, 80));
  check('ingen osascript-dialog i hele forloebet', S.sp.gangeSpurgt() === 0, `${S.sp.gangeSpurgt()}`);
} finally { S.srv.kill(); }

// 11. CMCP_BACKGROUND sat er et LOFT: intet laan, ikonet ikke spurgt.
const STATE2 = mkdtempSync(join(tmpdir(), 'cmcp-laan-loft-'));
const ikon2 = await lavIkon(STATE2);
const L = server(STATE2, HJ, { CMCP_BACKGROUND: '1' });
try {
  await L.klar();
  const r = await L.kald('computer_request_screen', { action: 'request', reason: 'drag', minutes: 2 });
  check('11 laast til baggrund: afvist, ikonet ikke spurgt', r.fejl && /locked this server to background/.test(r.tekst) && ikon2.spurgt.length === 0, r.tekst.slice(0, 90));
} finally { L.srv.kill(); }

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
