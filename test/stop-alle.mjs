// S2 (16/10, R38): «Stop all agents now» i ikonet stopper ALLE agenter - ogsaa skrivninger bagved uden
// skaermlaan og kald der venter. Ikonet skriver stopfilen; hver server ser den. Bevist gennem den rigtige
// server med falsk hjaelper (stopfilen skrives her som ikonet skriver den):
//   S1 et kald der venter paa en laas, naar ALDRIG hjaelperen efter et stop (kalibreret: uden stop gaar det igennem)
//   S1d et trin der allerede koerer i hjaelperen, stoppes undervejs
//   S2 efter stoppet afvises nye skrivende kald («Stopped»), mens laesning virker
//   S3 efter pausen (CMCP_STOP_SEK, PAUSE her) kan agenten skrive igen
//   S4 ikonets menupunkt skriver netop den fil serveren laeser (kildekontrakt)
import './ryd-op.mjs';
import './egen-tilstand.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = ms => new Promise(r => setTimeout(r, ms));
const APPS = { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true }, { name: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, active: false }] };

// R45: `optag` = hjaelperen kan optage (lever til SIGINT); `spoerger` + `dialogMs` = dialog-attrappens svar og
// ventetid; `ur` = serverens Date.now kan forskydes udefra (ur.txt i tilstandsmappen) - systemuret roeres ikke.
const PAUSE = 10;   // s - under last tog S1-fasen 8,8 s (16/10), saa 6 s var for stramt
async function server(stopSek = String(PAUSE), { env: ekstra = {}, optag = false, optagStartMs = 0, billede = false, ikon = null, spoerger = 'udloeb', dialogMs = 0, ur = false, foerStart = null } = {}) {
  const STATE = mkdtempSync(join(tmpdir(), 'cmcp-stop-'));
  const hj = lavFalskHjaelper('cmcp-stop');
  hj.saetSvar({ apps: APPS, key: { ok: true, key: 'cmd+b', took_screen: false } });
  // Hjaelperen noterer hvert trin naar det STARTER (kald() ser kun dem der blev faerdige) - saa en proeve kan
  // trykke Stop netop mens et trin koerer, ogsaa under last (16/10: ellers ramte stoppet en ventefase foer trinnet).
  { const h = join(dirname(hj.sti), 'h.mjs');
    writeFileSync(h, readFileSync(h, 'utf8').replace("const kommando = argv[0] || '';", `const kommando = argv[0] || '';\nappendFileSync(${JSON.stringify(join(STATE, 'startet.txt'))}, kommando + '\\n');`)); }
  if (optag) {
    const h = join(dirname(hj.sti), 'h.mjs');
    writeFileSync(h, readFileSync(h, 'utf8').replace('// Scriptede svar', `if (kommando === 'record') {
  process.on('SIGINT', () => { writeSync(1, JSON.stringify({ ok: true, stopped_by: 'signal', bytes: 0, seconds: 1 }) + '\\n'); process.exit(0); });
  await new Promise(r => setTimeout(r, ${optagStartMs}));   // R46: opstarten kan tage tid
  writeSync(1, JSON.stringify({ recording: true }) + '\\n');
  setInterval(() => appendFileSync(${JSON.stringify(join(STATE, 'optag-tik.jsonl'))}, Date.now() + '\\n'), 100);
  await new Promise(() => {});
}
// Scriptede svar`));
  }
  if (billede) {   // R46: skaermbilledet skriver en fast proevefil (aldrig et rigtigt billede)
    const h = join(dirname(hj.sti), 'h.mjs');
    writeFileSync(h, readFileSync(h, 'utf8').replace('// Scriptede svar', `if (kommando === 'screenshot') { (await import('node:fs')).writeFileSync(argv[argv.indexOf('--out') + 1], 'proevebytes'); }
// Scriptede svar`));
  }
  // R46: et falsk ikon paa en rigtig socket i proevens egen tilstandsmappe - `ikon(q, svar)` bestemmer svaret.
  const ikonSrv = ikon ? createServer(sock => { let b = ''; sock.on('data', d => { b += d; const i = b.indexOf('\n'); if (i < 0) return; const q = JSON.parse(b.slice(0, i)); b = b.slice(i + 1); ikonSpurgt.push(q); ikon(q, (m) => { try { sock.write(JSON.stringify({ nonce: q.nonce, ...m }) + '\n'); } catch {} }); }); sock.on('error', () => {}); }) : null;
  const ikonSpurgt = [];
  if (ikonSrv) await new Promise(r => ikonSrv.listen(join(STATE, 'ikon.sock'), r));
  const sp = lavFalskSpoerger(spoerger, 'cmcp-stop-sp');
  if (dialogMs) {
    const js = readFileSync(sp.sti, 'utf8').match(/"([^"\n]+\.mjs)"/)[1];
    writeFileSync(js, readFileSync(js, 'utf8').replace('process.stdout.write', `await new Promise(r => setTimeout(r, ${dialogMs}));\nprocess.stdout.write`));
  }
  if (foerStart) foerStart(STATE);   // R46: fx en stopfil der laa der, foer serveren startede
  const pre = [];
  if (ur) {
    writeFileSync(join(STATE, 'ur.mjs'), `import { readFileSync } from 'node:fs'; const r = Date.now; Date.now = () => { let o = 0; try { o = Number(readFileSync(${JSON.stringify(join(STATE, 'ur.txt'))}, 'utf8')) || 0; } catch {} return r() + o; };`);
    pre.push('--import', join(STATE, 'ur.mjs'));
  }
  const env = { ...process.env, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti, CMCP_STATE_DIR: STATE, CMCP_STATUS_IKON: '0',
                CMCP_STOP_SEK: stopSek, CMCP_WAIT_SEK: '1', CMCP_OSASCRIPT: sp.sti, CMCP_RECORD_DIR: join(STATE, 'optagelser'), ...ekstra };
  if (!('CMCP_BACKGROUND' in ekstra)) delete env.CMCP_BACKGROUND;
  const srv = spawn('node', [...pre, join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const svar = new Map(); let n = 10;
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id != null) svar.set(m.id, m); } catch {} } });
  const send = (o) => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'stop', version: '1' } } });
  for (let i = 0; i < 100 && !svar.has(1); i++) await vent(100);
  send({ method: 'notifications/initialized' });
  const kald = async (name, args) => { const id = ++n; send({ id, method: 'tools/call', params: { name, arguments: args } }); for (let i = 0; i < 600 && !svar.has(id); i++) await vent(100); const m = svar.get(id); return { tekst: (m?.result?.content || []).map(c => c.text || '').join('\n'), fejl: !!m?.result?.isError, billeder: (m?.result?.content || []).filter(c => c.type === 'image').length }; };
  const startKald = (name, args) => { const id = ++n; send({ id, method: 'tools/call', params: { name, arguments: args } }); return async () => { for (let i = 0; i < 600 && !svar.has(id); i++) await vent(100); const m = svar.get(id); return { tekst: (m?.result?.content || []).map(c => c.text || '').join('\n'), fejl: !!m?.result?.isError, billeder: (m?.result?.content || []).filter(c => c.type === 'image').length }; }; };
  const stopTid = { ts: 0 };
  const stop = () => { stopTid.ts = Date.now(); writeFileSync(join(STATE, 'stop.json'), JSON.stringify({ ts: stopTid.ts, source: 'stop-all' }) + '\n'); };
  const luk = () => { srv.kill(); ikonSrv?.close(); };
  return { srv, STATE, hj, sp, kald, startKald, stop, stopTid, ikonSpurgt, luk };
}
const startet = (s, k) => { try { return readFileSync(join(s.STATE, 'startet.txt'), 'utf8').split('\n').filter(x => x === k).length; } catch { return 0; } };
const ventPaaStart = async (s, k) => { for (let i = 0; i < 300 && startet(s, k) === 0; i++) await vent(50); };
const taster = (hj) => hj.kald().filter(k => k.argv[0] === 'key').length;

