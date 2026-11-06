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
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';
// S1b: skridt venter selv paa mennesket (standard 40 s); proeven bruger en kort ventetid.
process.env.CMCP_WAIT_SEK = process.env.CMCP_WAIT_SEK || '5';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = ms => new Promise(r => setTimeout(r, ms));

function lavIkon(state) {
  const ikon = { svar: 'ja', laanMs: 60_000, spurgt: [], laan: null, lukketAfServer: 0, koe: [] };
  // R3: slut laanet som det rigtige ikon goer - grunden («taken-back», «stopped-all», «expired») foerst, saa lukning.
  ikon.slut = (grund) => { try { ikon.laan.write(JSON.stringify({ nonce: ikon.laanNonce, ended: grund }) + '\n'); } catch {} setTimeout(() => ikon.laan.destroy(), 30); };
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
          // R3: et laan uden spoergsmaal faar «queued» tilbage, som det rigtige ikon sender (meldKoe).
          if (q.ask === false && !ikon.ingenKoeSvar) sock.write(JSON.stringify({ nonce: q.nonce, queued: true }) + '\n');
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
      } else if (ikon.svar === 'staaende') {           // 2/11: mennesket har slaaet spoergsmaalet fra - ikonet giver straks
        sock.write(JSON.stringify({ nonce: q.nonce, ok: true, verified: 'standing', until: Date.now() + ikon.laanMs }) + '\n');
        ikon.laan = sock; ikon.laanNonce = q.nonce; sock.on('end', () => { ikon.lukketAfServer++; });
        // R4: «straksTilbage» - mennesket tager skaermen, mens serveren stadig behandler ja'et (maalingen koerer op til 1,5 s).
        if (ikon.straksTilbage) { sock.write(JSON.stringify({ nonce: q.nonce, ended: 'taken-back' }) + '\n'); setTimeout(() => sock.destroy(), 5); }
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
    async beskrivelse(navn) { return ((await rpc('tools/list')).result?.tools || []).find(t => t.name === navn)?.description || ''; },
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
  // R42: kontrollen af det aktive program (inde i laasen) kan stoppe den et skridt foer laanets egen kontrol.
  check('6c en stille skrivning doemt under laanet sker ikke efter laanets slut', r6c.fejl && /screen loan changed while this waited|became the window the person is working in again/.test(r6c.tekst)
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
  check('9b en grund over loftet: afvist, ikonet ikke spurgt', lang.fejl && /at most 2\d\d/.test(lang.tekst) && ikon.spurgt.length === foer9b, lang.tekst.slice(0, 90));
  // 9c (R24, Opus MAALT: 334 tegn gav kun Deny i boksen): over 280 tegn spoerges ikke -
  //    paa 280 spoerges der, saa Allow altid staar i boksen, naar mennesket bliver spurgt.
  const foer9c = ikon.spurgt.length;
  //    Serveren saetter «Use your screen for 2 minutes: » (31 tegn) foran, saa grunden har 249.
  const over = await S.kald('computer_request_screen', { action: 'request', reason: 'y'.repeat(250), minutes: 2 });
  const paa = await S.kald('computer_request_screen', { action: 'request', reason: 'z'.repeat(249), minutes: 2 });
  const hel = ikon.spurgt.at(-1)?.text || '';
  check('9c hele spoergsmaalet over 280 tegn: afvist uden spoergsmaal · paa 280: spurgt, og boksen kan vise det helt',
    over.fejl && /at most 249/.test(over.tekst) && ikon.spurgt.length === foer9c + 1 && [...hel].length === 280 && hel.endsWith('z'.repeat(249)),
    `${over.tekst.slice(0, 60)} · spurgt ${ikon.spurgt.length - foer9c} · ${[...hel].length} tegn · ${paa.tekst.slice(0, 80)}`);
  if (!paa.fejl) await S.kald('computer_request_screen', { action: 'release' });

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

// 14. ⛔ 2/11 (Gustav: «fjern det der med, at den skal spoerge om lov til at faa adgang til skaermen. Det skal den bare
//    goere, blive ved med, indtil den har det»): med CMCP_SCREEN_ASK=0 beder serveren ikonet om laanet UDEN et
//    spoergsmaal (ask:false), og ikonet giver det straks - stadig én agent ad gangen, og hvert skridt venter stadig,
//    mens mennesket bruger tastatur eller mus. Uden kontakten maa et «standing»-svar ALDRIG give skaermen: et ikon
//    (eller noget andet paa soklen), der svarer uden at mennesket har slaaet spoergsmaalet fra, faar et nej.
const laanLog = (st) => { try { return readFileSync(join(st, 'audit.jsonl'), 'utf8').trim().split('\n').map(x => JSON.parse(x)).filter(x => x.tool === 'computer_request_screen' && x.decision); } catch { return []; } };
for (const [navn, ekstra, uden] of [['uden kontakten', {}, false], ['tastefejl «maybe»', { CMCP_SCREEN_ASK: 'maybe' }, false], ['CMCP_SCREEN_ASK=0', { CMCP_SCREEN_ASK: '0' }, true], ['CMCP_SCREEN_ASK=nej', { CMCP_SCREEN_ASK: 'nej' }, true]]) {
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-uden-'));
  const ik = await lavIkon(st);
  ik.svar = 'staaende';
  const A = server(st, HJ, ekstra);
  try {
    await A.klar();
    saet({ idle: { idle: 30 } });
    const besk = await A.beskrivelse('computer_request_screen');
    check(`14 ${navn}: vaerktoejsbeskrivelsen ${uden ? 'siger at ingen spoerges' : 'sender stadig mennesket til Allow (Touch ID)'}`,
          uden ? /without a question/.test(besk) && !/press Allow/.test(besk) : /press Allow \(Touch ID\)/.test(besk) && !/without a question/.test(besk), besk.slice(0, 120));
    // R1 (Opus 🔴): et stop maa ikke blive til «spoerg igen» - beskrivelsen skal sige stop og spoerg i chatten.
    if (uden) check(`14 ${navn}: efter «tag tilbage»/Esc siger beskrivelsen stop og spoerg i chatten - aldrig «ask again» om stoppet`,
          /take[s]? the screen back[\s\S]{0,200}stop: tell them in the chat[\s\S]{0,80}never request the screen again by yourself/.test(besk), besk.slice(0, 160));
    const r = await A.kald('computer_request_screen', { action: 'request', reason: 'upload seven images', minutes: 3 });
    const q = ik.spurgt.at(-1);
    if (!uden) {
      check(`14 ${navn}: ikonet bedes SPOERGE (ask ikke false)`, q && q.ask !== false, JSON.stringify(q || {}).slice(0, 120));
      check(`14 ${navn}: et «standing»-svar giver IKKE skaermen`, r.fejl && !(await A.navne()).includes('computer_move'), r.tekst.slice(0, 100));
    } else {
      check(`14 ${navn}: ikonet bedes give laanet uden spoergsmaal (ask:false)`, q?.ask === false && q?.kind === 'screen', JSON.stringify(q || {}).slice(0, 120));
      // R2 (Opus 🔴): boksens tekst siger at tavshed giver skaermen, og at Deny siger nej - ikke «If you allow it».
      check(`14 ${navn}: boksens tekst siger «without a question» og «Deny», ikke «If you allow it»`,
            /without a question/.test(q?.scope || '') && /Deny/.test(q?.scope || '') && !/If you allow it/.test(q?.scope || ''), (q?.scope || '').slice(0, 140));
      check(`14 ${navn}: laanet givet straks`, !r.fejl && /"granted":\s*true/.test(r.tekst), r.tekst.slice(0, 100));
      const linje = laanLog(st).at(-1);
      check(`14 ${navn}: loggen siger «givet uden at spoerge», ikke at mennesket bekraeftede`,
            linje?.decision === 'allowed' && linje?.asked === false && /without asking/.test(linje?.reason || '') && !/confirmed it was them/.test(linje?.reason || ''), JSON.stringify(linje || {}).slice(0, 200));
      const f0 = HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'move').length;
      const m1 = await A.kald('computer_move', { x: 5, y: 5 });
      check(`14 ${navn}: ingen menneske-input - move udfoeres`, !m1.fejl && HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'move').length === f0 + 1, m1.tekst.slice(0, 80));
      await vent(700);
      saet({ idle: { idle: 0.1 } });
      const m2 = await A.kald('computer_move', { x: 6, y: 6 });
      check(`14 ${navn}: mennesket bruger musen - agenten VENTER stadig, intet flyttes`,
            m2.fejl && /using the keyboard or mouse/.test(m2.tekst) && HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'move').length === f0 + 1, m2.tekst.slice(0, 100));
      saet({ idle: { idle: 30 } });
    }
  } finally { A.srv.kill(); }
}

