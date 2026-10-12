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
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const LRM = '‎';

function klient(svar) {
  const hj = lavFalskHjaelper('cmcp-bundet');
  hj.saetSvar(svar);
  // Ingen aegte dialog kan komme fra denne proeve: osascript er en attrap (claims 26).
  const env = { ...process.env, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti,
                CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-bundet-sp').sti,
                CMCP_STATE_DIR: mkdtempSync(join(tmpdir(), 'cmcp-bundet-')) };
  delete env.CMCP_BACKGROUND;   // standarden: baggrund
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
  check('3 en anden proces med samme id er den mennesket bruger: afvist, intet tastet', r.fejl && tast.length === 0 && /Browser is the window/.test(r.tekst),
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

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