async function venterPaaLaas(medStop) {
  const s = await server();
  const sover = spawn('sleep', ['60']);
  mkdirSync(join(s.STATE, 'laase'), { recursive: true });
  writeFileSync(join(s.STATE, 'laase', 'com.apple.Notes.lock'), String(sover.pid));
  const svar = s.startKald('computer_key', { app: 'Notes', combo: 'cmd+b' });
  await vent(1500);                                   // kaldet venter paa laasen
  if (medStop) s.stop();
  await vent(1200);                                   // vagten ser filen (hvert 0,5 s)
  sover.kill();
  const r = await svar();
  await vent(500); await s.hj.roligt?.();
  return { s, r };
}

// S1
{
  const k = await venterPaaLaas(false);
  check('S1a kalibrering: UDEN stop naar tasten hjaelperen, naar laasen frigives', taster(k.s.hj) === 1, `taster=${taster(k.s.hj)}`);
  k.s.srv.kill();
  const m = await venterPaaLaas(true);
  check('S1b et kald der venter paa en laas, naar ALDRIG hjaelperen efter «Stop all agents now» - og svaret siger at mennesket stoppede det',
    taster(m.s.hj) === 0 && /^Stopped: the person pressed «?Stop all agents now»?[\s\S]*Ask them in the chat/.test(m.r.tekst), `taster=${taster(m.s.hj)} · ${m.r.tekst.slice(0, 100)}`);
  let logStop = 0; try { logStop = readFileSync(join(m.s.STATE, 'audit.jsonl'), 'utf8').split('\n').filter(l => /"tool":"stop-all"/.test(l)).length; } catch {}
  check('S1c stoppet staar i loggen (mennesket kan se at det skete)', logStop === 1, `stop-all-linjer=${logStop}`);

  // S2: nye skrivende kald afvises; laesning virker
  const ny = await m.s.kald('computer_key', { app: 'Notes', combo: 'cmd+i' });
  const laes = await m.s.kald('computer_apps', {});
  check('S2 efter stoppet afvises nye skrivende kald («Stopped»), og intet naar hjaelperen', ny.fejl && /^Stopped: the person pressed «Stop all agents now»[\s\S]*do not carry on by yourself when the pause ends/.test(ny.tekst) && taster(m.s.hj) === 0, ny.tekst.slice(0, 100));
  check('S2b ...mens laesning stadig virker', !laes.fejl && /Notes/.test(laes.tekst), laes.tekst.slice(0, 60));

  // S3: efter pausen (PAUSE her) kan agenten skrive igen
  check('S2c kontrol: S2 maaltes inden pausen udloeb', Date.now() - m.s.stopTid.ts < PAUSE * 1000, `${Date.now() - m.s.stopTid.ts} ms`);
  await vent(Math.max(0, m.s.stopTid.ts + PAUSE * 1000 + 300 - Date.now()));
  const igen = await m.s.kald('computer_key', { app: 'Notes', combo: 'cmd+u' });
  await m.s.hj.roligt?.();
  check('S3 efter pausen kan agenten skrive igen', !igen.fejl && taster(m.s.hj) === 1, `taster=${taster(m.s.hj)} · ${igen.tekst.slice(0, 80)}`);
  m.s.srv.kill();
}

