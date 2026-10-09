// OPEN_APP: kun et PRAECIST bundle-id.
//
// ⛔ 9/10 (R19 Opus, MAALT): computer_open {intent:"open_app", bundleId:"Passwords"} blev doemt
//    som id'et «Passwords» - ikke paa adgangskode-listen - mens hjaelperen startede Adgangskoder
//    ved NAVN, uden spoergsmaal i standardtilstanden. Ogsaa «com.apple.passwords»: listen
//    sammenligner praecist, og Launch Services er ufoelsom for store/smaa (maalt paa Gustavs Mac).
//    Gennem den rigtige server med en attrap-hjaelper: intet rammer skaermen, og en afvisning
//    starter intet.
import './ryd-op.mjs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { lavFalskHjaelper } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

for (const [bundleId, svar, maaStarte, hvad] of [
  ['Passwords', { app: 'Passwords', bundleId: 'com.apple.Passwords', running: false }, false, 'navnet paa et adgangskodeprogram'],
  ['com.apple.passwords', { app: 'com.apple.passwords', bundleId: 'com.apple.Passwords', running: false }, false, 'id med andre store/smaa'],
  ['com.apple.Passwords', { app: 'com.apple.Passwords', bundleId: 'com.apple.Passwords', running: false }, false, 'det praecise id paa et adgangskodeprogram'],
  ['dk.findes.ikke', { ok: false, code: 'not-found', error: 'could not find' }, false, 'et opslag der fejler'],
  // R20 (Opus, MAALT): ogsaa noeglering og terminal slap udenom med en anden stavemaade
  ['com.apple.KeychainAccess', { app: 'com.apple.KeychainAccess', bundleId: 'com.apple.keychainaccess', running: false }, false, 'noeglering med andre store/smaa'],
  ['com.apple.terminal', { app: 'com.apple.terminal', bundleId: 'com.apple.Terminal', running: false }, false, 'terminal med andre store/smaa'],
  ['../Passwords', { app: 'Passwords', bundleId: 'com.apple.Passwords', running: false }, false, 'et ugyldigt id (formkravet foer opslaget)'],
  ['com.spotify.client', { app: 'com.spotify.client', bundleId: 'com.spotify.client', running: false }, true, 'et praecist id paa et lukket program'],
]) {
  const hj = lavFalskHjaelper('cmcp-openapp');
  hj.saetSvar({ apps: { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true }] }, 'resolve-app': svar });
  const env = { ...process.env, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti, CMCP_STATUS_IKON: '0',
                CMCP_STATE_DIR: mkdtempSync(join(tmpdir(), 'cmcp-openapp-')) };
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
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'openapp', version: '1' } });
  const r = await rpc('tools/call', { name: 'computer_open', arguments: { intent: 'open_app', bundleId } });
  const tekst = (r.result?.content || []).map(c => c.text || '').join('\n');
  const start = hj.kald().filter(k => k.argv[0] === 'launch');
  const appArgv = (k) => { const i = k.argv.indexOf('--app'); return i >= 0 ? k.argv[i + 1] : undefined; };
  check(`open_app med ${hvad} («${bundleId}»): ${maaStarte ? 'startes' : 'afvist, intet startet'}`,
    maaStarte ? (start.length === 1 && appArgv(start[0]) === bundleId) : (!!r.result?.isError && start.length === 0),
    JSON.stringify(start.map(k => k.argv)) + ' · ' + tekst.slice(0, 120));
  if (bundleId === '../Passwords') {
    const opslag = hj.kald().filter(k => k.argv[0] === 'resolve-app');
    check('et ugyldigt id afvises af formkravet FOER noget slaas op', /valid bundle id/.test(tekst) && opslag.length === 0, `${opslag.length} opslag · ${tekst.slice(0, 80)}`);
  }
  srv.kill();
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