// 14b (panel R1, Astra P2): med kontakten slaaet til, men et AELDRE ikon der stadig spoerger og svarer «owner» (eller et
//    menneske der svarer i boksen under spaerringen): laanet gives, og loggen siger at mennesket BLEV spurgt.
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-gl-'));
  const ik = await lavIkon(st);
  ik.svar = 'ja';
  const A = server(st, HJ, { CMCP_SCREEN_ASK: '0' });
  try {
    await A.klar();
    const r = await A.kald('computer_request_screen', { action: 'request', reason: 'older icon still asks', minutes: 2 });
    const linje = laanLog(st).at(-1);
    check('14b kontakten til + et ikon der spoerger og svarer «owner»: laanet givet', !r.fejl && /"granted":\s*true/.test(r.tekst), r.tekst.slice(0, 90));
    check('14b ...og loggen siger asked:true og «confirmed it was them» - ikke «without asking»',
          linje?.decision === 'allowed' && linje?.asked === true && /confirmed it was them/.test(linje?.reason || ''), JSON.stringify(linje || {}).slice(0, 200));
  } finally { A.srv.kill(); }
}

// 14d (panel R3, Astra P2): et AELDRE ikon (intet «queued»), kontakten til, ventetiden loeber ud: ingen ved om mennesket
//    blev spurgt - svaret siger IKKE «ask again», og loggen siger asked:null (ukendt), ikke false.
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-gk-'));
  const ik = await lavIkon(st); ik.svar = 'koe'; ik.laanMs = 60_000; ik.ingenKoeSvar = true;
  const K1 = server(st, HJ, { CMCP_SCREEN_ASK: '0', CMCP_SCREEN_WAIT: '1' });
  const K2 = server(st, HJ, { CMCP_SCREEN_ASK: '0', CMCP_SCREEN_WAIT: '1' });
  try {
    await Promise.all([K1.klar(), K2.klar()]);
    await K1.kald('computer_request_screen', { action: 'request', reason: 'first', minutes: 2 });
    const b = await K2.kald('computer_request_screen', { action: 'request', reason: 'second', minutes: 2 });
    const linje = laanLog(st).filter(x => x.decision === 'denied').at(-1);
    check('14d aeldre ikon uden «queued»: ventetiden loeb ud - IKKE «ask again», men det almindelige «do not ask again»',
          b.fejl && !/ask again in a moment/.test(b.tekst) && /do not ask again/.test(b.tekst), b.tekst.slice(0, 160));
    check('14d ...og loggen siger asked:null (ukendt)', linje && linje.asked === null, JSON.stringify(linje || {}).slice(0, 160));
  } finally { K1.srv.kill(); K2.srv.kill(); }
}