// S1d: et trin der allerede koerer i hjaelperen, stoppes undervejs (samme vej som naar skaermen tages tilbage) -
//      kalibreret: uden stop koerer det faerdigt.
for (const medStop of [false, true]) {
  const s = await server();
  s.hj.saetSvar({ apps: APPS, type: { _vent: 3000, ok: true, typed: 3, took_screen: false } });
  const svar = s.startKald('computer_type', { app: 'Notes', text: 'hej' });
  await ventPaaStart(s, 'type'); await vent(300);     // hjaelperen «skriver» nu
  if (medStop) s.stop();
  const r = await svar();
  const faerdig = s.hj.kald().filter(k => k.argv[0] === 'type').length;
  if (!medStop) check('S1d-kalibrering: uden stop skriver hjaelperen faerdig', !r.fejl && faerdig === 1, `${faerdig} · ${r.tekst.slice(0, 60)}`);
  else check('S1d et trin der koerer, stoppes undervejs, og svaret siger «Stopped» - ikke at et laan sluttede',
    r.fejl && faerdig === 0 && /^Stopped: the person pressed «Stop all agents now» while this ran/.test(r.tekst), `${faerdig} · ${r.tekst.slice(0, 100)}`);
  s.srv.kill();
}

const stopLinjer = (s) => { try { return readFileSync(join(s.STATE, 'audit.jsonl'), 'utf8').split('\n').filter(l => /"tool":"stop-all"/.test(l)).length; } catch { return 0; } };
const hjKald = (s, k) => s.hj.kald().filter(x => x.argv[0] === k).length;

