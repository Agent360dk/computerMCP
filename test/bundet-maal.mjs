// BUNDET MAAL: det program porten vurderede, er det program handlingen rammer.
//
// ⛔ R17 (Astra + Opus, enige 9/10): navnet blev fortolket to gange - af porten og igen
//    af hjaelperen. Selv med samme regel kunne de to vaelge forskelligt (listen aendrer
//    sig imellem; to processer med samme id). Nu faar alt efter porten det valgte id som
//    `=<id>`, og hjaelperen slaar kun det praecise id op. Opstart af et LUKKET program
//    beholder navnet (et id ville lade Launch Services vaelge enhver kopi der paastaar det).
//
//    Gennem den rigtige server, med en attrap-hjaelper der skriver hvert kald ned.
//    Intet rammer skaermen.
import './ryd-op.mjs';
import './egen-tilstand.mjs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';
// S1b: skridt venter selv paa mennesket (standard 40 s); proeven bruger en kort ventetid.
process.env.CMCP_WAIT_SEK = process.env.CMCP_WAIT_SEK || '1';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const LRM = '‎';

function klient(svar, ekstraEnv = {}) {
  let spoerger = null;
  const hj = lavFalskHjaelper('cmcp-bundet');
  hj.saetSvar(svar);
  // Ingen aegte dialog kan komme fra denne proeve: osascript er en attrap (claims 26).
  const env = { ...process.env, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti,
                CMCP_OSASCRIPT: (spoerger = lavFalskSpoerger('udloeb', 'cmcp-bundet-sp')).sti,
                CMCP_STATE_DIR: mkdtempSync(join(tmpdir(), 'cmcp-bundet-')) };
  delete env.CMCP_BACKGROUND;   // standarden: baggrund
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
  return { srv, rpc, kald, hj, spoerger };
}
const appArgv = (k) => { const i = k.argv.indexOf('--app'); return i >= 0 ? k.argv[i + 1] : undefined; };

// 1 · et koerende program navngivet med sit (usynlige) navn
{
  const { srv, rpc, kald, hj } = klient({ apps: { apps: [
    { name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: false },
    { name: 'TextEdit', bundleId: 'com.apple.TextEdit', pid: 3302, active: true },
    { name: `${LRM}Notes`, bundleId: 'com.apple.Notes', pid: 3303, active: false },
  ] } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_key', { app: 'Notes', combo: 'cmd+b' });
  const tast = hj.kald().filter(k => k.argv[0] === 'key');
  check('1a porten fandt Notes, og hjaelperen fik det BUNDNE id - ikke navnet', tast.length === 1 && appArgv(tast[0]) === '=com.apple.Notes',
    JSON.stringify(tast.map(k => k.argv)) + ' · ' + r.tekst.slice(0, 120));
  check('1b agentens tekst beholder navnet (intet «=» i svaret)', !/=com\.apple\.Notes/.test(r.tekst), r.tekst.slice(0, 160));
  srv.kill();
}

// 2 · et LUKKET program startes: navnet beholdes
{
  const { srv, rpc, kald, hj } = klient({
    apps: { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true }] },
    'resolve-app': { app: 'Calculator', bundleId: 'com.apple.calculator', path: '/System/Applications/Calculator.app', running: false },
  });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_launch', { app: 'Calculator', background: true });
  const start = hj.kald().filter(k => k.argv[0] === 'launch');
  check('2 opstart af et lukket program: hjaelperen faar navnet, ikke et bundet id', start.length === 1 && appArgv(start[0]) === 'Calculator',
    JSON.stringify(start.map(k => k.argv)) + ' · ' + r.tekst.slice(0, 120));
  srv.kill();
}

// 3 · to vinduer af samme program (samme id, samme navn) - mennesket bruger det ene (Opus P2).
//     Den aktive staar SIDST, saa et opslag der kun ser paa den foerste proces, ville sige ja.
{
  const { srv, rpc, kald, hj } = klient({ apps: { apps: [
    { name: 'Browser', bundleId: 'dk.same', pid: 101, active: false },
    { name: 'Browser', bundleId: 'dk.same', pid: 100, active: true },
  ] } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_key', { app: 'Browser', combo: 'cmd+b' });
  const tast = hj.kald().filter(k => k.argv[0] === 'key');
  check('3 en anden proces med samme id er den mennesket bruger: afvist, intet tastet', r.fejl && tast.length === 0 && /Browser is (still )?the window/.test(r.tekst),
    JSON.stringify(tast.map(k => k.argv)) + ' · ' + r.tekst.slice(0, 160));
  srv.kill();
}

// 4 · sendeportens eget opslag faar ogsaa det bundne maal (R18, Astra: «samtale --app com.google.Chrome»)
{
  const { srv, rpc, kald, hj } = klient({
    apps: { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true },
                   { name: 'Google Chrome', bundleId: 'com.google.Chrome', pid: 3304, active: false }] },
    samtale: { window: 'New Tab - Google Chrome' },
  });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  await kald('computer_type', { app: 'Google Chrome', text: 'hej' });
  const samtaler = hj.kald().filter(k => k.argv[0] === 'samtale');
  check('4 sendeportens samtale-opslag faar det bundne id, ligesom leveringen', samtaler.length >= 1 && samtaler.every(k => appArgv(k) === '=com.google.Chrome'),
    JSON.stringify(samtaler.map(k => k.argv)));
  srv.kill();
}