// 15c (panel R4, Opus, MAALT 7/7): en RIGTIG MCP-klient lukker saadan (SDK 1.32.1, client/stdio.js): stdin slutter -> 2 s ->
//    SIGTERM -> 2 s -> SIGKILL. Det fastlaaste traek skal vaere draebt og knappen sluppet, foer klienten draeber serveren.
{
  const { Client } = await import(join(ROOT, 'mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'index.js'));
  const { StdioClientTransport } = await import(join(ROOT, 'mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'stdio.js'));
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-sdk-'));
  const ik = await lavIkon(st); ik.svar = 'staaende'; ik.laanMs = 60_000;
  const sp = lavFalskSpoerger('ja', 'cmcp-laan-sdk-sp');
  const env = { ...process.env, CMCP_STATE_DIR: st, CMCP_MODE: 'allow', CMCP_HELPER: HJ.sti, CMCP_MENNESKE_SEK: '5', CMCP_ASK_TIMEOUT: '3',
                CMCP_STATUS_IKON: '0', CMCP_OSASCRIPT: sp.sti, CMCP_SCREEN_ASK: '0' };
  delete env.CMCP_BACKGROUND;
  const tr = new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'mcp-server', 'index.js')], env, stderr: 'ignore' });
  const kl = new Client({ name: 'sdk-luk', version: '1' });
  try {
    await kl.connect(tr);
    saet({ idle: { idle: 30 } });
    const l = await kl.callTool({ name: 'computer_request_screen', arguments: { action: 'request', reason: 'drag a file', minutes: 3 } });
    saet({ idle: { idle: 30 }, drag: { _vent: 9000, _ignorerTerm: true, dragged: true } });
    const klar0 = HJ.klar('drag'); const term0 = HJ.termModtaget('drag');
    kl.callTool({ name: 'computer_drag', arguments: { fromX: 10, fromY: 10, toX: 50, toY: 50 } }).catch(() => null);
    const lever = () => { try { return execFileSync('/usr/bin/pgrep', ['-f', `${dirname(HJ.sti)}/[^ ]+ drag`]).toString().trim().split('\n').filter(Boolean).length; } catch { return 0; } };
    // 6/11: vent til attrappen HAR sat sin SIGTERM-handler (klar), ikke blot til processen findes - ellers kapløb (15b/15c).
    let foer = 0; for (let i = 0; i < 50 && !(foer && HJ.klar('drag') >= klar0 + 1); i++) { await vent(100); foer = lever(); }
    const slip0 = HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'release-mouse').length;
    const pid = tr.pid;
    const t0 = Date.now();
    await kl.close();
    const ms = Date.now() - t0;
    await vent(300);
    const slip = HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'release-mouse').length - slip0;
    let serverLever = true; try { process.kill(pid, 0); } catch { serverLever = false; }
    check('15c forudsaetning: laanet givet og traekket koerte (attrappen naaede «klar»)', !l.isError && foer >= 1 && HJ.klar('drag') >= klar0 + 1, `${JSON.stringify(l.content?.[0]?.text || '').slice(0, 60)} · ${foer} · klar ${HJ.klar('drag') - klar0}`);
    // R18 (Opus M13 overlevede): stopOgVent skal SIGTERM'e foerst - en rigtig key/type-hjaelper slipper saa sin tast selv.
    check('15c ...og traekket fik SIGTERM FOER SIGKILL (stopOgVent springer ikke det blide trin over)', HJ.termModtaget('drag') - term0 >= 1, `${HJ.termModtaget('drag') - term0} SIGTERM`);
    check('15c en rigtig MCP-klient lukker: traekket draebt og knappen sluppet, og serveren gik selv - allerede da stdin sluttede (foer klientens SIGTERM efter 2 s)',
          lever() === 0 && slip >= 1 && !serverLever && ms < 1900, `close ${ms} ms · traek lever=${lever()} · release-mouse=${slip} · server lever=${serverLever}`);
  } finally { try { await kl.close(); } catch {} saet({ idle: { idle: 30 } }); }
}

