// Et koordinatklik vurderes paa det program der EJER punktet.
//
// ⛔ HVORFOR DEN FINDES (24/9-2026) - sikkerhedsgennemgangen.
//    Porten vurderede et klik uden `app` paa det FORRESTE program. Klikket
//    lander i det vindue der ligger under punktet - fx et 1Password-vindue bag
//    Chrome - og det gik igennem uden at spoerge i standardtilstanden.
//
// Intet klikkes: serveren koerer mod en attrap-hjaelper der kun skriver sit
// argv ned, og samtykket gaar til en attrap der ikke svarer.
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const D = mkdtempSync(join(tmpdir(), 'cmcp-klikejer-'));
const ARGV = join(D, 'argv.txt');
const STUB = join(D, 'stub.sh');
// Chrome er forrest. Punkt x=100 ejes af Chrome, x=200 af Apple Passwords
// (et vindue bag Chrome), x=300 kan ingen sige hvem ejer.
writeFileSync(STUB, `#!/bin/sh
printf '%s ' "$@" >> ${ARGV}; echo >> ${ARGV}
X=""; prev=""; for a in "$@"; do [ "$prev" = "--x" ] && X="$a"; prev="$a"; done
case "$1" in
  apps) echo '{"ok":true,"apps":[{"name":"Google Chrome","bundleId":"com.google.Chrome","active":true}]}' ;;
  at)
    case "$X" in
      100) echo '{"ok":true,"found":true,"bundleId":"com.google.Chrome"}' ;;
      200) echo '{"ok":true,"found":true,"bundleId":"com.apple.Passwords"}' ;;
      *)   echo '{"ok":true,"found":false}' ;;
    esac ;;
  *) echo '{"ok":true}' ;;
esac
`);
chmodSync(STUB, 0o755);

const spoerger = lavFalskSpoerger('udloeb', 'cmcp-klikejer');
const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
  env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
         CMCP_STATE_DIR: join(D, 'state'), CMCP_BACKGROUND: '0', CMCP_MODE: 'allow',
         CMCP_ASK_TIMEOUT: '2', CMCP_OSASCRIPT: spoerger.sti },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
const kald = async (navn, args) => (await rpc('tools/call', { name: navn, arguments: args })).result?.content?.[0]?.text || '';
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'klikejer', version: '1' } });
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const klikket = (x) => (existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '')
  .split('\n').some(l => l.startsWith('click ') && l.includes(`--x ${x} `));

await kald('computer_click', { x: 100, y: 50 });
check('1 kalibrering: et klik i det forreste, almindelige program gaar igennem uden at spoerge',
      klikket(100) && spoerger.gangeSpurgt() === 0, `spurgt ${spoerger.gangeSpurgt()}`);

const r2 = await kald('computer_click', { x: 200, y: 50 });
check('2 et klik der LANDER i et adgangskode-program bag det forreste, klikkes IKKE uden et ja',
      !klikket(200), r2.slice(0, 80));
check('2b ...og porten spurgte et menneske', spoerger.gangeSpurgt() === 1, `spurgt ${spoerger.gangeSpurgt()}`);

const r3 = await kald('computer_click', { x: 300, y: 50 });
check('3 kan ingen sige hvem der ejer punktet, klikkes der ikke uden et ja', !klikket(300), r3.slice(0, 80));

const r4 = await kald('computer_drag', { fromX: 100, fromY: 50, toX: 200, toY: 50 });
check('4 et traek der ender i et adgangskode-program, udfoeres ikke uden et ja',
      !(existsSync(ARGV) && readFileSync(ARGV, 'utf8').includes('drag ')), r4.slice(0, 80));

srv.kill();
rmSync(D, { recursive: true, force: true });
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
