// `computer_launch` skal kunne starte et LUKKET program - og porten skal
// vurdere det program der faktisk startes.
//
// ⛔ HVORFOR DEN FINDES (24/9-2026) - Fable, e2e-gennemgangen.
//    Serveren slog `app` op blandt KOERENDE programmer. Et lukket program
//    fandtes ikke dér, saa porten saa «ukendt maal» og afviste - i baggrunds-
//    tilstanden uden at kunne godkendes fra menulinjen. Vaerktoejet hvis eneste
//    formaal er at starte noget lukket, kunne ikke starte noget lukket.
//    Rettelsen maa ikke aabne den anden vej: et adgangskode-program skal
//    stadig spoerge, og en hjaelper der ikke kan svare, skal stadig give nej.
//
// Intet startes, intet tager skaermen: serveren koerer mod en attrap-hjaelper
// der kun skriver sit argv ned, og samtykket gaar til en attrap der ikke svarer.
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const D = mkdtempSync(join(tmpdir(), 'cmcp-launch-'));
const ARGV = join(D, 'argv.txt');
const STUB = join(D, 'stub.sh');
// Ingen programmer koerer. `resolve-app` kender to lukkede programmer; «Gammel»
// spiller en aeldre hjaelper der ikke kender kommandoen.
writeFileSync(STUB, `#!/bin/sh
printf '%s ' "$@" >> ${ARGV}; echo >> ${ARGV}
APP=""; prev=""; for a in "$@"; do [ "$prev" = "--app" ] && APP="$a"; prev="$a"; done
case "$1" in
  apps) echo '{"ok":true,"apps":[]}' ;;
  resolve-app)
    case "$APP" in
      Lommeregner) echo '{"ok":true,"bundleId":"com.apple.calculator","running":false}' ;;
      Passwords)   echo '{"ok":true,"bundleId":"com.apple.Passwords","running":false}' ;;
      *) echo '{"ok":false,"code":"bad-args","error":"unknown command resolve-app"}'; exit 1 ;;
    esac ;;
  launch) echo '{"ok":true,"result":"launched in the background"}' ;;
  *) echo '{"ok":true}' ;;
esac
`);
chmodSync(STUB, 0o755);

const spoerger = lavFalskSpoerger('udloeb', 'cmcp-launch');
const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
  env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
         CMCP_STATE_DIR: join(D, 'state'), CMCP_BACKGROUND: '0', CMCP_MODE: 'allow',
         CMCP_ASK_TIMEOUT: '2', CMCP_OSASCRIPT: spoerger.sti },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
const kald = async (navn, args) => (await rpc('tools/call', { name: navn, arguments: args })).result?.content?.[0]?.text || '';
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'launch', version: '1' } });
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const startet = (app) => (existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '')
  .split('\n').some(l => l.startsWith('launch ') && l.includes(`--app ${app} `));

const r1 = await kald('computer_launch', { app: 'Lommeregner', background: true });
check('1 et lukket, almindeligt program startes i standardtilstanden', startet('Lommeregner'), r1.slice(0, 90));

const r2 = await kald('computer_launch', { app: 'Passwords', background: true });
check('2 et lukket adgangskode-program startes IKKE uden et ja', !startet('Passwords'), r2.slice(0, 90));

const r3 = await kald('computer_launch', { app: 'Gammel', background: true });
check('3 kan hjaelperen ikke slaa programmet op, startes intet (lukket, ikke aabent)', !startet('Gammel'), r3.slice(0, 90));

// Kalibrering: porten SKAL have spurgt et menneske i 2 og 3 - ellers maaler
// de en afvisning af en anden grund end porten.
check('4 kalibrering: porten spurgte et menneske om 2 og 3', spoerger.gangeSpurgt() === 2,
      `spurgt ${spoerger.gangeSpurgt()} gange`);

srv.kill();
rmSync(D, { recursive: true, force: true });
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