// 16b/c (panel R3, Astra): ikonet SIGER hvorfor laanet slutter. «taken-back» i laanets sidste sekunder er stadig et stop
//    (tidsgaetningen ville misse det); «expired» tidligt er IKKE et stop.
for (const [navn, grund, efterMs, laanMs, stop] of [['16b taken-back i laanets sidste sekund', 'taken-back', 2600, 3000, true],
                                                     ['16c expired tidligt (fx et ur der sprang)', 'expired', 300, 60_000, false]]) {
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-sg-'));
  const ik = await lavIkon(st); ik.svar = 'staaende'; ik.laanMs = laanMs;
  const A = server(st, HJ, { CMCP_SCREEN_ASK: '0' });
  try {
    await A.klar();
    const r = await A.kald('computer_request_screen', { action: 'request', reason: 'drag a file', minutes: 3 });
    await vent(efterMs);
    ik.slut(grund);
    await vent(400);
    const igen = await A.kald('computer_request_screen', { action: 'request', reason: 'drag again', minutes: 3 });
    check(`${navn}: ${stop ? 'afvist med stop-beskeden' : 'IKKE et stop - laanet gives igen'}`,
          !r.fejl && (stop ? igen.fejl && /took the screen back/.test(igen.tekst) : !igen.fejl && /"granted":\s*true/.test(igen.tekst)), igen.tekst.slice(0, 140));
  } finally { A.srv.kill(); }
}

// 16g (panel R4, Astra P1): mennesket tager skaermen, MENS serveren stadig behandler ja'et - stadig et stop.
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-tidl-'));
  const ik = await lavIkon(st); ik.svar = 'staaende'; ik.laanMs = 60_000; ik.straksTilbage = true;
  const A = server(st, HJ, { CMCP_SCREEN_ASK: '0' });
  try {
    await A.klar();
    const r1 = await A.kald('computer_request_screen', { action: 'request', reason: 'quick drag', minutes: 1 });
    ik.straksTilbage = false;
    const r2 = await A.kald('computer_request_screen', { action: 'request', reason: 'quick drag again', minutes: 1 });
    check('16g forudsaetning: laanet blev taget tilbage i samme oejeblik, som det blev givet', r1.fejl && /taken back the moment it was given/.test(r1.tekst), r1.tekst.slice(0, 100));
    check('16g taget tilbage foer laanet var registreret: den naeste anmodning faar stop-beskeden (ikke et nyt laan uden spoergsmaal)',
          r2.fejl && /took the screen back/.test(r2.tekst) && /do not request the screen again by yourself/.test(r2.tekst), `${r1.tekst.slice(0, 70)} · ${r2.tekst.slice(0, 110)}`);
  } finally { A.srv.kill(); }
}

// 16h (panel R4, Opus MC overlevede): en «ended»-linje med forkert nonce taeller ikke, og den staerkeste grund vinder.
for (const [navn, linjer, stop] of [['16h forkert nonce paa «taken-back», saa «expired»: IKKE et stop', [['forkert', 'taken-back'], [null, 'expired']], false],
                                     ['16h «taken-back» og bagefter «expired» (samme nonce): stoppet vinder', [[null, 'taken-back'], [null, 'expired']], true]]) {
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-nc-'));
  const ik = await lavIkon(st); ik.svar = 'staaende'; ik.laanMs = 60_000;
  const A = server(st, HJ, { CMCP_SCREEN_ASK: '0' });
  try {
    await A.klar();
    await A.kald('computer_request_screen', { action: 'request', reason: 'job', minutes: 1 });
    await vent(1700);
    for (const [nonce, grund] of linjer) ik.laan.write(JSON.stringify({ nonce: nonce || ik.laanNonce, ended: grund }) + '\n');
    setTimeout(() => ik.laan.destroy(), 30);
    await vent(400);
    const igen = await A.kald('computer_request_screen', { action: 'request', reason: 'job again', minutes: 1 });
    check(navn, stop ? igen.fejl && /took the screen back/.test(igen.tekst) : !igen.fejl && /"granted":\s*true/.test(igen.tekst), igen.tekst.slice(0, 120));
  } finally { A.srv.kill(); }
}

