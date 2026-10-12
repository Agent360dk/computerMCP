// Et menupunkt der LUKKER noget, spoerger - uanset hvad det hedder paa skaermens sprog.
//
// ⛔ HVORFOR DEN FINDES (1/10-2026, konsulent-panelet, maalt paa Gustavs Mac)
//    Prøvens oprydning valgte «Skak > Slut Skak». Porten kendte «afslut» og «quit»,
//    ikke «slut», saa ingen blev spurgt - og et ugemt parti blev lukket. Ord baerer
//    ikke paa tvaers af sprog. Genvejen gor: Cmd+Q staar i programmets egen menu.
//
// Intet startes, intet tager skaermen: serveren koerer mod en attrap-hjaelper der
// kun skriver sit argv ned, og samtykket gaar til en attrap der ikke svarer.
import './ryd-op.mjs';
import './egen-tilstand.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const D = mkdtempSync(join(tmpdir(), 'cmcp-menugenvej-'));
const ARGV = join(D, 'argv.txt'), MENUS = join(D, 'menus.json'), STUB = join(D, 'stub.sh');
writeFileSync(STUB, `#!/bin/sh
printf '%s ' "$@" >> ${ARGV}; echo >> ${ARGV}
case "$1" in
  apps) echo '{"ok":true,"apps":[{"bundleId":"com.apple.Chess","name":"Skak","pid":4242,"active":false}]}' ;;
  resolve-app) echo '{"ok":true,"bundleId":"com.apple.Chess","running":true}' ;;
  menus) cat ${MENUS} ;;
  menu-click) echo '{"ok":true,"result":"pressed"}' ;;
  *) echo '{"ok":true}' ;;
esac
`);
chmodSync(STUB, 0o755);
const menu = (items) => writeFileSync(MENUS, JSON.stringify({ ok: true, items }));

const spoerger = lavFalskSpoerger('udloeb', 'cmcp-menugenvej');
const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
  env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
         CMCP_STATE_DIR: join(D, 'state'), CMCP_BACKGROUND: '0', CMCP_MODE: 'allow',
         CMCP_ASK_TIMEOUT: '2', CMCP_OSASCRIPT: spoerger.sti },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
const kald = async (navn, args) => (await rpc('tools/call', { name: navn, arguments: args })).result?.content?.[0]?.text || '';
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'menugenvej', version: '1' } });
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const klikket = (sti) => (existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '').split('\n')
  .some(l => l.startsWith('menu-click ') && l.includes(`--path ${sti} `));

// 1. Det ord der slap igennem paa Gustavs Mac.
menu([{ path: 'Skak > Slut Skak', shortcut: 'cmd+q', enabled: true }]);
await kald('computer_menu', { app: 'com.apple.Chess', path: 'Skak > Slut Skak' });
check('1 «Skak > Slut Skak» trykkes IKKE uden et ja', !klikket('Skak > Slut Skak'));

// 2. Et harmloest navn med en lukke-genvej: genvejen afgoer det, ikke ordet.
menu([{ path: 'Skak > Faerdig', shortcut: 'cmd+q', enabled: true }]);
await kald('computer_menu', { app: 'com.apple.Chess', path: 'Skak > Faerdig' });
check('2 et punkt med Cmd+Q spoerger, uanset navnet', !klikket('Skak > Faerdig'));

// 3. Kan punktet ikke slaas op, spoerges der (lukket, ikke aabent).
menu([]);
await kald('computer_menu', { app: 'com.apple.Chess', path: 'Skak > Ukendt' });
check('3 et punkt der ikke kan slaas op, trykkes IKKE uden et ja', !klikket('Skak > Ukendt'));

// 4. Et harmloest punkt med en harmloes genvej gaar fri - ellers spoerger alt.
menu([{ path: 'Arkiv > Nyt spil', shortcut: 'cmd+n', enabled: true }]);
await kald('computer_menu', { app: 'com.apple.Chess', path: 'Arkiv > Nyt spil' });
check('4 «Arkiv > Nyt spil» (Cmd+N) trykkes uden at spoerge', klikket('Arkiv > Nyt spil'));

// 5. Kalibrering: 1-3 blev stoppet af et menneske-spoergsmaal, ikke af noget andet.
check('5 kalibrering: porten spurgte et menneske om 1, 2 og 3', spoerger.gangeSpurgt() === 3,
      `spurgt ${spoerger.gangeSpurgt()} gange`);

srv.kill();
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
