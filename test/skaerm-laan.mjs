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
import './ryd-op.mjs';
import './egen-tilstand.mjs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = ms => new Promise(r => setTimeout(r, ms));

function lavIkon(state) {
  const ikon = { svar: 'ja', laanMs: 60_000, spurgt: [], laan: null, lukketAfServer: 0, koe: [] };
  // Skaerm-koe (2/10): naar det aktive laan slutter, svares den AELDSTE ventende
  // skaerm-anmodning «ja» - ingen ny forespoergsel noedvendig (ikke en afvisning).
  // ⛔ MAALT: en lokal .destroy() udloeser «close» paa EGEN socket, ikke «end»
  //    («end» er kun for en FJERN-afsendt FIN) - saa koeen rykker videre paa
  //    «close», som faar naar laanet slutter uanset hvem der lukkede det.
  const naesteIKoe = () => {
    const n = ikon.koe.shift();
    if (!n) return;
    ikon.laan = n.sock;
    n.sock.on('close', () => { if (ikon.laan === n.sock) ikon.laan = null; naesteIKoe(); });
    try { n.sock.write(JSON.stringify({ nonce: n.q.nonce, ok: true, verified: 'owner', until: Date.now() + ikon.laanMs }) + '\n'); } catch {}
  };
  return new Promise(res => createServer(sock => {
    let buf = '', svaret = false;
    sock.on('data', d => {
      if (svaret) return;
      buf += d; const i = buf.indexOf('\n'); if (i < 0) return;
      const q = JSON.parse(buf.slice(0, i)); ikon.spurgt.push(q); svaret = true;
      if (ikon.svar === 'koe' && q.kind === 'screen') {
        if (ikon.laan) {
          // Et andet laan har allerede skaermen: staar i koen, IKKE afvist -
          // serveren venter selv (skaermVentetid()), fake-ikonet svarer foerst
          // naar koen aabner (naesteIKoe).
          ikon.koe.push({ sock, q });
          sock.on('close', () => { ikon.koe = ikon.koe.filter(x => x.sock !== sock); });
        } else {
          ikon.laan = sock;
          sock.on('close', () => { if (ikon.laan === sock) ikon.laan = null; naesteIKoe(); });
          sock.write(JSON.stringify({ nonce: q.nonce, ok: true, verified: 'owner', until: Date.now() + ikon.laanMs }) + '\n');
        }
      } else if (ikon.svar === 'langsom') {            // svarer ja efter 800 ms
        setTimeout(() => { try { sock.write(JSON.stringify({ nonce: q.nonce, ok: true, verified: 'owner', until: Date.now() + ikon.laanMs }) + '\n'); } catch {} }, 800);
        ikon.laan = sock; sock.on('end', () => { ikon.lukketAfServer++; });
      } else if (ikon.svar === 'ja') {
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
  // Menneske-graensen er 5 s her (standard 1,5): prooverne af attribution maa ikke
  // afhaenge af hvor hurtigt en belastet maskine svarer (5d var ustabil, 30/9).
  const env = { ...process.env, CMCP_STATE_DIR: state, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti, CMCP_MENNESKE_SEK: '5',
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
// «Hvad er forrest» SKAL vaere scriptet: ellers svarer den rigtige Mac, og proevens
// programlaas rammer et andet program end kaldet (6b var groen af den grund, 30/9).
const APPS = { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', active: true }, { name: 'TextEdit', bundleId: 'com.apple.TextEdit', active: false }] };
// Og «hvem ejer punktet» (at) ogsaa: ellers laeses menneskets RIGTIGE skaerm, og
// prooven afhaenger af hvad der ligger under (5,5) (kørsel 2, 30/9: WhatsApp).
const AT = { found: true, bundleId: 'com.apple.finder', role: 'AXWindow', title: '', description: '', under: [] };
const saet = (o) => HJ.saetSvar({ apps: APPS, at: AT, ...o });
saet({ idle: { idle: 30 } });
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
  check('3 ...og det siger at agenten pauser og at skaermen kan tages tilbage', /waits if you are using the keyboard or mouse/.test(q?.scope || '') && /Take the screen back/.test(q?.scope || ''), q?.scope);
  await vent(200);
  navne = await S.navne();
  check('3 ...klienten faar besked om at vaerktoejerne aendrede sig', listeMeldt(S) > foerMeld, `${listeMeldt(S) - foerMeld} meldinger`);
  check('3 ...og move tilbydes nu', navne.includes('computer_move'));

  // 4. Med laanet: move virker - naar mennesket IKKE bruger maskinen.
  const m1 = await S.kald('computer_move', { x: 5, y: 5 });
  check('4 med laanet og ingen menneske-input: move udfoeres', !m1.fejl && flyt() === 1, m1.tekst.slice(0, 80));
  // 5. Mennesket bruger musen: agenten venter, intet flyttes.
  await vent(700);
  saet({ idle: { idle: 0.1 } });
  const m2 = await S.kald('computer_move', { x: 6, y: 6 });
  check('5 mennesket bruger maskinen: agenten venter, intet flyttes', m2.fejl && /using the keyboard or mouse/.test(m2.tekst) && flyt() === 1, m2.tekst.slice(0, 100));
  saet({ idle: { idle: 'ulaeseligt' } });   // scriptet: aldrig den rigtige hjaelper
  const m2b = await S.kald('computer_move', { x: 6, y: 6 });
  check('5b kan det ikke laeses om mennesket er der: intet flyttes', m2b.fejl && flyt() === 1, m2b.tekst.slice(0, 100));
  saet({ idle: { idle: 30 } });

  // 5c (runde 1, Astra 5 + Fable F2): pausen gaelder OGSAA stille kald med `app` under laanet.
  const t0 = HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'type').length;
  await vent(600);
  saet({ idle: { idle: 0.1 } });
  const ty = await S.kald('computer_type', { app: 'Finder', text: 'x' });
  check('5c under laanet pauser ogsaa et stille kald med app', ty.fejl && /using the keyboard or mouse/.test(ty.tekst)
        && HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'type').length === t0, ty.tekst.slice(0, 90));
  // 5d (Fable): input der er AELDRE end vores egen sidste handling, er vores eget - ingen pause.
  saet({ idle: { idle: 30 } });
  const forr5d = await S.kald('computer_move', { x: 5, y: 5 });
  check('forudsaetning 5d: flytningen foer blev udfoert', !forr5d.fejl, forr5d.tekst.slice(0, 120));
  await vent(200);
  saet({ idle: { idle: 4.5 } });                       // aeldre end vores egen handling, men under graensen
  const egen = await S.kald('computer_move', { x: 6, y: 6 });
  check('5d input fra foer vores egen sidste handling taeller ikke som et menneske', !egen.fejl, egen.tekst.slice(0, 90));
  // 5e (runde 4, Astra 3 + Fable 1): en skrivning via tilgaengeligheds-laget POSTER intet
  //    input - den maa ikke goere menneskets input fra foer den til «vores». Sidste
  //    rigtige input-handling ligger >3 s tilbage; AX-skrivningen lige nu.
  await vent(3200);
  saet({ idle: { idle: 30 }, type: { method: 'accessibility', verified: true } });
  const ax = await S.kald('computer_type', { app: 'Finder', text: 'hej' });
  check('forudsaetning 5e: AX-skrivningen blev udfoert', !ax.fejl, ax.tekst.slice(0, 100));
  saet({ idle: { idle: 1.8 } });                       // input for 1,8 s siden: FOER AX-skrivningen, EFTER sidste rigtige input
  const efterAx = await S.kald('computer_move', { x: 7, y: 7 });
  check('5e input foer en AX-skrivning er stadig menneskets - agenten venter', efterAx.fejl && /using the keyboard or mouse/.test(efterAx.tekst), efterAx.tekst.slice(0, 100));
  saet({ idle: { idle: 30 } });

  // D (7/10, panel R8-R9): skridtet VENTER paa at mennesket holder pause (hoejst 5 s),
  //    i stedet for at afvise og bede agenten kalde igen. Samme kald, én handling.
  await vent(300);
  saet({ idle: { idle: 0.1 } });
  const fD1 = flyt(); const tD1 = Date.now();
  setTimeout(() => saet({ idle: { idle: 30 } }), 1200);   // mennesket slipper musen efter 1,2 s
  const d1 = await S.kald('computer_move', { x: 9, y: 9 });
  const msD1 = Date.now() - tD1;
  check('D1 mennesket holder pause undervejs: skridtet venter og udfoeres i SAMME kald', !d1.fejl && flyt() === fD1 + 1 && msD1 >= 1000 && msD1 < 3000,
        `${msD1} ms · ${d1.tekst.slice(0, 60)}`);
  await vent(300);
  saet({ idle: { idle: 0.1 } });                            // mennesket bliver ved
  const fD3 = flyt(); const tD3 = Date.now();
  const d3 = await S.kald('computer_move', { x: 9, y: 9 });
  const msD3 = Date.now() - tD3;
  check('D3 mennesket bliver ved: afvist efter ventetiden, intet flyttes', d3.fejl && /using the keyboard or mouse/.test(d3.tekst) && flyt() === fD3
        && msD3 >= 4500 && msD3 < 6000, `${msD3} ms · ${d3.tekst.slice(0, 60)}`);
  // D4 (Astra R10): langsomme opslag (hvert ~1,8 s, under fristen paa 2 s) maa ikke
  //    traekke ventetiden over loftet. Maalt paa loglinjen «executing», der skrives
  //    lige efter ventetiden - foer den endelige vagt.
  await vent(300);
  saet({ idle: { idle: 0.1, _vent: 1700 } });
  const tD4 = Date.now();
  await S.kald('computer_move', { x: 9, y: 9 });
  const exD4 = readFileSync(join(STATE, 'audit.jsonl'), 'utf8').trim().split('\n').map(x => JSON.parse(x))
    .filter(x => x.tool === 'computer_move' && x.phase === 'executing').pop();
  const msD4 = exD4 ? Date.parse(exD4.ts) - tD4 : null;
  check('D4 langsomme opslag: ventetiden holder loftet paa 5 s', msD4 !== null && msD4 >= 4500 && msD4 < 6000, `${msD4} ms til «executing»`);
  saet({ idle: { idle: 30 } });
  const flytNu = flyt();

  // 6. Mennesket tager skaermen tilbage: lukket forbindelse = slut.
  const foer6 = listeMeldt(S);
  ikon.laan.destroy();
  await vent(300);
  navne = await S.navne();
  const m3 = await S.kald('computer_move', { x: 7, y: 7 });
  check('6 skaermen taget tilbage: listen meldes, move skjult og afvist', listeMeldt(S) > foer6 && !navne.includes('computer_move') && m3.fejl && flyt() === flytNu,
        `${listeMeldt(S) - foer6} meldinger · ${m3.tekst.slice(0, 60)}`);

  // 6b (runde 1, Astra 4): et kald der VENTER paa programlaasen, mens laanet tilbagekaldes,
  //    maa ikke udfoeres bagefter. Proeven holder selv laasen.
  ikon.svar = 'ja'; ikon.laanMs = 60_000;
  { const f = await S.kald('computer_request_screen', { action: 'request', reason: 'move the pointer', minutes: 2 });
    check('forudsaetning: laanet til «move the pointer» blev givet', /"granted":\s*true/.test(f.tekst), f.tekst.slice(0, 120)); }
  const LAAS = join(STATE, 'laase'); mkdirSync(LAAS, { recursive: true });
  writeFileSync(join(LAAS, 'com.apple.finder.lock'), String(process.pid));
  const f6 = flyt();
  const venter6 = S.kald('computer_move', { x: 9, y: 9 });
  await vent(2000); ikon.laan.destroy(); await vent(300);   // 2 s: kaldet skal have naaet laasen (500 ms var for lidt paa en belastet maskine, 30/9)
  unlinkSync(join(LAAS, 'com.apple.finder.lock'));
  const r6 = await venter6;
  check('6b laanet sluttede mens kaldet ventede paa laasen: intet flyttes', r6.fejl && /screen loan changed while this waited/.test(r6.tekst) && flyt() === f6, r6.tekst.slice(0, 90));

  // 6c (runde 2, Astra 1): en STILLE skrivning (type med app) doemt under laanet, der
  //    venter paa laasen mens laanet slutter, sker heller ikke.
  { const f = await S.kald('computer_request_screen', { action: 'request', reason: 'type in Finder', minutes: 2 });
    check('forudsaetning: laanet til «type in Finder» blev givet', /"granted":\s*true/.test(f.tekst), f.tekst.slice(0, 120)); }
  writeFileSync(join(LAAS, 'com.apple.finder.lock'), String(process.pid));
  const ty0 = HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'type').length;
  const venter6c = S.kald('computer_type', { app: 'Finder', text: 'x' });
  await vent(2000); ikon.laan.destroy(); await vent(300);   // 2 s: kaldet skal have naaet laasen (500 ms var for lidt paa en belastet maskine, 30/9)
  unlinkSync(join(LAAS, 'com.apple.finder.lock'));
  const r6c = await venter6c;
  check('6c en stille skrivning doemt under laanet sker ikke efter laanets slut', r6c.fejl && /screen loan changed while this waited/.test(r6c.tekst)
        && HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'type').length === ty0, r6c.tekst.slice(0, 90));

  // 6d (runde 2, Fable 3): en skrivning der KOERER naar mennesket tager skaermen tilbage, stoppes.
  { const f = await S.kald('computer_request_screen', { action: 'request', reason: 'type a long text', minutes: 2 });
    check('forudsaetning: laanet til «type a long text» blev givet', /"granted":\s*true/.test(f.tekst), f.tekst.slice(0, 120)); }
  saet({ idle: { idle: 30 }, type: { _vent: 4000, typed: 99 } });
  const loeber = S.kald('computer_type', { app: 'Finder', text: 'en lang tekst' });
  await vent(1200); ikon.laan.destroy();
  const r6d = await loeber;
  check('6d en kørende skrivning stoppes naar skaermen tages tilbage', r6d.fejl && /screen loan ended while this ran/.test(r6d.tekst), r6d.tekst.slice(0, 90));
  saet({ idle: { idle: 30 } });

  // 6f (runde 4, Astra 4): et paste der KOERER naar laanet slutter, faar besked om at
  //    stoppe foer Cmd+V (SIGUSR1) - ikke et drab der ville tabe udklipsholderen.
  { const f = await S.kald('computer_request_screen', { action: 'request', reason: 'paste a paragraph', minutes: 2 });
    check('forudsaetning: laanet til «paste a paragraph» blev givet', /"granted":\s*true/.test(f.tekst), f.tekst.slice(0, 120)); }
  saet({ idle: { idle: 30 }, paste: { _vent: 4000, pasted: true } });
  const pl = S.kald('computer_paste', { text: 'et langt afsnit' });
  await vent(1500); ikon.laan.destroy();
  const r6f = await pl;
  const sig = HJ.kald().filter(k => k.signal === 'SIGUSR1' && k.argv[0] === 'paste').length;
  check('6f et koerende paste faar SIGUSR1 og stopper foer Cmd+V', sig === 1 && r6f.fejl && /stopped before pasting/.test(r6f.tekst), `${sig} signal · ${r6f.tekst.slice(0, 80)}`);
  saet({ idle: { idle: 30 } });

  // 6g (runde 5, Astra 1): et kald startet UDEN laan, hvor et laan begynder OG slutter
  //    mens det venter paa laasen. «Intet laan» foer og efter er ikke «uaendret».
  // ⛔ 7/10 (punkt I): toerkoerslen svarer fast med en harmloes knap. Uden svar afviser
  //    porten nu trykket FOER laasen (maalet kan ikke vises) - og saa maaler 6g ikke laanet.
  saet({ idle: { idle: 30 }, 'press --dry': { would_press: { name: 'OK', role: 'AXButton' } } });
  writeFileSync(join(LAAS, 'com.apple.TextEdit.lock'), String(process.pid));
  const p6g0 = HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'press').length;
  const venter6g = S.kald('computer_press', { app: 'TextEdit', role: 'AXButton', title: 'OK' });
  await vent(1500);
  { const f = await S.kald('computer_request_screen', { action: 'request', reason: 'a moment', minutes: 2 });
    check('forudsaetning 6g: laanet mellem start og udfoerelse blev givet', /"granted":\s*true/.test(f.tekst), f.tekst.slice(0, 100)); }
  await S.kald('computer_request_screen', { action: 'release' });
  await vent(300);
  unlinkSync(join(LAAS, 'com.apple.TextEdit.lock'));
  const r6g = await venter6g;
  check('6g et laan der begyndte og sluttede mens kaldet ventede: intet udfoeres', r6g.fejl && /screen loan changed while this waited/.test(r6g.tekst)
        && HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'press').length === p6g0, r6g.tekst.slice(0, 110));

  // 6e (runde 2, Astra 1): to anmodninger paa én gang fra samme agent. Den anden afvises
  //    («already waiting»); den foerste godkendes - og naar den tages tilbage, SLUTTER den.
  ikon.svar = 'langsom';
  const [la, lb] = await Promise.all([
    S.kald('computer_request_screen', { action: 'request', reason: 'first', minutes: 2 }),
    (async () => { await vent(100); return S.kald('computer_request_screen', { action: 'request', reason: 'second', minutes: 2 }); })()]);
  check('6e den anden samtidige anmodning afvises', lb.fejl && /already has a question waiting/.test(lb.tekst) && !la.fejl, `${la.tekst.slice(0, 40)} | ${lb.tekst.slice(0, 60)}`);
  const meld6e = listeMeldt(S);
  ikon.laan.destroy(); await vent(300);
  const st6e = await S.kald('computer_request_screen', { action: 'status' });
  check('6e ...og naar den godkendte tages tilbage, er laanet SLUT (listen meldt)', /background/.test(st6e.tekst) && listeMeldt(S) > meld6e, st6e.tekst.slice(0, 80));
  ikon.svar = 'ja';

  // D2 (7/10): laanet tages tilbage MENS skridtet venter paa pause: intet sker.
  { const f = await S.kald('computer_request_screen', { action: 'request', reason: 'move once', minutes: 1 });
    check('forudsaetning D2: laanet blev givet', /"granted":\s*true/.test(f.tekst), f.tekst.slice(0, 80)); }
  await vent(300);
  saet({ idle: { idle: 0.1 } });
  const fD2 = flyt();
  const pD2 = S.kald('computer_move', { x: 3, y: 3 });
  await vent(800); ikon.laan?.destroy();
  const d2 = await pD2;
  check('D2 laanet taget tilbage under ventetiden: intet flyttes', d2.fejl && flyt() === fD2, d2.tekst.slice(0, 90));
  saet({ idle: { idle: 30 } });
  await vent(300);

  // 7. Tiden udloeber: vores eget ur, ogsaa hvis ikonet ikke lukker.
  ikon.laanMs = 1200;
  await S.kald('computer_request_screen', { action: 'request', reason: 'move a window', minutes: 1 });
  const lukFoer = ikon.lukketAfServer;
  const flyt7 = flyt();
  const meldFoer7 = listeMeldt(S);
  await vent(1700);
  const m4 = await S.kald('computer_move', { x: 8, y: 8 });
  check('7 laanet udloeb: move afvist uden at ikonet lukkede', m4.fejl && flyt() === flyt7, m4.tekst.slice(0, 80));
  await vent(200);
  check('7 ...og serveren lukkede selv forbindelsen', ikon.lukketAfServer > lukFoer, `${ikon.lukketAfServer - lukFoer}`);
  check('7b ...og klienten fik besked om at vaerktoejerne forsvandt (Fable F6)', listeMeldt(S) > meldFoer7, `${listeMeldt(S) - meldFoer7}`);

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

  // 9b (runde 1, Astra 8): en grund over loftet spoerges ikke - den klippes ikke tavst.
  ikon.svar = 'ja';
  const foer9b = ikon.spurgt.length;
  const lang = await S.kald('computer_request_screen', { action: 'request', reason: 'x'.repeat(4100), minutes: 2 });
  check('9b en grund over loftet: afvist, ikonet ikke spurgt', lang.fejl && /more than the 4000/.test(lang.tekst) && ikon.spurgt.length === foer9b, lang.tekst.slice(0, 90));

  // 10. Et nej er et nej.
  ikon.svar = 'nej';
  const nej = await S.kald('computer_request_screen', { action: 'request', reason: 'drag it', minutes: 2 });
  check('10 mennesket siger nej: afvist, move stadig skjult', nej.fejl && !(await S.navne()).includes('computer_move'), nej.tekst.slice(0, 80));
  check('ingen osascript-dialog i hele forloebet', S.sp.gangeSpurgt() === 0, `${S.sp.gangeSpurgt()} · ${JSON.stringify(S.sp.tekster?.() || []).slice(0, 300)}`);
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

// 12. ⛔ 1/10 (skaerm-koe-panelet): skaerm-anmodninger ventede foer paa det
//    almindelige 60 s-spoergsmaals-vindue (CMCP_ASK_TIMEOUT). Nu har de deres eget,
//    laengere - bevist her ved at goere det MODSATTE: saette skaerm-vinduet
//    KORTERE end askTimeout, og vise at skaerm-vinduet er det der afgoer det. Hvis
//    koden ved et uheld blev lagt tilbage til askTimeout() (3 s i denne proeve),
//    ville et svar efter 800 ms stadig naa frem - her SKAL det IKKE naa frem.
const STATE3 = mkdtempSync(join(tmpdir(), 'cmcp-laan-vent-'));
const ikon3 = await lavIkon(STATE3);
ikon3.svar = 'langsom'; ikon3.laanMs = 60_000;        // svarer ja efter 800 ms
const V = server(STATE3, HJ, { CMCP_SCREEN_WAIT: '0.5', CMCP_ASK_TIMEOUT: '3' });
try {
  await V.klar();
  const t0 = Date.now();
  const r = await V.kald('computer_request_screen', { action: 'request', reason: 'kort skaerm-vindue', minutes: 2 });
  const ms = Date.now() - t0;
  check('12 skaermVentetid() - ikke askTimeout() - styrer ventetiden paa et skaerm-laan',
        r.fejl && /nobody answered in the menu bar in time/.test(r.tekst) && ms < 2500,
        `${ms} ms · ${r.tekst.slice(0, 90)}`);
} finally { V.srv.kill(); }

// 13. ⛔ 2/10 (skaerm-koe-panelet, trin 2): en skaerm-anmodning fra en ANDEN agent,
//    mens et laan allerede er aktivt, bliver IKKE laengere afvist med «optaget» -
//    den staar i koe, og serveren venter taalmodigt (den goer det allerede, trin 1:
//    skaermVentetid()). TO servere (to agent-processer, samme ikon-socket) - en
//    enkelt proces ville ramme 6e's «already waiting»-vagt foer den naaede koen.
const STATE4 = mkdtempSync(join(tmpdir(), 'cmcp-laan-koe-'));
const ikon4 = await lavIkon(STATE4);
ikon4.svar = 'koe'; ikon4.laanMs = 60_000;
const K1 = server(STATE4, HJ, { CMCP_SCREEN_WAIT: '10' });
const K2 = server(STATE4, HJ, { CMCP_SCREEN_WAIT: '10' });
try {
  await Promise.all([K1.klar(), K2.klar()]);
  const foerste = await K1.kald('computer_request_screen', { action: 'request', reason: 'first in line', minutes: 2 });
  check('13 foerste agent: laanet givet straks', /"granted":\s*true/.test(foerste.tekst), foerste.tekst.slice(0, 90));
  const foerAnden = Date.now();
  let andenSvaret = null;
  const anden = K2.kald('computer_request_screen', { action: 'request', reason: 'second in line', minutes: 2 }).then(r => { andenSvaret = r; return r; });
  await vent(800);
  check('13b anden agent staar STADIG og venter i koe - IKKE afvist som «optaget»',
        andenSvaret === null && ikon4.koe.length === 1, `svaret: ${JSON.stringify(andenSvaret)} · koe: ${ikon4.koe.length}`);
  ikon4.laan.destroy();   // foerste agent giver slip -> koeen aabner for den anden
  const r = await anden;
  check('13c anden agent godkendes naar foerste slutter - uden selv at spoerge forfra',
        /"granted":\s*true/.test(r.tekst) && (Date.now() - foerAnden) > 700, `${Date.now() - foerAnden} ms · ${r.tekst.slice(0, 80)}`);
} finally { K1.srv.kill(); K2.srv.kill(); }

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
