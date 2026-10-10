// MENU-VAGT: et tryk eller en tast i et program BAGVED maa aldrig aabne en menu over
// menneskets arbejde.
//
// ⛔ HVORFOR DEN FINDES (10/10-2026, R28)
//    Maalt: `computer_press` paa en rullemenu i et program bagved aabnede menuen paa
//    menneskets skaerm (menulaget 101). Den blev staaende, til mennesket selv klikkede
//    vaek eller trykkede Escape, og imens gik deres tastetryk til menuen - et Return
//    vaelger et punkt i programmet bagved. Det har vaeret saadan, siden tryk kom ind.
//    README lover, at rullemenuer er uden for raekkevidde i baggrunden. Begge
//    konsulenter (R28): ret det i 0.2.2, foer udgivelse.
//
//    Proeven bruger sit eget usynlige proevemaal (uden for skaermen, gennemsigtigt).
//    Ingen menu aabnes: vagten afviser, foer noget sendes.
import './ryd-op.mjs';
import './egen-tilstand.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HJAELPER = [process.env.CMCP_HELPER, join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper')].find(p => p && existsSync(p));
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = (ms) => new Promise(r => setTimeout(r, ms));

// 1 · Serveren (falsk hjaelper): porten og flaget.
function klient(svar, ekstraEnv = {}) {
  const hj = lavFalskHjaelper('cmcp-menuvagt');
  hj.saetSvar(svar);
  const env = { ...process.env, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti,
                CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-menuvagt-sp').sti,
                CMCP_STATE_DIR: mkdtempSync(join(tmpdir(), 'cmcp-mv-')) };
  delete env.CMCP_BACKGROUND;
  Object.assign(env, ekstraEnv);
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const venter = new Map(); let n = 0;
  srv.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!l.trim()) continue;
      try { const m = JSON.parse(l); venter.get(m.id)?.(m); venter.delete(m.id); } catch { /* videre */ }
    }
  });
  const rpc = (method, params) => new Promise((res, rej) => {
    const id = ++n; venter.set(id, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => rej(new Error('timeout ' + method)), 20000);
  });
  const kald = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args });
    return { tekst: (r.result?.content || []).map(c => c.text || '').join('\n'), fejl: !!r.result?.isError };
  };
  return { srv, rpc, kald, hj };
}
const APPS = { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true },
                      { name: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, active: false }] };
{
  const { srv, rpc, kald, hj } = klient({ apps: APPS,
    'press --dry': { would_press: { name: 'Sortér', role: 'AXPopUpButton' } },
    key: { ok: true, key: 'space', took_screen: false }, type: { ok: true, typed: 1, took_screen: false } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'menuvagt', version: '1' } });
  const rp = await kald('computer_press', { app: 'Notes', title: 'Sortér' });
  const tryk = hj.kald().filter(k => k.argv[0] === 'press' && !k.argv.includes('--dry'));
  check('1a et tryk paa en rullemenu bagved uden laan: afvist foer noget trykkes, og svaret peger paa skaermlaanet',
    rp.fejl && tryk.length === 0 && /menu/i.test(rp.tekst) && /computer_request_screen/.test(rp.tekst), rp.tekst.slice(0, 200));
  await kald('computer_key', { app: 'Notes', combo: 'space' });
  await kald('computer_type', { app: 'Notes', text: 'x' });
  const ind = hj.kald().filter(k => ['key', 'type'].includes(k.argv[0]));
  check('1b i baggrunden baerer taster og tekst til et program --menu-vagt til hjaelperen',
    ind.length === 2 && ind.every(k => k.argv.includes('--menu-vagt')), JSON.stringify(ind.map(k => k.argv)));
  srv.kill();
}
{
  const { srv, rpc, kald, hj } = klient({ apps: APPS,
    'press --dry': { would_press: { name: 'Vis', role: 'AXButton' } }, press: { ok: true, pressed: { name: 'Vis' }, took_screen: false } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'menuvagt', version: '1' } });
  await kald('computer_press', { app: 'Notes', title: 'Vis' });
  const tryk = hj.kald().filter(k => k.argv[0] === 'press' && !k.argv.includes('--dry'));
  check('1c en almindelig knap bagved trykkes stadig - med --menu-vagt til hjaelperen', tryk.length === 1 && tryk[0].argv.includes('--menu-vagt'), JSON.stringify(tryk.map(k => k.argv)));
  srv.kill();
}
{
  const { srv, rpc, kald, hj } = klient({ apps: APPS, key: { ok: true, key: 'space', took_screen: true } }, { CMCP_BACKGROUND: '0' });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'menuvagt', version: '1' } });
  await kald('computer_key', { app: 'Notes', combo: 'space' });
  const ind = hj.kald().filter(k => k.argv[0] === 'key');
  check('1d i forgrunden: intet --menu-vagt (en menu maa aabnes)', ind.length === 1 && !ind[0].argv.includes('--menu-vagt'), JSON.stringify(ind.map(k => k.argv)));
  srv.kill();
}