// S5 (R45, Opus B + Astra, MAALT): en optagestart og et usloeret skaermbillede er skrivende - ogsaa for stoppet.
//     Kalibrering: uden stop er svaret ikke «Stopped» (porten spoerger/afviser som altid).
for (const medStop of [false, true]) {
  const s = await server();
  if (medStop) { s.stop(); await vent(1200); }
  const r1 = await s.kald('computer_record', { action: 'start', maxSeconds: 5 });
  const r2 = await s.kald('computer_screenshot', { app: 'Notes', redact: false });
  if (!medStop) check('S5-kalibrering: uden stop er optagestart og usloeret billede ikke «Stopped»', !/^Stopped/.test(r1.tekst) && !/^Stopped/.test(r2.tekst), `${r1.tekst.slice(0, 50)} · ${r2.tekst.slice(0, 50)}`);
  else check('S5 under pausen afvises optagestart og usloeret skaermbillede med «Stopped», og hjaelperen kaldes ikke',
    /^Stopped/.test(r1.tekst) && /^Stopped/.test(r2.tekst) && hjKald(s, 'record') === 0 && hjKald(s, 'screenshot') === 0, `${r1.tekst.slice(0, 50)} · ${r2.tekst.slice(0, 50)}`);
  s.srv.kill();
}

// S6 (R45, Opus C + Astra, MAALT): en optagelse der koerer, stoppes af «Stop all agents now». Kalibrering: uden stop koerer den videre.
for (const medStop of [false, true]) {
  const s = await server(String(PAUSE), { optag: true, spoerger: 'ja', env: { CMCP_BACKGROUND: '0' } });
  const start = await s.kald('computer_record', { action: 'start', maxSeconds: 30 });
  await vent(600);
  if (medStop) s.stop();
  await vent(1800);
  const st = await s.kald('computer_record', { action: 'status' });
  const korer = /"recording": ?true/.test(st.tekst);
  if (!medStop) check('S6-kalibrering: uden stop optager den stadig', !start.fejl && korer, `${start.tekst.slice(0, 60)} · ${st.tekst.slice(0, 60)}`);
  else check('S6 en optagelse der koerer, stoppes af stoppet', !start.fejl && !korer, `${start.tekst.slice(0, 60)} · ${st.tekst.slice(0, 60)}`);
  if (korer) await s.kald('computer_record', { action: 'stop' });
  s.srv.kill();
}

// S7 (R45, Astra MAALT 2,5 s): et svar fra en ask_user-dialog efter et stop taeller ikke som «done». Kalibrering: uden stop er det done.
for (const medStop of [false, true]) {
  const s = await server(String(PAUSE), { spoerger: 'faerdig', dialogMs: 2000, env: { CMCP_BACKGROUND: '0' } });
  const svar = s.startKald('computer_ask_user', { app: 'Notes', message: 'Type the code in Notes' });
  for (let i = 0; i < 100 && s.sp.gangeSpurgt() === 0; i++) await vent(100);
  if (medStop) s.stop();
  const r = await svar();
  if (!medStop) check('S7-kalibrering: uden stop er dialogens svar «done»', !r.fejl && /"done": ?true/.test(r.tekst), r.tekst.slice(0, 80));
  else check('S7 en dialog der svarer efter stoppet, taeller ikke - svaret er «Stopped»', r.fejl && /^Stopped: .*dialog was open/.test(r.tekst) && !/"done": ?true/.test(r.tekst), r.tekst.slice(0, 120));
  s.srv.kill();
}

