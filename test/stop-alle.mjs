// S2 (16/10, R38): «Stop all agents now» i ikonet stopper ALLE agenter - ogsaa skrivninger bagved uden
// skaermlaan og kald der venter. Ikonet skriver stopfilen; hver server ser den. Bevist gennem den rigtige
// server med falsk hjaelper (stopfilen skrives her som ikonet skriver den):
//   S1 et kald der venter paa en laas, naar ALDRIG hjaelperen efter et stop (kalibreret: uden stop gaar det igennem)
//   S1d et trin der allerede koerer i hjaelperen, stoppes undervejs
//   S2 efter stoppet afvises nye skrivende kald («Stopped»), mens laesning virker
//   S3 efter pausen (CMCP_STOP_SEK, 6 s her) kan agenten skrive igen
//   S4 ikonets menupunkt skriver netop den fil serveren laeser (kildekontrakt)
import './ryd-op.mjs';
import './egen-tilstand.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = ms => new Promise(r => setTimeout(r, ms));
const APPS = { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true }, { name: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, active: false }] };

async function server(stopSek = '6') {
  const STATE = mkdtempSync(join(tmpdir(), 'cmcp-stop-'));
  const hj = lavFalskHjaelper('cmcp-stop');
  hj.saetSvar({ apps: APPS, key: { ok: true, key: 'cmd+b', took_screen: false } });
  const env = { ...process.env, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti, CMCP_STATE_DIR: STATE, CMCP_STATUS_IKON: '0',
                CMCP_STOP_SEK: stopSek, CMCP_WAIT_SEK: '1', CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-stop-sp').sti };
  delete env.CMCP_BACKGROUND;
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const svar = new Map(); let n = 10;
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id != null) svar.set(m.id, m); } catch {} } });
  const send = (o) => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'stop', version: '1' } } });
  for (let i = 0; i < 100 && !svar.has(1); i++) await vent(100);
  send({ method: 'notifications/initialized' });
  const kald = async (name, args) => { const id = ++n; send({ id, method: 'tools/call', params: { name, arguments: args } }); for (let i = 0; i < 200 && !svar.has(id); i++) await vent(100); const m = svar.get(id); return { tekst: (m?.result?.content || []).map(c => c.text || '').join('\n'), fejl: !!m?.result?.isError }; };
  const startKald = (name, args) => { const id = ++n; send({ id, method: 'tools/call', params: { name, arguments: args } }); return async () => { for (let i = 0; i < 200 && !svar.has(id); i++) await vent(100); const m = svar.get(id); return { tekst: (m?.result?.content || []).map(c => c.text || '').join('\n'), fejl: !!m?.result?.isError }; }; };
  const stopTid = { ts: 0 };
  const stop = () => { stopTid.ts = Date.now(); writeFileSync(join(STATE, 'stop.json'), JSON.stringify({ ts: stopTid.ts, source: 'stop-all' }) + '\n'); };
  return { srv, STATE, hj, kald, startKald, stop, stopTid };
}
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
    taster(m.s.hj) === 0 && /^Stopped: the person pressed Stop all agents now[\s\S]*Ask them in the chat/.test(m.r.tekst), `taster=${taster(m.s.hj)} · ${m.r.tekst.slice(0, 100)}`);
  let logStop = 0; try { logStop = readFileSync(join(m.s.STATE, 'audit.jsonl'), 'utf8').split('\n').filter(l => /"tool":"stop-all"/.test(l)).length; } catch {}
  check('S1c stoppet staar i loggen (mennesket kan se at det skete)', logStop === 1, `stop-all-linjer=${logStop}`);

  // S2: nye skrivende kald afvises; laesning virker
  const ny = await m.s.kald('computer_key', { app: 'Notes', combo: 'cmd+i' });
  const laes = await m.s.kald('computer_apps', {});
  check('S2 efter stoppet afvises nye skrivende kald («Stopped»), og intet naar hjaelperen', ny.fejl && /^Stopped: the person pressed «Stop all agents now»/.test(ny.tekst) && taster(m.s.hj) === 0, ny.tekst.slice(0, 100));
  check('S2b ...mens laesning stadig virker', !laes.fejl && /Notes/.test(laes.tekst), laes.tekst.slice(0, 60));

  // S3: efter pausen (6 s her) kan agenten skrive igen
  check('S2c kontrol: S2 maaltes inden pausen udloeb', Date.now() - m.s.stopTid.ts < 6000, `${Date.now() - m.s.stopTid.ts} ms`);
  await vent(Math.max(0, m.s.stopTid.ts + 6300 - Date.now()));
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
  await vent(1500);                                   // hjaelperen «skriver» nu
  if (medStop) s.stop();
  const r = await svar();
  const faerdig = s.hj.kald().filter(k => k.argv[0] === 'type').length;
  if (!medStop) check('S1d-kalibrering: uden stop skriver hjaelperen faerdig', !r.fejl && faerdig === 1, `${faerdig} · ${r.tekst.slice(0, 60)}`);
  else check('S1d et trin der koerer, stoppes undervejs, og svaret siger «Stopped» - ikke at et laan sluttede',
    r.fejl && faerdig === 0 && /^Stopped: the person pressed «Stop all agents now» while this ran/.test(r.tekst), `${faerdig} · ${r.tekst.slice(0, 100)}`);
  s.srv.kill();
}

// S4: ikonets menupunkt skriver den fil, serveren laeser (kildekontrakt)
{
  const sw = readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-status', 'main.swift'), 'utf8');
  const tk = readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-status', 'Tekst.swift'), 'utf8');
  const ix = readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
  check('S4 menupunktet «Stop all agents now» skriver stop.json og giver et laan tilbage; serveren laeser stop.json',
    /let STOP_FIL = "stop\.json"/.test(tk) && /appendingPathComponent\(STOP_FIL\)/.test(sw) && /stopAlleNu\(kilde: String\) \{[\s\S]{0,400}aktivtLaan\?\.afslutLaan\(\)/.test(sw)
    && /#selector\(stopAlle\)/.test(sw) && /const STOP_STI = join\(dirname\(AUDIT_PATH\), 'stop\.json'\)/.test(ix));
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