// 2 · Hjaelperen live mod eget proevemaal: vagten afviser, foer noget sendes - ingen menu aabner.
const koer = (...a) => { try { return JSON.parse(execFileSync(HJAELPER, a, { encoding: 'utf8', timeout: 60000 })); }
                          catch (e) { try { return JSON.parse(String(e.stdout)); } catch { return { ok: false, error: String(e.stdout || e.message).slice(0, 200) }; } } };
const ARB = mkdtempSync(join(tmpdir(), 'cmcp-mv-maal-'));
const navn = 'cmcpmv' + Math.random().toString(36).slice(2, 8);
const BIN = join(ARB, navn);
execFileSync('swiftc', ['-O', join(ROOT, 'test', 'fixture', 'proevemaal.swift'), '-o', BIN], { stdio: 'pipe', timeout: 180000 });
const barn = spawn(BIN, { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, CMCP_PROEVE_MENU: '1', CMCP_PROEVE_MENU_FOKUS: '1' } });
try {
  await new Promise((res) => { barn.stdout.on('data', (d) => { if (/pid=/.test(String(d))) res(); }); setTimeout(res, 15000); });
  for (const frist = Date.now() + 30000; Date.now() < frist; await vent(300)) if ((koer('find', '--app', navn, '--title', 'menu-A', '--limit', '1').matches || []).length) break;
  const tael = () => String(((koer('find', '--app', navn, '--role', 'AXStaticText', '--contains', 'menu:', '--limit', '1').matches || [])[0] || {}).name || '');
  const p = koer('press', '--app', navn, '--role', 'AXPopUpButton', '--title', 'menu-A', '--menu-vagt');
  check('2a tryk paa en rullemenu med menuvagt: afvist (menu-in-background), ingen menu aabnet',
    p.ok === false && p.code === 'menu-in-background' && /aabnet 0/.test(tael()), JSON.stringify(p).slice(0, 160) + ' · ' + tael());
  const k = koer('key', '--app', navn, '--combo', 'space', '--menu-vagt');
  const t = koer('type', '--app', navn, '--text', ' ', '--menu-vagt');
  check('2b fokus paa en rullemenu: tast og tekst med menuvagt afvist (menu-focus), ingen menu aabnet',
    k.code === 'menu-focus' && t.code === 'menu-focus' && /aabnet 0/.test(tael()), JSON.stringify([k.code, t.code]) + ' · ' + tael());
} finally {
  try { barn.kill(); } catch {}
  rmSync(ARB, { recursive: true, force: true });
}

// 3 · Bundet til kilden (mutantporten genbygger ikke hjaelperen).
const m = readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'main.swift'), 'utf8');
check('3 hjaelperen: med menuvagt afvises tryk paa en menurolle og tast/tekst med fokus paa en menurolle',
  /if args\.flag\("menu-vagt"\), let rolle = first\.dict\["role"\] as\? String, Skaerm\.menuRoller\.contains\(rolle\) \{\n\s+Out\.fail\([^\n]*code: "menu-in-background"\)/.test(m)
  && /if args\.flag\("menu-vagt"\), let pid = tastPid, let rolle = AX\.fokusRolle\(pid: pid\), Skaerm\.menuRoller\.contains\(rolle\) \{\n\s+Out\.fail\([^\n]*code: "menu-focus"\)/.test(m)
  && /if args\.flag\("menu-vagt"\), let pid = skrivPid, let rolle = AX\.fokusRolle\(pid: pid\), Skaerm\.menuRoller\.contains\(rolle\) \{\n\s+Out\.fail\([^\n]*code: "menu-focus"\)/.test(m));

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
