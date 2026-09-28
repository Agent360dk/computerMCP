// Døren (computer_open): åbn en app's egen indgang bagfra via et INTENT + én
// typet parameter - aldrig en fri URL fra modellen. Serveren bygger URL'en af
// en fast skabelon og validerer parameteren strengt.
//
// ⛔ HVORFOR DEN FINDES (28/9)
//    En dør der tog en fri URL/scheme ville være en generisk bagdør:
//    file:, shortcuts://run-shortcut → shell, osascript = Turing-komplet. Prøven
//    beviser: (1) der er INGEN url-parameter at injicere i, (2) hver parameter
//    valideres så kun cifre/bogstaver passerer, (3) serveren bygger præcis den
//    forventede app-URL. Helperen er mocket, så intet åbnes.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

// Mock-helper: ekko den modtagne --url / --app som JSON, aabn intet.
const DIR = mkdtempSync(join(tmpdir(), 'cmcp-doer-'));
const fakeHelper = join(DIR, 'fake-helper');
writeFileSync(fakeHelper, `#!/bin/bash
cmd="$1"; shift; url=""; app=""
while [ $# -gt 0 ]; do case "$1" in --url) url="$2"; shift 2;; --app) app="$2"; shift 2;; *) shift;; esac; done
if [ "$cmd" = "open-url" ]; then echo "{\\"ok\\":true,\\"echoed_url\\":\\"$url\\",\\"took_screen\\":false}"
elif [ "$cmd" = "launch" ]; then echo "{\\"ok\\":true,\\"result\\":\\"launched in the background\\",\\"echoed_app\\":\\"$app\\",\\"took_screen\\":false}"
else echo "{\\"ok\\":true}"; fi
`);
chmodSync(fakeHelper, 0o755);

const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')],
  { env: { ...process.env, CMCP_HELPER: fakeHelper, CMCP_MODE: 'allow', CMCP_STATUS_IKON: '0', CMCP_STATE_DIR: join(DIR, 'state') }, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
const kald = async (args) => { const r = await rpc('tools/call', { name: 'computer_open', arguments: args }); const t = r.result?.content?.[0]?.text ?? ''; let d = null; try { d = JSON.parse(t); } catch {} return { fejl: !!r.result?.isError, tekst: t, data: d }; };

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'doer', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const tools = (await rpc('tools/list')).result?.tools || [];
  const doer = tools.find(t => t.name === 'computer_open');
  check('1 doeren findes', !!doer);
  const props = Object.keys(doer?.inputSchema?.properties || {});
  check('1b der er INGEN url-parameter at injicere i', !props.includes('url'), props.join(','));
  check('1c parametrene er intent + typede felter', props.includes('intent') && props.includes('spotifyId') && props.includes('phone'));

  // Gyldige intents -> praecis den forventede app-URL (mock ekko).
  const t1 = await kald({ intent: 'play_track', spotifyId: '4cOdK2wGLETKBW3PvgPWqT' });
  check('2 play_track bygger spotify:track: med id\'et', !t1.fejl && t1.data?.echoed_url === 'spotify:track:4cOdK2wGLETKBW3PvgPWqT', t1.data?.echoed_url || t1.tekst.slice(0, 80));
  const t2 = await kald({ intent: 'open_chat', phone: '+45 60 17 45 69' });
  check('3 open_chat bygger whatsapp://send?phone= (tegnene renset, ingen text)', !t2.fejl && t2.data?.echoed_url === 'whatsapp://send?phone=4560174569', t2.data?.echoed_url || t2.tekst.slice(0, 80));

  // Ugyldige parametre -> AFVIST, intet aabnet.
  const b1 = await kald({ intent: 'play_track', spotifyId: 'file:///etc/passwd' });
  check('4 et forsoeg paa at smugle en sti ind i spotifyId afvises', b1.fejl && !b1.data?.echoed_url, b1.tekst.slice(0, 70));
  const b2 = await kald({ intent: 'open_chat', phone: '4560; do shell script' });
  check('5 et telefonnummer med skal-tekst afvises', b2.fejl, b2.tekst.slice(0, 70));
  const b3 = await kald({ intent: 'run_shortcut', spotifyId: 'x' });
  check('6 et ukendt intent afvises (ingen fri handling)', b3.fejl, b3.tekst.slice(0, 70));
  const b4 = await kald({ intent: 'open_app', bundleId: 'com.x; rm -rf /' });
  check('7 en bundle id med skal-tegn afvises', b4.fejl, b4.tekst.slice(0, 70));

  // En medsendt fri url AFVISES helt: den er ikke et felt paa vaerktoejet, saa
  // der er ingen vej at injicere en scheme ad. (Staerkere end at ignorere den.)
  const t3 = await kald({ intent: 'play_track', spotifyId: '4cOdK2wGLETKBW3PvgPWqT', url: 'file:///etc/passwd' });
  check('8 en medsendt fri url AFVISES (intet felt at injicere i)', t3.fejl && !t3.data?.echoed_url, t3.tekst.slice(0, 70));
} finally {
  srv.kill();
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