// 16h2 (panel R5, Astra): en «ended», der ikke er en tekst, taeller ikke - et array kan ikke overskrive et rigtigt stop, og et
//     objekt uden toString faar ikke serveren til at gaa ned.
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-ty-'));
  const ik = await lavIkon(st); ik.svar = 'staaende'; ik.laanMs = 60_000;
  const A = server(st, HJ, { CMCP_SCREEN_ASK: '0' });
  try {
    await A.klar();
    await A.kald('computer_request_screen', { action: 'request', reason: 'job', minutes: 1 });
    await vent(1700);
    ik.laan.write(JSON.stringify({ nonce: ik.laanNonce, ended: { toString: null } }) + '\n');
    ik.laan.write(JSON.stringify({ nonce: ik.laanNonce, ended: 'taken-back' }) + '\n');
    ik.laan.write(JSON.stringify({ nonce: ik.laanNonce, ended: ['taken-back'] }) + '\n');
    setTimeout(() => ik.laan.destroy(), 30);
    await vent(400);
    const lever = A.srv.exitCode === null && A.srv.signalCode === null;
    const igen = lever ? await A.kald('computer_request_screen', { action: 'request', reason: 'job again', minutes: 1 }) : { fejl: true, tekst: 'serveren doede' };
    check('16h2 en «ended» der ikke er tekst: serveren lever, og det rigtige stop staar', lever && igen.fejl && /took the screen back/.test(igen.tekst), igen.tekst.slice(0, 120));
  } finally { A.srv.kill(); }
}

// 16j (panel R5, Opus F3, MAALT 60 MB -> 263 MB uden loft): et ikon der sender uden linjeskift, faar ikke serverens hukommelse -
//     forbindelsen lukkes, og laanet er slut.
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-bf-'));
  const ik = await lavIkon(st); ik.svar = 'staaende'; ik.laanMs = 60_000;
  const A = server(st, HJ, { CMCP_SCREEN_ASK: '0' });
  try {
    await A.klar();
    await A.kald('computer_request_screen', { action: 'request', reason: 'job', minutes: 1 });
    ik.laan.write('x'.repeat(70_000));
    await vent(500);
    const st2 = await A.kald('computer_request_screen', { action: 'status' });
    check('16j over 64 KB uden linjeskift: forbindelsen lukket, laanet slut', /background/.test(st2.tekst) && A.srv.exitCode === null, st2.tekst.slice(0, 100));
  } finally { A.srv.kill(); }
}

// 16i (panel R4, Astra P2): et skridt der venter paa en ANDEN agents programlaas, da mennesket tager skaermen - naar laasens ventetid
//    udloeber, er svaret stoppet, ikke «Try again shortly».
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-pl-'));
  const ik = await lavIkon(st); ik.svar = 'staaende'; ik.laanMs = 60_000;
  const A = server(st, HJ, { CMCP_SCREEN_ASK: '0', CMCP_CALL_BUDGET: '4' });
  try {
    await A.klar();
    saet({ idle: { idle: 30 } });
    await A.kald('computer_request_screen', { action: 'request', reason: 'type a note', minutes: 3 });
    mkdirSync(join(st, 'laase'), { recursive: true });
    writeFileSync(join(st, 'laase', 'com.apple.TextEdit.lock'), String(process.pid));     // en anden levende agent holder laasen
    const skridt = A.kald('computer_type', { app: 'TextEdit', text: 'x' });
    await vent(900);
    ik.slut('taken-back');
    const sv = await skridt;
    check('16i laasens ventetid udloeb efter «tag tilbage»: stoppet, ikke «Try again shortly»',
          sv.fejl && /do not request the screen again by yourself/.test(sv.tekst) && !/Try again shortly/.test(sv.tekst), sv.tekst.slice(0, 160));
  } finally { A.srv.kill(); try { unlinkSync(join(st, 'laase', 'com.apple.TextEdit.lock')); } catch {} }
}