// S8 (R45, Opus D + Astra, MAALT): et tidsstempel i fremtiden giver hoejst pausen fra nu - og et senere stop ses stadig.
//     De to maales hver for sig (16/10: et senere stop nulstiller pausen og skjulte om fremtids-stemplet var begraenset).
{
  const s = await server();
  const t0 = Date.now();
  writeFileSync(join(s.STATE, 'stop.json'), JSON.stringify({ ts: t0 + 86_400_000, source: 'other' }) + '\n');
  await vent(1200);
  const foer = await s.kald('computer_key', { app: 'Notes', combo: 'cmd+b' });
  await vent(Math.max(0, t0 + PAUSE * 1000 + 1500 - Date.now()));
  const efter = await s.kald('computer_key', { app: 'Notes', combo: 'cmd+b' });
  check('S8a et stop med tidsstempel et doegn ude i fremtiden stopper - men hoejst pausen fra nu',
    /^Stopped/.test(foer.tekst) && !efter.fejl && hjKald(s, 'key') === 1, `foer: ${foer.tekst.slice(0, 40)} · efter: ${efter.tekst.slice(0, 40)}`);
  s.stop(); await vent(1200);
  const igen = await s.kald('computer_key', { app: 'Notes', combo: 'cmd+i' });
  check('S8b ...og et senere stop ses stadig (2 stop i loggen, skrivning afvist igen)', stopLinjer(s) === 2 && /^Stopped/.test(igen.tekst) && hjKald(s, 'key') === 1, `stop-linjer=${stopLinjer(s)} · ${igen.tekst.slice(0, 40)}`);
  s.srv.kill();
}

// S9 (R45, Opus E, MAALT P7): CMCP_STOP_SEK=0 slaar ikke stoppet fra - et koerende trin stoppes stadig.
{
  const s = await server('0');
  s.hj.saetSvar({ apps: APPS, type: { _vent: 3000, ok: true, typed: 3, took_screen: false } });
  const svar = s.startKald('computer_type', { app: 'Notes', text: 'hej' });
  await ventPaaStart(s, 'type'); await vent(300); s.stop();
  const r = await svar();
  check('S9 med CMCP_STOP_SEK=0 stopper «Stop all agents now» stadig et koerende trin (pausen har et gulv)', r.fejl && /^Stopped/.test(r.tekst) && hjKald(s, 'type') === 0, r.tekst.slice(0, 80));
  s.srv.kill();
}

// S10 (R45, Astra MAALT: +121 s paa uret ophaevede pausen efter 0,9 s): pausen maales paa et monotont ur.
{
  const s = await server('120', { ur: true });
  s.stop(); await vent(1200);
  writeFileSync(join(s.STATE, 'ur.txt'), '121000');
  const r = await s.kald('computer_key', { app: 'Notes', combo: 'cmd+b' });
  check('S10 et ur der springer 121 s frem, ophaever ikke pausen', r.fejl && /^Stopped/.test(r.tekst) && hjKald(s, 'key') === 0, r.tekst.slice(0, 80));
  s.srv.kill();
}

const TERM_APPS = { apps: [...APPS.apps, { name: 'Terminal', bundleId: 'com.apple.Terminal', pid: 3305, active: false }] };
const BILLEDE = { _vent: 2500, ok: true, width: 1, height: 1, screenWidthPoints: 1, screenHeightPoints: 1, pixelsPerPoint: 1, scope: 'proeve', redacted: false };

// S11 (R46 Astra A, MAALT 2,1 s): et usloeret skaermbillede der er i gang, udleveres ikke efter stoppet. Kalibrering: uden stop udleveres det.
for (const medStop of [false, true]) {
  const s = await server(String(PAUSE), { billede: true, spoerger: 'ja', env: { CMCP_BACKGROUND: '0' } });
  s.hj.saetSvar({ apps: APPS, screenshot: BILLEDE });
  const svar = s.startKald('computer_screenshot', { app: 'Notes', redact: false });
  await ventPaaStart(s, 'screenshot'); await vent(300);
  if (medStop) s.stop();
  const r = await svar();
  if (!medStop) check('S11-kalibrering: uden stop udleveres det usloerede billede', !r.fejl && r.billeder === 1, `billeder=${r.billeder} · ${r.tekst.slice(0, 60)}`);
  else check('S11 et usloeret skaermbillede der var i gang, udleveres ikke efter stoppet', r.fejl && r.billeder === 0 && /^Stopped/.test(r.tekst), `billeder=${r.billeder} · ${r.tekst.slice(0, 80)}`);
  s.luk();
}