// 6 · visningstjenester: samme id, hvert sit navn (R18, Opus - maalt live paa Gustavs Mac)
{
  const { srv, rpc, kald, hj } = klient({ apps: { apps: [
    { name: 'Autoudfyld (Agent360 IDE)', bundleId: 'com.apple.SafariPlatformSupport.Helper', pid: 3798, active: false },
    { name: 'Autoudfyld (Google Chrome)', bundleId: 'com.apple.SafariPlatformSupport.Helper', pid: 65766, active: false },
    { name: 'Google Chrome', bundleId: 'com.google.Chrome', pid: 65569, active: true },
  ] } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_key', { app: 'Autoudfyld (Google Chrome)', combo: 'cmd+b' });
  const tast = hj.kald().filter(k => k.argv[0] === 'key');
  check('6 en visningstjeneste hvis id deles af en anden: afvist, intet leveret til den forkerte proces', r.fejl && tast.length === 0,
    JSON.stringify(tast.map(k => k.argv)) + ' · ' + r.tekst.slice(0, 120));
  srv.kill();
}

// 7 · computer_open open_app: kun et PRAECIST id (R19, Opus - maalt: «Passwords» startede Adgangskoder uden spoergsmaal)
for (const [bundleId, svar, maaStarte, hvad] of [
  ['Passwords', { app: 'Passwords', bundleId: 'com.apple.Passwords', running: false }, false, 'navnet paa et adgangskodeprogram'],
  ['com.apple.passwords', { app: 'com.apple.passwords', bundleId: 'com.apple.Passwords', running: false }, false, 'id med andre store/smaa'],
  ['com.spotify.client', { app: 'com.spotify.client', bundleId: 'com.spotify.client', running: false }, true, 'et praecist id paa et lukket program'],
  // R20 (Astra): det praecise id paa et adgangskodeprogram afvises af adgangskode-reglen; et fejlet opslag afvises
  ['com.apple.Passwords', { app: 'com.apple.Passwords', bundleId: 'com.apple.Passwords', running: false }, false, 'det praecise id paa et adgangskodeprogram'],
  ['dk.findes.ikke', { ok: false, code: 'not-found', error: 'could not find' }, false, 'et opslag der fejler'],
  // R20 (Opus, MAALT): ogsaa noeglering og terminal slap udenom med en anden stavemaade
  ['com.apple.KeychainAccess', { app: 'com.apple.KeychainAccess', bundleId: 'com.apple.keychainaccess', running: false }, false, 'noeglering med andre store/smaa'],
  ['com.apple.terminal', { app: 'com.apple.terminal', bundleId: 'com.apple.Terminal', running: false }, false, 'terminal med andre store/smaa'],
  ['../Passwords', { app: 'Passwords', bundleId: 'com.apple.Passwords', running: false }, false, 'et ugyldigt id (formkravet foer opslaget)'],
]) {
  const { srv, rpc, kald, hj } = klient({ apps: { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true }] }, 'resolve-app': svar });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_open', { intent: 'open_app', bundleId });
  const start = hj.kald().filter(k => k.argv[0] === 'launch');
  check(`7 open_app med ${hvad} («${bundleId}»): ${maaStarte ? 'startes' : 'afvist, intet startet'}`,
    maaStarte ? (start.length === 1 && appArgv(start[0]) === bundleId) : (r.fejl && start.length === 0),
    JSON.stringify(start.map(k => k.argv)) + ' · ' + r.tekst.slice(0, 140));
  if (bundleId === '../Passwords') {
    const opslag = hj.kald().filter(k => k.argv[0] === 'resolve-app');
    check('7b et ugyldigt id afvises af formkravet FOER noget slaas op', /valid bundle id/.test(r.tekst) && opslag.length === 0, `${opslag.length} opslag`);
  }
  srv.kill();
}

// 5 · bindingen dækker ogsaa et usloeret skaermbillede, som porten vurderer som en skrivning (R18, Astra)
{
  const { readFileSync } = await import('node:fs');
  const ix = readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
  check('5 bindingen: kun et koerende maal fra porten - skrivninger og det usloerede skaermbillede',
    /if \(args\.app && koerendeMaal && koerendeMaal === targetBundleId\n\s+&& \(tool\.tier !== TIER\.READ \|\| \(name === 'computer_screenshot' && args\.redact === false\)\)\) args\[BUNDET\] = koerendeMaal;/.test(ix));
}