// 16f (panel R3, Opus M-Op1 overlevede): et laan der UDLOEBER, og et agenten selv giver tilbage, er IKKE et stop - det
//    naeste laan gives uden spoergsmaal. (Et udloeb lukkes af serverens eget ur; ikonet sender ingen grund.)
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-nu-'));
  const ik = await lavIkon(st); ik.svar = 'staaende'; ik.laanMs = 1200;
  const A = server(st, HJ, { CMCP_SCREEN_ASK: '0' });
  try {
    await A.klar();
    const r1 = await A.kald('computer_request_screen', { action: 'request', reason: 'short job', minutes: 1 });
    await vent(2000);                                                    // laanet udloeb (1,2 s) - serveren lukkede selv
    const r2 = await A.kald('computer_request_screen', { action: 'request', reason: 'next job', minutes: 1 });
    check('16f et laan der udloeb: IKKE et stop - det naeste gives uden spoergsmaal',
          !r1.fejl && !r2.fejl && /"granted":\s*true/.test(r2.tekst) && ik.spurgt.at(-1)?.ask === false, `${r2.tekst.slice(0, 120)} · ask=${ik.spurgt.at(-1)?.ask}`);
    ik.laanMs = 60_000;
    await vent(1500);
    const r3 = await A.kald('computer_request_screen', { action: 'request', reason: 'third job', minutes: 1 });
    await A.kald('computer_request_screen', { action: 'release' });
    await vent(300);
    const r4 = await A.kald('computer_request_screen', { action: 'request', reason: 'fourth job', minutes: 1 });
    check('16f et laan agenten selv gav tilbage: IKKE et stop - det naeste gives uden spoergsmaal',
          !r3.fejl && !r4.fejl && /"granted":\s*true/.test(r4.tekst) && ik.spurgt.at(-1)?.ask === false, `${r4.tekst.slice(0, 120)} · ask=${ik.spurgt.at(-1)?.ask}`);
  } finally { A.srv.kill(); }
}

