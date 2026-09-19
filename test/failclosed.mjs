// Bevis: svarer ingen paa dialogen, er svaret NEJ.
//
// Det er den eneste egenskab hvor en fejl er stille og alvorlig. En dialog
// der ender med "ja" fordi ingen saa den, ligner samtykke i loggen og er det
// ikke. Proeven saetter tidsgraensen til 2 sekunder, lader dialogen loebe ud,
// og kraever et afslag.
//
// MUTATIONSBEVIS 19/9 - koert, ikke husket: begge steder i policy.js hvor
// `gave up:true` bliver til `resolve(false)`, vendt til `resolve(true)`.
//   -> DUMPET 2 af 3 tjek. Og den muterede udgave KLIKKEDE faktisk
//      ("Klikkede i 5, 5"). Porten er det eneste der staar mellem
//      "ingen svarede" og "agenten handlede".
//
// ⛔ Foerste forsoeg var et NO-OP: jeg skrev `assert count == 1`, men strengen
//    findes TO steder (askHuman og askHumanToDo). Assertionen fejlede, filen
//    blev aldrig muteret, og proeven var groen mod ren kode. Det lignede et
//    bevis. Fanget fordi jeg sammenlignede md5 foer og efter i stedet for at
//    antage at gendannelsen var noedvendig.
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Samme som claims.mjs: dialogen vises kun med CMCP_DIALOGS=1, og release.sh
// naegter at udgive uden. Se noten der.
if (process.env.CMCP_DIALOGS !== '1') {
  console.log('SPR. udloebet dialog = afslag - dialoger er opt-in, koer med CMCP_DIALOGS=1 (bevist intet)');
  process.exit(0);
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, CMCP_MODE: 'ask', CMCP_ASK_TIMEOUT: '2' };
const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; const pending = new Map();
srv.stdout.on('data', d => { buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!l.trim()) continue; try { const m = JSON.parse(l);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} } });
let id = 0;
const rpc = (method, params = {}) => new Promise((res, rej) => {
  const my = ++id; pending.set(my, res);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
  setTimeout(() => { if (pending.has(my)) { pending.delete(my); rej(new Error('timeout ' + method)); } }, 90000);
});

const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const list = await rpc('tools/list');
  const names = (list.result?.tools || []).map(t => t.name);
  check('ask-tilstand viser haenderne', names.includes('computer_click'), `${names.length} vaerktoejer`);

  console.log('  (en dialog vises i 2 sekunder og lukker sig selv - det er meningen)');
  const t0 = Date.now();
  const r = await rpc('tools/call', { name: 'computer_click', arguments: { x: 5, y: 5 } });
  const txt = r.result?.content?.[0]?.text || '';
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  check('udloebet dialog = afslag', r.result?.isError === true, `${secs}s: ${txt.split('\n')[0]}`);
  check('afslaget siger hvorfor', /svarede ikke|sagde nej/.test(txt), txt.split('\n')[0]);
} catch (e) { console.log('DUMP:', e.message); fails.push(e.message); }
finally { srv.kill(); }
console.log(fails.length ? `\nDUMPET: ${fails.length}` : '\nBESTAAET');
process.exit(fails.length ? 1 : 0);