// 8 · R27 (10/10): et KLIK med `app` doemmes I maalprogrammet og bindes til det doemte vindue.
//     Porten slog foer punktets ejer op paa hele systemet - det OEVERSTE vindue - og en «Slet»-
//     knap i et daekket program blev doemt efter det harmloese vindue ovenpaa. Nu lander klikket
//     bagved (felt 51/58), saa dommen skal ramme det, klikket rammer.
const APPS8 = { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true },
                       { name: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, active: false }] };
{
  const { srv, rpc, kald, hj } = klient({ apps: APPS8,
    at: { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: 'AXButton', title: 'OK', description: '', window: 'Note', window_number: 777, under: ['com.apple.finder'] },
    'at --app': { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: 'AXButton', title: 'OK', description: '', window: 'Note', window_number: 777, under: ['com.apple.finder'] } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_click', { app: 'Notes', x: 10, y: 20 });
  const at = hj.kald().filter(k => k.argv[0] === 'at'), klik = hj.kald().filter(k => k.argv[0] === 'click');
  const iv = (k, f) => { const i = k.argv.indexOf(f); return i >= 0 ? k.argv[i + 1] : undefined; };
  check('8a porten slaar punktet op I maalprogrammet (at --app med det bundne id), ikke paa hele systemet',
    at.length >= 1 && at.every(k => iv(k, '--app') === '=com.apple.Notes'), JSON.stringify(at.map(k => k.argv)));
  check('8b klikket bindes til det doemte vindue (--window 777)', klik.length === 1 && iv(klik[0], '--window') === '777',
    JSON.stringify(klik.map(k => k.argv)) + ' · ' + r.tekst.slice(0, 100));
  check('8e svaret siger hvilket vindue og at levering ikke er bevis for virkning - intet «did not land»-loefte',
    /window 777/.test(r.tekst) && /not proof/.test(r.tekst) && !/did not land/.test(r.tekst), r.tekst.slice(0, 200));
  srv.kill();
}
{
  const { srv, rpc, kald, hj } = klient({ apps: APPS8,
    at: { found: true, app: 'Finder', bundleId: 'com.apple.finder', pid: 3301, role: 'AXButton', title: 'OK', description: '', window: 'Finder', under: ['com.apple.finder'] },
    'at --app': { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: 'AXButton', title: 'Delete', description: '', window: 'Note', window_number: 777, under: ['com.apple.finder'] } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_click', { app: 'Notes', x: 10, y: 20 });
  const klik = hj.kald().filter(k => k.argv[0] === 'click');
  check('8c en «Delete»-knap i det DAEKKEDE program doemmes farlig: intet klik uden et ja', klik.length === 0 && r.fejl,
    JSON.stringify(klik.map(k => k.argv)) + ' · ' + r.tekst.slice(0, 140));
  srv.kill();
}
{
  const { srv, rpc, kald, hj } = klient({ apps: APPS8, at: { found: true, app: 'Finder', bundleId: 'com.apple.finder', title: 'OK', role: 'AXButton', under: ['com.apple.finder'] },
    'at --app': { found: false, why: 'the point is not inside any window of that app' } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_click', { app: 'Notes', x: 10, y: 20 });
  const klik = hj.kald().filter(k => k.argv[0] === 'click');
  check('8d et punkt uden for programmets vinduer: afvist, intet klik, ingen spurgt', klik.length === 0 && r.fejl && /not inside a window/.test(r.tekst),
    r.tekst.slice(0, 160));
  srv.kill();
}

// 9 · 10/10 (MAALT): et klik der aabner en MENU i et program bagved, tegner menuen paa
//     menneskets skaerm (menulaget 101), og en aaben menu fanger mus og tastatur. Hoejreklik
//     og klik paa en rullemenu bagved afvises derfor uden skaermlaan - foer noget sendes.
for (const [nr, tekst, args, rolle] of [
  ['9a', 'et hoejreklik bagved (kontekstmenu)', { app: 'Notes', x: 10, y: 20, button: 'right' }, 'AXButton'],
  ['9b', 'et klik paa en rullemenu bagved', { app: 'Notes', x: 10, y: 20 }, 'AXPopUpButton'],
  ['9c', 'et klik paa en menuknap bagved', { app: 'Notes', x: 10, y: 20 }, 'AXMenuButton'],
]) {
  const { srv, rpc, kald, hj } = klient({ apps: APPS8,
    at: { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: rolle, title: 'Sortér', description: '', window: 'Note', window_number: 777, under: [] },
    'at --app': { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: rolle, title: 'Sortér', description: '', window: 'Note', window_number: 777, under: [] } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_click', args);
  const klik = hj.kald().filter(k => k.argv[0] === 'click');
  check(`${nr} ${tekst} uden skaermlaan: afvist, intet klik, og svaret peger paa skaermlaanet`,
    klik.length === 0 && r.fejl && /menu/i.test(r.tekst) && /computer_request_screen/.test(r.tekst), r.tekst.slice(0, 200));
  srv.kill();
}
{
  // 9f-9j · R28 R4/R5: tryk paa en menurolle bagved afvises (fund 6, ogsaa i 0.2.2); afvisningen
  //          peger paa skaermlaanet, ikke set_value (maalt: set-ignored); og hjaelperen faar at vide,
  //          naar menuvagten gaelder (baggrund uden laan) - saa nettet aldrig lukker en menu under laan.
  const AT = { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: 'AXButton', title: 'Vis', description: '', window: 'Note', window_number: 777, under: [] };
  const { srv, rpc, kald, hj } = klient({ apps: APPS8, at: AT, 'at --app': AT,
    'press --dry': { would_press: { name: 'Sortér', role: 'AXPopUpButton' } },
    click: { ok: true, clicked: { x: 10, y: 20 }, window_number: 777, took_screen: false },
    key: { ok: true, key: 'space', took_screen: false }, type: { ok: true, typed: 1, took_screen: false } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const rp = await kald('computer_press', { app: 'Notes', title: 'Sortér' });
  const tryk = hj.kald().filter(k => k.argv[0] === 'press' && !k.argv.includes('--dry'));
  check('9f et tryk paa en rullemenu bagved uden laan: afvist foer noget trykkes, og svaret peger paa skaermlaanet',
    rp.fejl && tryk.length === 0 && /menu/i.test(rp.tekst) && /computer_request_screen/.test(rp.tekst), `fejl=${rp.fejl} tryk=${JSON.stringify(tryk.map(k => k.argv))} · ` + rp.tekst.slice(0, 120));
  const rk = await kald('computer_click', { app: 'Notes', x: 10, y: 20, button: 'right' });
  // 14/10: en rullemenu KAN nu vaelges bagved via set_value (aabnes et oejeblik, kun naar mennesket er stille).
  check('9g afvisningen peger paa set_value til rullemenuer og paa skaermlaanet til andre menuer', rk.fejl && /computer_set_value/.test(rk.tekst) && /computer_request_screen/.test(rk.tekst), rk.tekst.slice(0, 260));
  await kald('computer_click', { app: 'Notes', x: 10, y: 20 });
  await kald('computer_key', { app: 'Notes', combo: 'space' });
  await kald('computer_type', { app: 'Notes', text: 'x' });
  const ind = hj.kald().filter(k => ['click', 'key', 'type'].includes(k.argv[0]));
  check('9h i baggrunden baerer klik, taster og tekst til et program --menu-vagt til hjaelperen',
    ind.length === 3 && ind.every(k => k.argv.includes('--menu-vagt')), JSON.stringify(ind.map(k => k.argv)));
  srv.kill();
}
{
  // 9i: i forgrunden (eller under laan) gaelder menuvagten ikke - en menu maa aabnes, og nettet maa ikke lukke den.
  const AT = { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: 'AXButton', title: 'Vis', description: '', window: 'Note', window_number: 777, under: [] };
  const { srv, rpc, kald, hj } = klient({ apps: APPS8, at: AT, 'at --app': AT,
    click: { ok: true, clicked: { x: 10, y: 20 }, window_number: 777, took_screen: false } }, { CMCP_BACKGROUND: '0' });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  await kald('computer_click', { app: 'Notes', x: 10, y: 20 });
  const ind = hj.kald().filter(k => k.argv[0] === 'click');
  check('9i i forgrunden: intet --menu-vagt (en menu maa aabnes)', ind.length === 1 && !ind[0].argv.includes('--menu-vagt'), JSON.stringify(ind.map(k => k.argv)));
  srv.kill();
}
{
  // 9j: aabnede et tryk eller en tast alligevel en menu, siger svaret det (samme som klik, 9e).
  const AT = { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: 'AXButton', title: 'Vis', description: '', window: 'Note', window_number: 777, under: [] };
  const menu = { took_screen: true, menu_opened: true, menu_closed: true, why: 'the click opened a menu, which is drawn on the person\'s screen; it was closed again with Escape.' };
  const { srv, rpc, kald } = klient({ apps: APPS8, at: AT, 'at --app': AT,
    'press --dry': { would_press: { name: 'Vis', role: 'AXButton' } }, press: { ok: true, pressed: { name: 'Vis' }, ...menu }, key: { ok: true, key: 'space', ...menu } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const rp = await kald('computer_press', { app: 'Notes', title: 'Vis' });
  const rk = await kald('computer_key', { app: 'Notes', combo: 'space' });
  check('9j tryk og tast der alligevel aabnede en menu: svaret siger det', [rp, rk].every(r => /A menu opened on the person's screen/.test(r.tekst)),
    rp.tekst.slice(0, 160) + ' · ' + rk.tekst.slice(0, 160));
  srv.kill();
}
{
  // 9n · R32 N5 (Opus): et valg i en rullemenu viser menuen et oejeblik - loggen skal sige at skaermen blev brugt.
  const stat9m = mkdtempSync(join(tmpdir(), 'cmcp-bundet-9m-'));
  const valgt = { ok: true, set: true, verified: true, chosen_in_popup: true, took_screen: true, menu_opened: true, menu_closed: true, closed_by: 'the choice', value_now: 'B' };
  const { srv, rpc, kald } = klient({ apps: APPS8, 'set-value': valgt }, { CMCP_STATE_DIR: stat9m });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const rv = await kald('computer_set_value', { app: 'Notes', role: 'AXPopUpButton', text: 'B' });
  await new Promise(r => setTimeout(r, 300));
  srv.kill();
  const linjer9m = (() => { try { return readFileSync(join(stat9m, 'audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)); } catch { return []; } })();
  const sv9m = linjer9m.filter(l => l.tool === 'computer_set_value' && l.outcome === 'ok');
  check('9n et valg i en rullemenu staar i loggen som skaermbrug (took_screen: true)',
    !rv.fejl && sv9m.length === 1 && sv9m[0].took_screen === true, rv.tekst.slice(0, 120) + ' · ' + JSON.stringify(sv9m).slice(0, 200));
}
{
  // 9o · R34 (Astra, maalt): et fejlsvar med en lang punktliste maa ikke skære statusfelterne af.
  const lange = Array.from({ length: 80 }, (_, i) => `punkt "${i}" med et langt navn 👩‍👩‍👧‍👦 og citat «${i}»`);
  const fejl = { ok: false, code: 'no-such-item', error: "the pop-up has no item called 'X' - nothing was chosen.", items: lange, items_total: 80,
                 menu_opened: true, took_screen: true, menu_closed: false, menu_check: 'unknown', value_now: 'B', element: { app: 'Notes', role: 'AXPopUpButton', name: 'A' } };
  const { srv, rpc, kald } = klient({ apps: APPS8, 'set-value': fejl });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const rf = await kald('computer_set_value', { app: 'Notes', role: 'AXPopUpButton', text: 'X' });
  srv.kill();
  check('9o en lang punktliste skærer ikke statusfelterne af (menu_closed, took_screen, value_now, menu_check)',
    rf.fejl && ['"menu_closed": false', '"took_screen": true', '"value_now": "B"', '"menu_check": "unknown"', '"items_cut": true'].every(t => rf.tekst.includes(t)), rf.tekst.slice(0, 200));
}
{
  // 9p · R35 (Astra, maalt): en lang VAERDI maa ikke skaeres midt i strengen - svaret skal vaere gyldig JSON med
  //      statusfelterne, og to lange kandidatnavne maa ikke blive til en tom liste.
  const famille = '👨‍👩‍👧‍👦'.repeat(120);
  const lang = (i) => `kandidat ${i} ` + 'meget langt navn '.repeat(60);
  const fejl = { ok: false, code: 'set-ignored', error: "'X' was pressed in the menu, but the pop-up does not show it afterwards.", items: [lang(1), lang(2)],
                 menu_opened: true, took_screen: true, menu_closed: true, closed_by: 'the choice', value_now: famille, element: { app: 'Notes', role: 'AXPopUpButton', name: famille } };
  const { srv, rpc, kald } = klient({ apps: APPS8, 'set-value': fejl });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const rf = await kald('computer_set_value', { app: 'Notes', role: 'AXPopUpButton', text: 'X' });
  srv.kill();
  let j9p = null; try { j9p = JSON.parse(rf.tekst.slice(rf.tekst.indexOf('\n\n{') + 2)); } catch {}
  check('9p en lang vaerdi: gyldig JSON, statusfelterne og begge kandidater med, afkortningen sagt',
    rf.fejl && j9p && j9p.menu_closed === true && j9p.took_screen === true && j9p.closed_by === 'the choice'
    && typeof j9p.value_now === 'string' && j9p.value_now.endsWith('…') && Array.isArray(j9p.items) && j9p.items.length === 2 && j9p.values_cut === true,
    rf.tekst.slice(0, 160) + ' · ' + (j9p ? Object.keys(j9p).join(',') : 'ugyldig JSON'));
}
{
  // 9k · R28 R6: hentede et klik bagved programmet frem, siger svaret det - og at forgrunden blev givet tilbage.
  const AT = { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: 'AXLink', title: 'Aabn', description: '', window: 'Note', window_number: 777, under: [] };
  const { srv, rpc, kald } = klient({ apps: APPS8, at: AT, 'at --app': AT,
    click: { ok: true, clicked: { x: 10, y: 20 }, window_number: 777, took_screen: true, gave_back: true, why: 'Notes brought itself to the front when this ran; the front was handed straight back to Finder' } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_click', { app: 'Notes', x: 10, y: 20 });
  check('9k et klik der hentede programmet frem: svaret siger det og at forgrunden blev givet tilbage', !r.fejl && /brought itself to the front/.test(r.tekst) && /handed straight back/.test(r.tekst), r.tekst.slice(0, 300));
  srv.kill();
}
{
  // 9e: aabnede et klik alligevel en menu (nettet i hjaelperen lukkede den), siger svaret det.
  const AT = { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: 'AXButton', title: 'Vis', description: '', window: 'Note', window_number: 777, under: [] };
  const { srv, rpc, kald } = klient({ apps: APPS8, at: AT, 'at --app': AT,
    click: { ok: true, clicked: { x: 10, y: 20 }, window_number: 777, took_screen: true, menu_opened: true, menu_closed: true, why: 'the click opened a menu, which is drawn on the person\'s screen; it was closed again with Escape.' } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_click', { app: 'Notes', x: 10, y: 20 });
  check('9e et klik der alligevel aabnede en menu: svaret fortaeller agenten det, og at den blev lukket',
    !r.fejl && /A menu opened on the person's screen/.test(r.tekst) && /closed again with Escape/.test(r.tekst), r.tekst.slice(0, 300));
  srv.kill();
}
{
  const { readFileSync } = await import('node:fs');
  const ix = readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
  check('9d reglen gaelder kun i baggrunden uden laan - under et skaermlaan maa en menu aabnes',
    /if \(baggrund\(\) && !laanAktivt\(\) && \(String\(args\.button \|\| 'left'\) !== 'left' \|\| MENU_ROLLER\.has\(appKlik\.role\)\)\) \{/.test(ix));
}

// 10 · 10/10 (MAALT): et rul til et program uden punkt landede ikke bagved. Med `app` faar
//      hjaelperen altid et punkt - agentens, ellers midten af programmets forreste vindue.
{
  const { srv, rpc, kald, hj } = klient({ apps: APPS8,
    windows: { ok: true, count: 1, windows: [{ app: 'Notes', bundleId: 'com.apple.Notes', frame: { x: 100, y: 200, w: 400, h: 300 }, title: 'Note' }] },
    scroll: { ok: true, took_screen: false } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r1 = await kald('computer_scroll', { app: 'Notes', dy: -40 });
  const r2 = await kald('computer_scroll', { app: 'Notes', dy: -40, x: 150, y: 260 });
  const rul = hj.kald().filter(k => k.argv[0] === 'scroll');
  const iv = (k, f) => { const i = k.argv.indexOf(f); return i >= 0 ? k.argv[i + 1] : undefined; };
  check('10a uden punkt: midten af programmets forreste vindue (300, 350)', rul.length === 2 && iv(rul[0], '--x') === '300' && iv(rul[0], '--y') === '350' && /at 300, 350/.test(r1.tekst),
    JSON.stringify(rul.map(k => k.argv)) + ' · ' + r1.tekst.slice(0, 80));
  check('10b med punkt: agentens punkt sendes uaendret', iv(rul[1], '--x') === '150' && iv(rul[1], '--y') === '260', JSON.stringify(rul[1]?.argv));
  // R28 (Astra): uden `app` doemmes rullet ved markoeren - et punkt maa saa ikke sendes. Og et halvt punkt kasseres ikke i stilhed.
  const foer = hj.kald().filter(k => k.argv[0] === 'scroll').length;
  const r4 = await kald('computer_scroll', { app: 'Notes', dy: -40, x: 999 });
  const efter = hj.kald().filter(k => k.argv[0] === 'scroll').length;
  check('10d et halvt punkt afvises - x kasseres ikke i stilhed', r4.fejl && /both x and y/.test(r4.tekst) && efter === foer, r4.tekst.slice(0, 160));
  check('10e svaret siger «sent», ikke at der blev rullet', /Scroll sent/.test(r1.tekst) && !/Scrolled/.test(r1.tekst), r1.tekst.slice(0, 120));
  srv.kill();
}
{
  // 10c · i FORGRUNDEN (CMCP_BACKGROUND=0) maa et rul uden app gaa ved markoeren - og kun dér, hvor det blev doemt.
  const AT = { found: true, app: 'Finder', bundleId: 'com.apple.finder', pid: 3301, role: 'AXScrollArea', title: '', description: '', window: 'Finder', under: [] };
  const { srv, rpc, kald, hj } = klient({ apps: APPS8, at: AT, scroll: { ok: true, took_screen: true } }, { CMCP_BACKGROUND: '0' });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r3 = await kald('computer_scroll', { dy: -40, x: 999, y: 888 });
  const r5 = await kald('computer_scroll', { dy: -40 });
  const rul = hj.kald().filter(k => k.argv[0] === 'scroll');
  check('10c forgrund: et punkt uden app afvises (porten doemte markoeren) - kun rullet uden punkt sendes',
    r3.fejl && /need app/.test(r3.tekst) && rul.length === 1 && !rul[0].argv.includes('--x'), r3.tekst.slice(0, 160) + ' · ' + JSON.stringify(rul.map(k => k.argv)) + ' · ' + r5.tekst.slice(0, 80));
  srv.kill();
}

// 11 · R29 (Astra): Q26 og R4-opslagsfejl er IKKE ækvivalente - to opslag efter hinanden kan
//      svare forskelligt (et program der er optaget, en knap mere i chatten). Forgrund, saa
//      spoergsmaal gaar til attrappen og kan taelles.
{
  const FUNDET = { found: true, bundleId: 'com.apple.calculator', role: 'AXButton', title: 'OK', window: 'Lommeregner', under: ['com.apple.calculator'] };
  const { srv, rpc, kald, hj, spoerger } = klient({
    apps: { apps: [{ name: 'Lommeregner', bundleId: 'com.apple.calculator', pid: 100, active: false },
                   { name: 'Finder', bundleId: 'com.apple.finder', pid: 300, active: true }] },
    at: { _raekke: [FUNDET, { found: false, under: [] }, FUNDET] } }, { CMCP_BACKGROUND: '0' });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_click', { x: 10, y: 20 });
  const klik = hj.kald().filter(k => k.argv[0] === 'click');
  // R9d: ét opslag doemmer nu ejer OG knap (Astra R9-1); det andet opslag er genmaalingen under laasen. Egenskaben er den
  //      samme som foer: svarer et opslag intet, klikkes der ikke.
  check('11a klik uden app: ejeren fundet ved dommen, genmaalingen svarer intet - intet klik',
    klik.length === 0 && r.fejl && /could not be confirmed just before acting/.test(r.tekst), `klik ${klik.length} · spurgt ${spoerger.gangeSpurgt()} · ` + r.tekst.slice(0, 120));
  srv.kill();
}
{
  const SEND = { would_press: { name: 'Send', role: 'AXButton', window: 'WhatsApp', frame: { x: 570, y: 605, w: 30, h: 30 } } };
  const { srv, rpc, kald, hj, spoerger } = klient({
    apps: { apps: [{ name: 'WhatsApp', bundleId: 'net.whatsapp.WhatsApp', pid: 200, active: false },
                   { name: 'Finder', bundleId: 'com.apple.finder', pid: 300, active: true }] },
    samtale: { window: 'WhatsApp', headings: ['Test recipient'], column: true, field: { role: 'AXTextArea', value: 'TEST', frame: { x: 160, y: 600, w: 400, h: 40 } } },
    'press --dry': { _raekke: [SEND, { ok: false, code: 'not-found', error: 'the element was not found' }, SEND] },
    press: { pressed: { name: 'Send' }, took_screen: false } }, { CMCP_BACKGROUND: '0' });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_press', { app: 'WhatsApp', title: 'Send' });
  const tryk = hj.kald().filter(k => k.argv[0] === 'press' && !k.argv.includes('--dry'));
  check('11b tryk paa Send: forhaandsopslaget finder den, sendeportens opslag fejler - afvist uden spoergsmaal, intet trykket',
    r.fejl && tryk.length === 0 && spoerger.gangeSpurgt() === 0, `tryk ${tryk.length} · spurgt ${spoerger.gangeSpurgt()} · ` + r.tekst.slice(0, 120));
  srv.kill();
}
{
  // 8f · R29 (Opus): et tvetydigt punkt sender ikke agenten i ring - hjaelperens grund og vejen videre.
  const { srv, rpc, kald } = klient({ apps: APPS8,
    'at --app': { found: false, under: [], why: 'what is under that point is ambiguous or could not be read in time (more than one element covers it, or the search ran out), so it is not guessed' } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_click', { app: 'Notes', x: 10, y: 20 });
  check('8f tvetydigt punkt: afvist med hjaelperens grund og en vej videre (computer_press), ikke «not inside a window»',
    r.fejl && /ambiguous/.test(r.tekst) && /computer_press/.test(r.tekst) && !/not inside a window/.test(r.tekst), r.tekst.slice(0, 220));
  srv.kill();
}
{
  // 9l · R29 (Astra): kunne nettet ikke se, om en menu aabnede, skal agenten vide det.
  const AT = { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: 'AXButton', title: 'Vis', description: '', window: 'Note', window_number: 777, under: [] };
  const ukendt = { took_screen: false, menu_check: 'unknown', why: 'whether a menu opened on the person\'s screen could not be checked (the window list could not be read)' };
  const { srv, rpc, kald } = klient({ apps: APPS8, at: AT, 'at --app': AT,
    click: { clicked: { x: 10, y: 20 }, window_number: 777, ...ukendt }, key: { key: 'space', ...ukendt }, type: { typed: 1, ...ukendt } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const svar = [await kald('computer_click', { app: 'Notes', x: 10, y: 20 }), await kald('computer_key', { app: 'Notes', combo: 'space' }), await kald('computer_type', { app: 'Notes', text: 'x' })];
  check('9l ukendt menustatus naar agenten fra klik, tast og tekst', svar.every(r => /could not be checked/.test(r.tekst)), svar.map(r => r.tekst.slice(0, 90)).join(' · '));
  // R30 (Astra): ...og svaret lover ikke bagefter, at intet kom frem - det kan ikke vides.
  check('9m ukendt menustatus: intet «nothing came to the front» i svaret', svar.every(r => !/nothing came to the front/i.test(r.tekst)), svar.map(r => r.tekst.slice(-120)).join(' · '));
  srv.kill();
}

// 12 · R7 (Opus, MAALT med egen attrap): genkontrollen lige foer klikket gaelder ALLE app-klik - ogsaa et
//      program der ikke er en browser (Notes). Foerste «at --app» doemmer punktet, det naeste er genkontrollen
//      under laasen; attrappen svarer i raekkefoelge. 12a kalibrerer: et uaendret punkt klikkes stadig.
{
  const OK = { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: 'AXButton', title: 'OK', description: '', window: 'Note', window_number: 777, under: ['com.apple.finder'] };
  const VAULT = { ...OK, role: '', title: '', description: '', window: '', password_page: true, note: 'The point is inside a password manager page; nothing from it is returned.' };
  const UAFGJORT = { ...VAULT, note: 'The point is inside a page whose address could not be read, so it could not be ruled out as a password manager; nothing from it is returned.' };
  const ULAESELIG = { found: false, under: [], why: 'the point could not be read' };
  for (const [id, hvad, anden, skalKlikke, moenster] of [
    ['12a', 'punktet er uaendret: klikket sendes (genkontrollen spaerrer ikke et almindeligt klik)', OK, true, null],
    ['12b', 'punktet er nu i en adgangskode-side: intet klik, og svaret beder agenten spoerge personen - ikke «kald igen»', VAULT, false, /now inside a password manager page/],
    ['12c', 'punktet kan ikke slaas op igen: intet klik', ULAESELIG, false, /could not be checked again just before the click/],
    ['12b2', 'punktet kunne ikke afgoeres: intet klik, og svaret kalder det ikke en adgangskode-side (R8-O6)', UAFGJORT, false, /could no longer be ruled out as a password manager page/],
  ]) {
    const { srv, rpc, kald, hj } = klient({ apps: APPS8, at: OK, 'at --app': { _raekke: [OK, anden] } });
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
    const r = await kald('computer_click', { app: 'Notes', x: 10, y: 20 });
    const klik = hj.kald().filter(k => k.argv[0] === 'click');
    const atApp = hj.kald().filter(k => k.argv[0] === 'at' && k.argv.includes('--app'));
    const ok = skalKlikke ? (klik.length === 1 && atApp.length >= 2)
      : (klik.length === 0 && r.fejl && moenster.test(r.tekst) && (id !== '12b' || (!/Call it again/.test(r.tekst) && /ask the person/.test(r.tekst))));
    check(`${id} genkontrollen (Notes, ikke en browser): ${hvad}`, ok, `klik ${klik.length} · at --app ${atApp.length} · ` + r.tekst.slice(0, 200));
    srv.kill();
  }
}
// 12d-12l · R6-R10 (Astra + Opus, MAALT over fire runder): et klik UDEN app i en adgangskode-side - genkendt eller ikke
//          udelukket - afvises nu, som et klik med app. Et ja til et blindt klik kunne ikke bindes til siden (pid, ramme og
//          note overlever en navigation), saa ingen spoerges. Doemt paa ét opslag (ejeren) i alle browsere. Forgrund, og
//          personen ville sige ja - det maa ikke hjaelpe. Raekkefoelgen af `at`: [0] ejer/dom, [1] genmaaling under laasen.
{
  const NOTE = (g) => `The point is inside ${g}; nothing from it is returned.`;
  const V = { found: true, app: 'Google Chrome', bundleId: 'com.google.Chrome', pid: 400, role: '', title: '', description: '', window: '', password_page: true, note: NOTE('a password manager page'), frame: { x: 0, y: 0, w: 300, h: 40 }, under: ['com.google.Chrome'] };
  const O = { ...V, role: 'AXButton', title: 'OK', window: 'Dokument', password_page: false, note: '' };
  const app = (bid, navn) => ({ apps: [{ name: navn, bundleId: bid, pid: 400, active: false }, { name: 'Finder', bundleId: 'com.apple.finder', pid: 300, active: true }] });
  const som = (o, bid, navn) => ({ ...o, bundleId: bid, app: navn, under: [bid] });
  const UAFGJORTE = ['a page whose address could not be read, so it could not be ruled out as a password manager',
                     'a page that looks like a password manager (it has no address)',
                     'an element whose app and page could not be checked',
                     'an element whose app could not be identified, so its page could not be checked',
                     'an element in a browser whose page could not be checked',
                     'a browser element whose role could not be read, so it could not be ruled out as a password manager page'];
  const tilfaelde = [
    ['12d', 'genkendt vault i Chrome: afvist, ingen spurgt', 'com.google.Chrome', 'Google Chrome', [V, V], 'Vault', /never clicked by an agent/, false],
    ['12f', 'genkendt vault, et senere opslag ville se en OK-knap (R8-sekvensen): afvist paa dommen', 'com.google.Chrome', 'Google Chrome', [V, O, V], 'Vault', /never clicked by an agent/, false],
    ['12i', 'Chrome Beta (uden for beskedlisten): afvist', 'com.google.Chrome.beta', 'Google Chrome Beta', [som(V, 'com.google.Chrome.beta', 'Google Chrome Beta'), som(O, 'com.google.Chrome.beta', 'Google Chrome Beta')], 'Vault', /never clicked by an agent/, false],
    ['12i2', 'Firefox Nightly (uden for beskedlisten): afvist', 'org.mozilla.nightly', 'Firefox Nightly', [som(V, 'org.mozilla.nightly', 'Firefox Nightly'), som(O, 'org.mozilla.nightly', 'Firefox Nightly')], 'Vault', /never clicked by an agent/, false],
    ...UAFGJORTE.map((g, i) => [`12e${i + 1}`, `ikke udelukket («${g.slice(0, 34)}…») i en webchat: afvist som adgangskode-side, ikke som Send`, 'com.google.Chrome', 'Google Chrome', [{ ...V, note: NOTE(g) }, { ...V, note: NOTE(g) }], 'WhatsApp', /could not be ruled out as a password manager page/, false]),
    ['12k', 'et almindeligt punkt (Notes) bliver en vault under ventetiden: intet klik', 'com.apple.Notes', 'Notes', [som(O, 'com.apple.Notes', 'Notes'), som(V, 'com.apple.Notes', 'Notes')], 'Note', /now inside a password manager page/, false],
    ['12l', 'kalibrering: et almindeligt OK-klik i Chrome (ikke vault, ikke chat) gaar igennem', 'com.google.Chrome', 'Google Chrome', [O, O], 'Dokument', null, true],
  ];
  for (const [id, hvad, bid, navn, raekke, vindue, tekst, skalKlikke] of tilfaelde) {
    const sp = lavFalskSpoerger('ja', 'cmcp-bundet-vault');
    const { srv, rpc, kald, hj } = klient({ apps: app(bid, navn), at: { _raekke: raekke }, samtale: { window: vindue } }, { CMCP_BACKGROUND: '0', CMCP_OSASCRIPT: sp.sti });
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
    const r = await kald('computer_click', { x: 10, y: 20 });
    const klik = hj.kald().filter(k => k.argv[0] === 'click');
    const ok = skalKlikke ? klik.length === 1
      : (klik.length === 0 && r.fejl && sp.gangeSpurgt() === 0 && tekst.test(r.tekst) && !/Send control|Nothing was sent/.test(r.tekst));
    check(`${id} klik uden app: ${hvad}`, ok, `klik ${klik.length} · spurgt ${sp.gangeSpurgt()} · ` + r.tekst.slice(0, 170));
    srv.kill();
  }
}

// 13 · R10c/R11 (Opus R10-O1, Astra R11, MAALT): et traek (altid uden app) sender mouseDown paa startpunktet, og hjaelperens
//      stopvej sender mouseUp samme sted - startpunktet doemmes derfor praecis som et klik (sende-dom, farlige knapper,
//      adgangskode-sider); en ende i en adgangskode-side afvises. Ingen «samme element»-heuristik: skydere og tekstmarkering
//      gaar igennem. Raekkefoelgen af `at`: [0] start, [1] slut (dommen), [2] start, [3] slut (genmaalingen). Forgrund.
{
  const NOTE = 'The point is inside a password manager page; nothing from it is returned.';
  const E = (frame, extra = {}) => ({ found: true, app: 'Google Chrome', bundleId: 'com.google.Chrome', pid: 400, role: 'AXButton', title: 'OK', description: '', window: 'Dokument', frame, under: ['com.google.Chrome'], ...extra });
  const A = E({ x: 0, y: 0, w: 120, h: 30 }), B = E({ x: 0, y: 200, w: 120, h: 30 });
  const SEND = E({ x: 400, y: 600, w: 40, h: 30 }, { title: 'Send', window: 'WhatsApp' });
  const SEND_TOM = E({}, { title: 'Send', window: 'WhatsApp' });
  const SLIDER = E({ x: 0, y: 0, w: 300, h: 20 }, { role: 'AXSlider', title: '' });
  const TEKST = E({ x: 0, y: 0, w: 400, h: 200 }, { role: 'AXTextArea', title: '' });
  const V = E({ x: 0, y: 0, w: 120, h: 30 }, { role: '', title: '', window: '', password_page: true, note: NOTE });
  const APPS = { apps: [{ name: 'Google Chrome', bundleId: 'com.google.Chrome', pid: 400, active: false }, { name: 'Finder', bundleId: 'com.apple.finder', pid: 300, active: true }] };
  for (const [id, hvad, fra, til, raekke, vindue, tekst, skalSendes] of [
    ['13a', 'traek paa 0 pt fra en webchat-Send: sende-dommen, intet traek uden en dom', [410, 610], [410, 610], [SEND, SEND, SEND, SEND], 'WhatsApp', /Send control|Nothing was sent|person said no/, false],
    ['13b', 'traek paa 200 pt der STARTER paa en webchat-Send: sende-dommen gaelder startpunktet', [410, 610], [410, 210], [SEND, B, SEND, B], 'WhatsApp', /Send control|Nothing was sent|person said no/, false],
    ['13h', 'dommen ser almindelige elementer, genmaalingen ser Send paa startpunktet (Astra R11): intet traek', [10, 20], [10, 220], [A, B, SEND, B], 'WhatsApp', /changed|Send control|not sent/, false],
    ['13i', 'Send med tom ramme (frame {}) i begge ender (Astra R11): sende-dommen, intet traek', [410, 610], [450, 610], [SEND_TOM, SEND_TOM, SEND_TOM, SEND_TOM], 'WhatsApp', /Send control|Nothing was sent|person said no/, false],
    ['13c', 'traek der starter i en adgangskode-side: afvist, ingen spurgt', [10, 20], [10, 220], [V, B, V, B], 'Dokument', /a point of that drag is inside a password manager page/, false],
    ['13c2', 'traek der ender i en adgangskode-side: afvist', [10, 220], [10, 20], [B, V, B, V], 'Dokument', /a point of that drag is inside a password manager page/, false],
    ['13d', 'traekkets slutpunkt bliver en adgangskode-side under ventetiden: intet traek', [10, 20], [10, 220], [A, B, A, { ...V, frame: B.frame }], 'Dokument', /now inside a password manager page/, false],
    ['13e', 'kalibrering: et almindeligt traek mellem to forskellige elementer sendes', [10, 20], [10, 220], [A, B, A, B], 'Dokument', null, true],
    ['13f', 'traek inden for en skyder (samme element) sendes - ingen over-blokering (Astra R11)', [10, 10], [200, 10], [SLIDER, SLIDER, SLIDER, SLIDER], 'Dokument', null, true],
    ['13g', 'tekstmarkering inden for et tekstfelt (samme element) sendes (Astra R11)', [10, 10], [300, 150], [TEKST, TEKST, TEKST, TEKST], 'Dokument', null, true],
  ]) {
    const sp = lavFalskSpoerger('udloeb', 'cmcp-bundet-traek');
    const { srv, rpc, kald, hj } = klient({ apps: APPS, at: { _raekke: raekke }, samtale: { window: vindue } }, { CMCP_BACKGROUND: '0', CMCP_OSASCRIPT: sp.sti });
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
    const r = await kald('computer_drag', { fromX: fra[0], fromY: fra[1], toX: til[0], toY: til[1] });
    const traek = hj.kald().filter(k => k.argv[0] === 'drag');
    const ok = skalSendes ? traek.length === 1 : (traek.length === 0 && r.fejl && tekst.test(r.tekst));
    check(`${id} ${hvad}`, ok, `traek ${traek.length} · spurgt ${sp.gangeSpurgt()} · ` + r.tekst.slice(0, 160));
    srv.kill();
  }
}
// 13j-13k · R12 (Astra, MAALT): samtykkets maal er det farligste program under BEGGE ender, men startpunktet er det der klikkes.
//          13j: et traek fra en Chrome-Send til Terminal - personen siger ja til Terminal - maa ikke slippe uden om sende-dommen.
//          13k: start og slut bytter ejer under ventetiden (maengden er den samme) - startpunktet er nu en Send.
{
  const SEND = { found: true, app: 'Google Chrome', bundleId: 'com.google.Chrome', pid: 400, role: 'AXButton', title: 'Send', description: '', window: 'WhatsApp', frame: { x: 400, y: 600, w: 40, h: 30 }, under: ['com.google.Chrome'] };
  const TERM = { found: true, app: 'Terminal', bundleId: 'com.apple.Terminal', pid: 500, role: 'AXTextArea', title: '', description: '', window: 'zsh', frame: { x: 0, y: 0, w: 600, h: 400 }, under: ['com.apple.Terminal'] };
  const FIND = { found: true, app: 'Finder', bundleId: 'com.apple.finder', pid: 300, role: 'AXGroup', title: '', description: '', window: 'Dokumenter', frame: { x: 0, y: 0, w: 600, h: 400 }, under: ['com.apple.finder'] };
  const APPS = { apps: [{ name: 'Google Chrome', bundleId: 'com.google.Chrome', pid: 400, active: false }, { name: 'Terminal', bundleId: 'com.apple.Terminal', pid: 500, active: false },
                        { name: 'Finder', bundleId: 'com.apple.finder', pid: 300, active: true }] };
  for (const [id, hvad, raekke, tekst] of [
    ['13j', 'traek fra en Chrome-Send til Terminal: sende-dommen gaelder startpunktet, ogsaa naar personen siger ja til Terminal', [SEND, TERM, SEND, TERM], /Send control|Nothing was sent|not sent/],
    ['13k', 'start og slut bytter ejer under ventetiden (Finder -> Chrome-Send): afvist, intet traek', [FIND, SEND, SEND, FIND], /start point changed/],
  ]) {
    const sp = lavFalskSpoerger('ja', 'cmcp-bundet-traek2');
    const { srv, rpc, kald, hj } = klient({ apps: APPS, at: { _raekke: raekke }, samtale: { window: 'WhatsApp' } }, { CMCP_BACKGROUND: '0', CMCP_OSASCRIPT: sp.sti });
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
    const r = await kald('computer_drag', { fromX: 410, fromY: 610, toX: 100, toY: 100 });
    const traek = hj.kald().filter(k => k.argv[0] === 'drag');
    check(`${id} ${hvad}`, traek.length === 0 && r.fejl && tekst.test(r.tekst), `traek ${traek.length} · spurgt ${sp.gangeSpurgt()} · ` + r.tekst.slice(0, 160));
    srv.kill();
  }
}
// 13l-13n · R13 (Astra R12, MAALT): farlig-knap-dommen gentages under laasen paa det genmaalte punkt. «OK» ved dommen og
//          «Delete» lige foer handlingen: intet klik/traek. 13o kalibrerer: et uaendret «OK» klikkes stadig.
{
  const OKF = { found: true, app: 'Finder', bundleId: 'com.apple.finder', pid: 300, role: 'AXButton', title: 'OK', description: '', window: 'Dokumenter', frame: { x: 0, y: 0, w: 60, h: 30 }, under: ['com.apple.finder'] };
  const DELF = { ...OKF, title: 'Delete' };
  const FLADE = { ...OKF, role: 'AXGroup', title: '' };
  const APPSF = { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 300, active: true }] };
  for (const [id, hvad, vaerktoej, raekke, skal] of [
    ['13l', 'klik uden app: OK ved dommen, Delete under laasen - intet klik', 'computer_click', [OKF, DELF], false],
    ['13m', 'traek: startpunktet OK ved dommen, Delete under laasen - intet traek', 'computer_drag', [OKF, FLADE, DELF, FLADE], false],
    ['13o', 'kalibrering: klik paa et uaendret OK gaar igennem', 'computer_click', [OKF, OKF], true],
  ]) {
    const sp = lavFalskSpoerger('ja', 'cmcp-bundet-knap');
    const { srv, rpc, kald, hj } = klient({ apps: APPSF, at: { _raekke: raekke } }, { CMCP_BACKGROUND: '0', CMCP_OSASCRIPT: sp.sti });
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
    const r = await kald(vaerktoej, vaerktoej === 'computer_drag' ? { fromX: 10, fromY: 10, toX: 300, toY: 300 } : { x: 10, y: 10 });
    const handling = hj.kald().filter(k => k.argv[0] === (vaerktoej === 'computer_drag' ? 'drag' : 'click'));
    const ok = skal ? handling.length === 1 : (handling.length === 0 && r.fejl && /became a button that can delete/.test(r.tekst));
    check(`${id} ${hvad}`, ok, `handling ${handling.length} · spurgt ${sp.gangeSpurgt()} · ` + r.tekst.slice(0, 160));
    srv.kill();
  }
  // 13n: med app (Notes) - genkontrollens «at --app» genbruges, intet tredje opslag.
  const OK = { found: true, app: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, role: 'AXButton', title: 'OK', description: '', window: 'Note', window_number: 777, under: ['com.apple.finder'] };
  const { srv, rpc, kald, hj } = klient({ apps: APPS8, at: OK, 'at --app': { _raekke: [OK, { ...OK, title: 'Delete' }] } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_click', { app: 'Notes', x: 10, y: 20 });
  const klik = hj.kald().filter(k => k.argv[0] === 'click');
  const atApp = hj.kald().filter(k => k.argv[0] === 'at' && k.argv.includes('--app'));
  check('13n klik med app (Notes): OK ved dommen, Delete under laasen - intet klik, og kun de to «at --app»',
    klik.length === 0 && r.fejl && /became a button that can delete/.test(r.tekst) && atApp.length === 2, `klik ${klik.length} · at --app ${atApp.length} · ` + r.tekst.slice(0, 160));
  srv.kill();
}
// 12m · R11 (Astra, mutant S): et klik uden app doemmes paa ÉT opslag - sende-dommen og knapErFarlig genbruger ejerens.
//       Et almindeligt klik i en browser giver derfor praecis to `at`: dommen og genmaalingen under laasen.
{
  const O = { found: true, app: 'Google Chrome', bundleId: 'com.google.Chrome', pid: 400, role: 'AXButton', title: 'OK', description: '', window: 'Dokument', frame: { x: 0, y: 0, w: 120, h: 30 }, under: ['com.google.Chrome'] };
  const { srv, rpc, kald, hj } = klient({ apps: { apps: [{ name: 'Google Chrome', bundleId: 'com.google.Chrome', pid: 400, active: false }, { name: 'Finder', bundleId: 'com.apple.finder', pid: 300, active: true }] },
    at: O, samtale: { window: 'Dokument' } }, { CMCP_BACKGROUND: '0' });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_click', { x: 10, y: 20 });
  const at = hj.kald().filter(k => k.argv[0] === 'at'), klik = hj.kald().filter(k => k.argv[0] === 'click');
  check('12m klik uden app i en browser: ét opslag til dommen + ét til genmaalingen (ingen egne opslag i sende-dom og knap-dom)',
    klik.length === 1 && at.length === 2, `at ${at.length} · klik ${klik.length} · ` + r.tekst.slice(0, 100));
  srv.kill();
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