// 16e (panel R3, Astra): et skridt med `app`, der ventede, da mennesket tog skaermen OG gik ind i programmet - en ANDEN
//    kontrol afviser foerst («the window the person is working in»), men svaret skal stadig vaere stoppet, ikke «Call it again».
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-te-'));
  const ik = await lavIkon(st); ik.svar = 'staaende'; ik.laanMs = 60_000;
  const A = server(st, HJ, { CMCP_SCREEN_ASK: '0' });
  try {
    await A.klar();
    saet({ idle: { idle: 30 } });
    await A.kald('computer_request_screen', { action: 'request', reason: 'type a note', minutes: 3 });
    await vent(700);
    saet({ idle: { idle: 0.1 } });
    const skridt = A.kald('computer_type', { app: 'TextEdit', text: 'x' });
    await vent(400);
    HJ.saetSvar({ apps: { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', active: false }, { name: 'TextEdit', bundleId: 'com.apple.TextEdit', active: true }] }, at: AT, idle: { idle: 30 } });
    ik.slut('taken-back');
    const sv = await skridt;
    check('16e skridt med app: mennesket tog skaermen og gik ind i programmet - svaret er stoppet, ikke «Call it again»',
          sv.fejl && /do not request the screen again by yourself/.test(sv.tekst) && !/Call it again/.test(sv.tekst), sv.tekst.slice(0, 180));
  } finally { A.srv.kill(); saet({ idle: { idle: 30 } }); }
}

// 16 (panel R2, Astra): «tag tilbage» skal naa agenten som et STOP - et ventende skridt maa ikke svare «call it again»,
//    og en ny anmodning uden spoergsmaal afvises med «stop og sig det i chatten» i to minutter.
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-tb-'));
  const ik = await lavIkon(st); ik.svar = 'staaende'; ik.laanMs = 60_000;
  const A = server(st, HJ, { CMCP_SCREEN_ASK: '0' });
  try {
    await A.klar();
    saet({ idle: { idle: 30 } });
    const r = await A.kald('computer_request_screen', { action: 'request', reason: 'drag a file', minutes: 3 });
    check('16 forudsaetning: laanet givet', !r.fejl && /"granted":\s*true/.test(r.tekst), r.tekst.slice(0, 80));
    await vent(700);
    saet({ idle: { idle: 0.1 } });                                      // mennesket bruger musen: skridtet venter
    const skridt = A.kald('computer_move', { x: 9, y: 9 });
    await vent(400);
    ik.laan.destroy();                                                   // mennesket tager skaermen tilbage (ikonet lukker)
    const sv = await skridt;
    check('16 et skridt der ventede, da mennesket tog skaermen: «stop og sig det i chatten», ikke «call it again»',
          sv.fejl && /took the screen back/.test(sv.tekst) && /do not request the screen again by yourself/.test(sv.tekst) && !/Call it again/.test(sv.tekst), sv.tekst.slice(0, 200));
    saet({ idle: { idle: 30 } });
    const igen = await A.kald('computer_request_screen', { action: 'request', reason: 'drag a file again', minutes: 3 });
    check('16 en ny anmodning lige efter: afvist med stop-beskeden, ikonet ikke spurgt igen',
          igen.fejl && /took the screen back/.test(igen.tekst) && /do not request the screen again by yourself/.test(igen.tekst) && ik.spurgt.length === 1, `${igen.tekst.slice(0, 160)} · spurgt ${ik.spurgt.length}`);
  } finally { A.srv.kill(); saet({ idle: { idle: 30 } }); }
}

// 15 (panel R2, Astra): en server der faar SIGTERM midt i et skridt, stopper sine inputhjaelpere foer den gaar - ellers
//    kan den gamle hjaelper skrive videre, mens skaermen allerede er givet til den naeste agent.
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-exit-'));
  const X = server(st, HJ, {});
  try {
    await X.klar();
    saet({ idle: { idle: 30 }, type: { _vent: 8000, typed: 1 } });
    const kald = X.kald('computer_type', { app: 'TextEdit', text: 'x' }).catch(() => null);
    const lever = () => { try { return execFileSync('/usr/bin/pgrep', ['-f', `${dirname(HJ.sti)}/[^ ]+ type`]).toString().trim().split('\n').filter(Boolean).length; } catch { return 0; } };
    let foer = 0; for (let i = 0; i < 30 && !foer; i++) { await vent(100); foer = lever(); }
    X.srv.kill('SIGTERM');
    await vent(700);
    const efter = lever();
    check('15 forudsaetning: skridtet koerte (hjaelperen levede)', foer >= 1, `${foer}`);
    check('15 serveren faar SIGTERM midt i et skridt: dens hjaelper er stoppet foer den naeste kan begynde', foer >= 1 && efter === 0, `foer ${foer} · efter ${efter}`);
    void kald;
  } finally { try { X.srv.kill('SIGKILL'); } catch {} saet({ idle: { idle: 30 } }); }
}
// 15b (panel R3, Astra P1): den RIGTIGE hjaelper blokerer SIGTERM midt i et traek. Serveren skal saa draebe den (SIGKILL efter
//    2 s) og lade en ny hjaelper slippe knappen (release-mouse) - FOER den selv gaar. Attrappen her blokerer SIGTERM ligesom.
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-ex2-'));
  const ik = await lavIkon(st); ik.svar = 'staaende'; ik.laanMs = 60_000;
  const X = server(st, HJ, { CMCP_SCREEN_ASK: '0' });
  try {
    await X.klar();
    saet({ idle: { idle: 30 } });
    const l = await X.kald('computer_request_screen', { action: 'request', reason: 'drag a file', minutes: 3 });
    saet({ idle: { idle: 30 }, drag: { _vent: 9000, _ignorerTerm: true, dragged: true } });
    const klar0 = HJ.klar('drag'); const term0 = HJ.termModtaget('drag');
    const kald = X.kald('computer_drag', { fromX: 10, fromY: 10, toX: 50, toY: 50 }).catch(() => null);
    const lever = () => { try { return execFileSync('/usr/bin/pgrep', ['-f', `${dirname(HJ.sti)}/[^ ]+ drag`]).toString().trim().split('\n').filter(Boolean).length; } catch { return 0; } };
    // 6/11: vent til attrappen HAR sat sin SIGTERM-handler (klar), ikke blot til processen findes - ellers kapløb (15b/15c).
    let foer = 0; for (let i = 0; i < 50 && !(foer && HJ.klar('drag') >= klar0 + 1); i++) { await vent(100); foer = lever(); }
    const slip0 = HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'release-mouse').length;
    const t0 = Date.now();
    // R19 (Opus Q3): nulpunktet tages FOER signalet - saa taeller enhver skrivende hjaelper startet i ventevinduet som et brud.
    const type0 = HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'type').length;
    X.srv.kill('SIGTERM');
    // R18 (Opus, MAALT 8 af 30 roede under belastning): serveren kan laese de nye kald, FOER signalet er haandteret. Vent til et
    //    skrivende kald AFVISES med «shutting down» (flaget er sat) - kun mens serveren lever, og hoejst 500 ms pr. svar, saa en
    //    server der aldrig saetter flaget giver roedt, ikke et haeng. R19: nulpunktet er taget FOER signalet, saa ogsaa et skrivende
    //    kald, der naaede frem i ventevinduet, taeller som et brud (det dræber mutanten «flaget 300 ms for sent»).
    const serverLever = () => X.srv.exitCode === null && X.srv.signalCode === null;
    let flag = null;
    for (let i = 0; i < 8 && serverLever() && !/shutting down/.test(flag?.tekst || ''); i++) {
      flag = await Promise.race([X.kald('computer_type', { app: 'TextEdit', text: 'proeve' }).then(r => r, e => ({ fejl: true, tekst: String(e) })), vent(500).then(() => ({ tekst: 'intet svar inden 500 ms' }))]);
    }
    let nySvar = null; X.kald('computer_type', { app: 'TextEdit', text: 'ny skrivning under nedlukningen' }).then(r => { nySvar = r; }, e => { nySvar = { fejl: true, tekst: String(e) }; });   // R4 (Astra P1)
    let nyOptag = null; X.kald('computer_record', { action: 'start' }).then(r => { nyOptag = r; }, e => { nyOptag = { fejl: true, tekst: String(e) }; });   // R5 (Opus F1)
    // R6 (Opus M1/M4 overlevede): en NY laanebegaering afvises ogsaa - men et opslag svarer stadig.
    let nyLaan = null; X.kald('computer_request_screen', { action: 'request', reason: 'another loan', minutes: 1 }).then(r => { nyLaan = r; }, e => { nyLaan = { fejl: true, tekst: String(e) }; });
    let opslag = null; X.kald('computer_apps', {}).then(r => { opslag = r; }, e => { opslag = { fejl: true, tekst: String(e) }; });
    let serverVaek = false; for (let i = 0; i < 60 && !serverVaek; i++) { await vent(100); serverVaek = X.srv.exitCode !== null || X.srv.signalCode !== null; }
    const ms = Date.now() - t0;
    const slip = HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'release-mouse').length - slip0;
    check('15b forudsaetning: laanet givet, traekket koerte (attrappen naaede «klar»), og nedlukningsflaget blev sat', !l.fejl && foer >= 1 && HJ.klar('drag') >= klar0 + 1 && /shutting down/.test(flag?.tekst || ''),
          `${l.tekst.slice(0, 60)} · ${foer} · klar ${HJ.klar('drag') - klar0} · flag: ${JSON.stringify(flag).slice(0, 100)}`);
    check('15b ...og traekket fik SIGTERM FOER SIGKILL (R18, Opus M13)', HJ.termModtaget('drag') - term0 >= 1, `${HJ.termModtaget('drag') - term0} SIGTERM`);
    check('15b under nedlukningen starter ingen NY skrivende hjaelper - den afvises med «shutting down»', HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'type').length === type0 && /shutting down/.test(nySvar?.tekst || ''),
          `${HJ.handlingerNaaedeFrem().filter(k => k.argv[0] === 'type').length - type0} nye · svar: ${JSON.stringify(nySvar).slice(0, 160)}`);
    check('15b ...heller ingen NY optagelse - den afvises med «shutting down» (R5, Opus F1)', /shutting down/.test(nyOptag?.tekst || ''), JSON.stringify(nyOptag).slice(0, 160));
    check('15b ...heller ingen NY laanebegaering (R6, Opus M1)', /shutting down/.test(nyLaan?.tekst || ''), JSON.stringify(nyLaan).slice(0, 160));
    check('15b ...men et opslag svarer stadig under nedlukningen (R6, Opus M4)', opslag && !opslag.fejl, JSON.stringify(opslag).slice(0, 160));
    check('15b et traek der blokerer SIGTERM: draebt, og knappen sluppet, FOER serveren gik (ca. 2 s)',
          serverVaek && lever() === 0 && slip >= 1 && ms < 4000, `server vaek=${serverVaek} efter ${ms} ms · lever=${lever()} · release-mouse=${slip}`);
    void kald;
  } finally { try { X.srv.kill('SIGKILL'); } catch {} saet({ idle: { idle: 30 } }); }
}

