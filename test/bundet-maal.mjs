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
import { lavFalskHjaelper } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const LRM = '‎';

function klient(svar) {
  const hj = lavFalskHjaelper('cmcp-bundet');
  hj.saetSvar(svar);
  const env = { ...process.env, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti,
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

// 3 · to processer med samme id - den aktive er menneskets (Opus P2). Den aktive staar
//     SIDST, saa et opslag der kun ser paa den foerste proces med id'et, ville sige ja.
{
  const { srv, rpc, kald, hj } = klient({ apps: { apps: [
    { name: 'Wanted', bundleId: 'dk.same', pid: 101, active: false },
    { name: 'Other', bundleId: 'dk.same', pid: 100, active: true },
  ] } });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bundet', version: '1' } });
  const r = await kald('computer_key', { app: 'Wanted', combo: 'cmd+b' });
  const tast = hj.kald().filter(k => k.argv[0] === 'key');
  check('3 en anden proces med samme id er den mennesket bruger: afvist, intet tastet', r.fejl && tast.length === 0,
    JSON.stringify(tast.map(k => k.argv)) + ' · ' + r.tekst.slice(0, 160));
  srv.kill();
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
