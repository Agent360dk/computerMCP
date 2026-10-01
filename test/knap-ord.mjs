// En KNAP der sletter, rydder eller lukker, spoerger - som et menupunkt med samme ord.
//
// ⛔ HVORFOR DEN FINDES (1/10-2026, konsulent-panelet om skaerm-koeen)
//    README lover «Anything that deletes or clears asks every time, recognised from the
//    words in the action itself». Ordene blev kun laest paa menuer og genveje: et tryk
//    paa en knap der hed «Slet», eller et klik paa «Erase», spurgte aldrig.
// Intet startes, intet tager skaermen: attrap-hjaelper og attrap-samtykke.
import './ryd-op.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const D = mkdtempSync(join(tmpdir(), 'cmcp-knapord-'));
const ARGV = join(D, 'argv.txt'), KNAP = join(D, 'knap.json'), AT = join(D, 'at.json'), STUB = join(D, 'stub.sh');
writeFileSync(STUB, `#!/bin/sh
printf '%s ' "$@" >> ${ARGV}; echo >> ${ARGV}
case "$1" in
  apps) echo '{"ok":true,"apps":[{"bundleId":"com.apple.TextEdit","name":"TextEdit","pid":4242,"active":false}]}' ;;
  resolve-app) echo '{"ok":true,"bundleId":"com.apple.TextEdit","running":true}' ;;
  press) case " $* " in *" --dry "*) cat ${KNAP} ;; *) echo '{"ok":true,"pressed":{}}' ;; esac ;;
  at) cat ${AT} ;;
  *) echo '{"ok":true}' ;;
esac
`);
chmodSync(STUB, 0o755);
const knap = (navn) => writeFileSync(KNAP, JSON.stringify({ ok: true, would_press: { name: navn, role: 'AXButton' } }));
const ved = (titel) => writeFileSync(AT, JSON.stringify({ ok: true, found: true, bundleId: 'com.apple.TextEdit', role: 'AXButton', title: titel }));

const spoerger = lavFalskSpoerger('udloeb', 'cmcp-knapord');
const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
  env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
         CMCP_STATE_DIR: join(D, 'state'), CMCP_BACKGROUND: '0', CMCP_MODE: 'allow',
         CMCP_ASK_TIMEOUT: '2', CMCP_OSASCRIPT: spoerger.sti },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
const kald = async (navn, args) => (await rpc('tools/call', { name: navn, arguments: args })).result?.content?.[0]?.text || '';
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'knapord', version: '1' } });
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const linjer = () => (existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '').split('\n');
const trykket = () => linjer().filter(l => l.startsWith('press ') && !l.includes('--dry')).length;
const klikket = () => linjer().filter(l => l.startsWith('click ')).length;

knap('Slet'); let f = trykket();
await kald('computer_press', { app: 'com.apple.TextEdit', title: 'Slet' });
check('1 en knap der hedder «Slet», trykkes IKKE uden et ja', trykket() === f);

knap('Erase'); f = trykket();
await kald('computer_press', { app: 'com.apple.TextEdit', contains: 'ras' });
check('2 knappens EGET navn afgør det, ikke det agenten søgte på («ras» -> «Erase»)', trykket() === f);

knap('Gem'); f = trykket();
await kald('computer_press', { app: 'com.apple.TextEdit', title: 'Gem' });
check('3 en harmløs knap («Gem») trykkes uden at spørge', trykket() === f + 1);

ved('Delete'); f = klikket();
await kald('computer_click', { app: 'com.apple.TextEdit', x: 100, y: 200 });
check('4 et klik der rammer «Delete», sker IKKE uden et ja', klikket() === f);

check('5 kalibrering: porten spurgte et menneske om 1, 2 og 4', spoerger.gangeSpurgt() === 3, `spurgt ${spoerger.gangeSpurgt()} gange`);
srv.kill();
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
