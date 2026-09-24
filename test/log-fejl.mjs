// En skrivende handling der ikke kan skrives ned, sker ikke.
//
// ⛔ HVORFOR DEN FINDES (24/9-2026) - sikkerhedsgennemgangen.
//    audit.js skrev «actions still run, but they are not recorded» og koerte
//    videre. En fuld disk eller en laast mappe gav et spor med huller, og
//    produktet opfoerte sig som om intet var sket. Loeftet er et HELT spor.
//
// Intet sendes til Mac'en: serveren koerer mod en attrap-hjaelper der kun
// skriver sit argv ned, og logfilen laases med chmod.
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const D = mkdtempSync(join(tmpdir(), 'cmcp-logfejl-'));
const STATE = join(D, 'state'); mkdirSync(STATE, { mode: 0o700 });
const ARGV = join(D, 'argv.txt');
const STUB = join(D, 'stub.sh');
writeFileSync(STUB, `#!/bin/sh
printf '%s ' "$@" >> ${ARGV}; echo >> ${ARGV}
case "$1" in
  apps) echo '{"ok":true,"apps":[{"name":"Lommeregner","bundleId":"com.apple.calculator"}]}' ;;
  *) echo '{"ok":true}' ;;
esac
`);
chmodSync(STUB, 0o755);

const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
  env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
         CMCP_STATE_DIR: STATE, CMCP_BACKGROUND: '0', CMCP_MODE: 'allow',
         CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-logfejl').sti },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
const kald = async (navn, args) => (await rpc('tools/call', { name: navn, arguments: args })).result?.content?.[0]?.text || '';
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'logfejl', version: '1' } });
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const skrivninger = () => (existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '')
  .split('\n').filter(l => l.startsWith('type ')).length;
const skriv = (t) => kald('computer_type', { app: 'Lommeregner', text: t });

await skriv('a');
check('1 kalibrering: med en skrivbar log naar handlingen hjaelperen', skrivninger() === 1, `${skrivninger()} skrivninger`);

// ⛔ En laast MAPPE stopper ikke en tilfoejelse til en fil der findes - maalt.
const LOG = join(STATE, 'audit.jsonl');
chmodSync(LOG, 0o400);
const r2 = await skriv('b');
check('2 kan loggen ikke skrives, udfoeres den skrivende handling IKKE', skrivninger() === 1, `${skrivninger()} skrivninger`);
check('2b ...og modellen faar at vide hvorfor', /audit log .* cannot be written/.test(r2), r2.slice(0, 90));
const r3 = await kald('computer_apps', {});
check('3 laesning koerer videre - den aendrer intet', /Lommeregner/.test(r3), r3.slice(0, 60));

chmodSync(LOG, 0o600);
await skriv('c');
check('4 kan loggen skrives igen, virker skrivning igen', skrivninger() === 2, `${skrivninger()} skrivninger`);

srv.kill();
rmSync(D, { recursive: true, force: true });
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