// 14c (panel R1, Opus): uden spoergsmaal er en udloebet ventetid i koeen IKKE et menneskes nej - svaret maa ikke sige
//    «do not ask again», men «nobody said no - ask again». To servere med kontakten, falsk ikon i koe-tilstand.
{
  const st = mkdtempSync(join(tmpdir(), 'cmcp-laan-kv-'));
  const ik = await lavIkon(st); ik.svar = 'koe'; ik.laanMs = 60_000;
  const K1 = server(st, HJ, { CMCP_SCREEN_ASK: '0', CMCP_SCREEN_WAIT: '1' });
  const K2 = server(st, HJ, { CMCP_SCREEN_ASK: '0', CMCP_SCREEN_WAIT: '1' });
  try {
    await Promise.all([K1.klar(), K2.klar()]);
    const a = await K1.kald('computer_request_screen', { action: 'request', reason: 'first', minutes: 2 });
    const b = await K2.kald('computer_request_screen', { action: 'request', reason: 'second', minutes: 2 });
    check('14c foerste: laanet', /"granted":\s*true/.test(a.tekst), a.tekst.slice(0, 80));
    check('14c anden: ventetiden loeb ud i koeen - «ask again», ikke «do not ask again»',
          b.fejl && /Nobody said no - ask again/.test(b.tekst) && !/do not ask again/.test(b.tekst), b.tekst.slice(0, 160));
    const linje = laanLog(st).filter(x => x.decision === 'denied').at(-1);
    check('14c ...og loggen siger asked:false (ingen blev spurgt)', linje?.asked === false, JSON.stringify(linje || {}).slice(0, 160));
  } finally { K1.srv.kill(); K2.srv.kill(); }
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