// S12 (R46 Astra B, MAALT): et ja i samtykke-dialogen EFTER stoppet giver ikke sessionssamtykke - naeste skridt spoerger igen.
//      Kalibrering: uden stop spoerges der én gang for hele sessionen.
for (const medStop of [false, true]) {
  const s = await server('5', { spoerger: 'ja', dialogMs: 2200, env: { CMCP_BACKGROUND: '0' } });
  s.hj.saetSvar({ apps: TERM_APPS, key: { ok: true, took_screen: false } });
  const svar = s.startKald('computer_key', { app: 'Terminal', combo: 'cmd+b' });
  for (let i = 0; i < 200 && s.sp.gangeSpurgt() === 0; i++) await vent(50);
  if (medStop) s.stop();
  const r1 = await svar();
  if (medStop) await vent(Math.max(0, s.stopTid.ts + 5800 - Date.now()));
  const r2 = await s.kald('computer_key', { app: 'Terminal', combo: 'cmd+i' });
  const spurgt = s.sp.gangeSpurgt();
  if (!medStop) check('S12-kalibrering: uden stop spoerges der én gang, og begge taster leveres', !r1.fejl && !r2.fejl && spurgt === 1 && hjKald(s, 'key') === 2, `spurgt=${spurgt} taster=${hjKald(s, 'key')}`);
  else check('S12 et ja efter stoppet giver ikke sessionssamtykke: foerste stoppes, naeste spoerger igen', /^Stopped/.test(r1.tekst) && spurgt === 2 && hjKald(s, 'key') === 1, `spurgt=${spurgt} taster=${hjKald(s, 'key')} · ${r1.tekst.slice(0, 50)}`);
  s.luk();
}
// S12b (R46 Astra B): et «ja for sessionen» givet FOER stoppet tages ogsaa tilbage - efter pausen spoerges der igen.
{
  const s = await server('5', { spoerger: 'ja', env: { CMCP_BACKGROUND: '0' } });
  s.hj.saetSvar({ apps: TERM_APPS, key: { ok: true, took_screen: false } });
  const r1 = await s.kald('computer_key', { app: 'Terminal', combo: 'cmd+b' });   // ja -> sessionssamtykke
  s.stop(); await vent(5800);
  const r2 = await s.kald('computer_key', { app: 'Terminal', combo: 'cmd+i' });
  check('S12b et sessions-ja givet foer stoppet tages tilbage: efter pausen spoerges der igen', !r1.fejl && !r2.fejl && s.sp.gangeSpurgt() === 2, `spurgt=${s.sp.gangeSpurgt()} · ${r2.tekst.slice(0, 50)}`);
  s.luk();
}

// S13 (R46 Astra C, MAALT): stoppet mens optagelsen starter - svaret siger ikke «Recording».
{
  const s = await server(String(PAUSE), { optag: true, optagStartMs: 2000, spoerger: 'ja', env: { CMCP_BACKGROUND: '0' } });
  const svar = s.startKald('computer_record', { action: 'start', maxSeconds: 30 });
  await ventPaaStart(s, 'record'); await vent(300);
  s.stop();
  const r = await svar();
  const st = await s.kald('computer_record', { action: 'status' });
  check('S13 stoppet under optagelsens opstart: svaret er «Stopped», og der optages ikke', r.fejl && /^Stopped/.test(r.tekst) && !/"recording": ?true/.test(st.tekst), `${r.tekst.slice(0, 60)} · ${st.tekst.slice(0, 40)}`);
  s.luk();
}

