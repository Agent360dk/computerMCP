// En VAERDI fra modellen maa aldrig kunne blive til et FLAG.
//
// ⛔ HVORFOR DEN FINDES (24/9-2026) - sikkerhedsgennemgang, fund B1, kritisk.
//    Serveren tjekkede intet mod vaerktoejets eget skema og sendte `maxWidth`
//    videre som tekst. `{maxWidth: "--no-redact"}` gav argv
//    `screenshot --out … --max-width --no-redact`, og hjaelperens parser laeste
//    `--no-redact` som et nyt flag. MAALT mod en attrap-hjaelper der kun skrev sit
//    argv ned: praecis den linje. Resultatet ville vaere et USLOERET skaermbillede,
//    og fordi `redact` aldrig blev sat til false, spurgte porten ingen.
//    To uafhaengige lag, og proeven her proever begge:
//      1. serveren holder hvert kald op mod skemaet (ingen navneliste)
//      2. hjaelperen afviser en noegle der skulle have en vaerdi men fik et flag
//    Intet her tager et billede: lag 1 proeves mod en attrap-hjaelper, lag 2 med
//    `--plan`, der stopper foer optagelsen.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const D = mkdtempSync(join(tmpdir(), 'cmcp-arg-'));
const ARGV = join(D, 'argv.txt');
const STUB = join(D, 'stub.sh');
writeFileSync(STUB, `#!/bin/sh\nprintf '%s\\n' "$@" >> ${ARGV}\necho '{"ok":true,"path":"/dev/null","width":1,"height":1}'\n`);
chmodSync(STUB, 0o755);

// ---- Lag 1: serveren, mod en attrap-hjaelper der kun skriver argv ned
const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
  env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
         CMCP_STATE_DIR: join(D, 'state'), CMCP_BACKGROUND: '0',
         // Husets vagt 26: ingen proeve maa kunne rejse en aegte dialog.
         CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-arg').sti },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
const kald = async (navn, args) => (await rpc('tools/call', { name: navn, arguments: args })).result?.content?.[0]?.text || '';
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'arg', version: '1' } });
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const sendt = () => existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '';
const a1 = await kald('computer_screenshot', { maxWidth: '--no-redact' });
check('1a en tekst hvor skemaet siger tal, afvises', /Refused: `maxWidth` must be number/.test(a1), a1.slice(0, 80));
check('1b ...og intet blev sendt til hjaelperen', !/no-redact/.test(sendt()), JSON.stringify(sendt().slice(0, 80)));
const a2 = await kald('computer_click', { x: '100', y: 100 });
check('1c et koordinat som tekst afvises (det slap forbi ikon-vagten, der kun tjekkede tal)',
      /Refused: `x` must be number/.test(a2), a2.slice(0, 80));
// Kalibrering den anden vej: et GYLDIGT kald naar hjaelperen - ellers maaler 1b en server der aldrig sender noget.
await kald('computer_screenshot', { maxWidth: 300 });
check('1d kalibrering: et gyldigt kald NAAR hjaelperen', /max-width\n300/.test(sendt()), JSON.stringify(sendt().slice(-60)));
srv.kill();

// ---- Lag 2: hjaelperen selv, med --plan saa intet kan optages
const H = [join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper')].find(existsSync);
const ud = join(D, 'MAA-ALDRIG-FINDES.png');
const r = spawnSync(H, ['screenshot', '--plan', '--out', ud, '--max-width', '--no-redact'], { encoding: 'utf8' });
let j = {}; try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
check('2a hjaelperen afviser en noegle der fik et flag i stedet for en vaerdi', r.status !== 0 && j.code === 'bad-args', j.error?.slice(0, 70) || JSON.stringify(j));
check('2b ...og skrev intet', !existsSync(ud));

rmSync(D, { recursive: true, force: true });
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