// S14 (R46 Astra C, MAALT): ask_user i baggrunden - stoppet gaar forud for et «Done» der kom lige foer, og for
//      et spoergsmaal der aldrig blev stillet. Kalibrering: uden stop er svaret done:true.
for (const tilfaelde of ['kalibrering', 'done-foer-stop', 'stop-foer-spoergsmaal']) {
  const s = await server(String(PAUSE), { ikon: (q, svar) => { if (tilfaelde !== 'stop-foer-spoergsmaal') setTimeout(() => svar({ ok: true, verified: 'done' }), 100); } });
  s.hj.saetSvar({ apps: APPS, idle: { _vent: 1400, idle: 600 }, windows: { _vent: tilfaelde === 'stop-foer-spoergsmaal' ? 2000 : 0, ok: true, windows: [{ title: 'Note' }] } });
  const svar = s.startKald('computer_ask_user', { app: 'Notes', message: 'Type the code in Notes' });
  if (tilfaelde === 'stop-foer-spoergsmaal') { await ventPaaStart(s, 'windows'); await vent(300); s.stop(); }
  if (tilfaelde === 'done-foer-stop') { for (let i = 0; i < 200 && s.ikonSpurgt.length === 0; i++) await vent(50); await vent(400); s.stop(); }
  const r = await svar();
  if (tilfaelde === 'kalibrering') check('S14-kalibrering: uden stop svarer ask_user done:true', !r.fejl && /"done": ?true/.test(r.tekst), r.tekst.slice(0, 80));
  else if (tilfaelde === 'done-foer-stop') check('S14a et «Done» der kom lige foer stoppet, svares «Stopped» - ikke done:true', r.fejl && /^Stopped/.test(r.tekst), r.tekst.slice(0, 80));
  else check('S14b stoppet foer spoergsmaalet: intet spoergsmaal, og svaret er «Stopped» - ikke «Refused»', r.fejl && /^Stopped/.test(r.tekst) && s.ikonSpurgt.length === 0, `spurgt=${s.ikonSpurgt.length} · ${r.tekst.slice(0, 60)}`);
  s.luk();
}

// S15 (R46 Astra D, MAALT 2,7 s): en ny stopfil med gammelt tidsstempel kan ikke forkorte en igangvaerende pause.
{
  const s = await server();
  s.stop(); await vent(1200);
  writeFileSync(join(s.STATE, 'stop.json'), JSON.stringify({ ts: Date.now() - (PAUSE - 1) * 1000, source: 'other' }) + '\n');
  await vent(2500);
  const r = await s.kald('computer_key', { app: 'Notes', combo: 'cmd+b' });
  check('S15 en stopfil med gammelt tidsstempel forkorter ikke pausen', /^Stopped/.test(r.tekst) && hjKald(s, 'key') === 0, r.tekst.slice(0, 60));
  s.luk();
}

// S16 (R46 Opus N3, MAALT): et falsk fremtidigt stempel i en GAMMEL stopfil giver ikke en ny server en pause -
//      stemplet kan ikke ligge efter filens skrivetid. Kalibrering: samme fil skrevet NU stopper den nye server.
for (const gammel of [false, true]) {
  const s = await server(String(PAUSE), { foerStart: (STATE) => {
    const f = join(STATE, 'stop.json');
    writeFileSync(f, JSON.stringify({ ts: Date.now() + 86_400_000, source: 'other' }) + '\n');
    if (gammel) { const t = (Date.now() - (PAUSE + 30) * 1000) / 1000; utimesSync(f, t, t); }
  } });
  const r = await s.kald('computer_key', { app: 'Notes', combo: 'cmd+b' });
  if (!gammel) check('S16-kalibrering: en stopfil skrevet lige foer starten stopper en ny server', /^Stopped/.test(r.tekst) && hjKald(s, 'key') === 0, r.tekst.slice(0, 60));
  else check('S16 en gammel stopfil med falsk fremtidigt stempel giver ikke en ny server en pause', !r.fejl && hjKald(s, 'key') === 1, r.tekst.slice(0, 60));
  s.luk();
}

// S4: ikonets menupunkt skriver den fil, serveren laeser (kildekontrakt)
{
  const sw = readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-status', 'main.swift'), 'utf8');
  const tk = readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-status', 'Tekst.swift'), 'utf8');
  const ix = readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
  check('S4 menupunktet «Stop all agents now» staar der mens en agent er tilsluttet (eller har skaermen), skriver stop.json og giver et laan tilbage; serveren laeser stop.json',
    /let STOP_FIL = "stop\.json"/.test(tk) && /appendingPathComponent\(STOP_FIL\)/.test(sw) && /noterKilde\("stop-all-write-failed"\) \}\n\s+aktivtLaan\?\.afslutLaan\(\)\n\s+tik\(\)/.test(sw)
    && /if !s\.isEmpty \|\| aktivtLaan != nil \{\n\s+let stop = NSMenuItem\(title: STOP_ALLE_TITEL, action: #selector\(stopAlle\)/.test(sw)
    && /#selector\(stopAlle\)/.test(sw) && /const STOP_STI = join\(dirname\(AUDIT_PATH\), 'stop\.json'\)/.test(ix));
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
