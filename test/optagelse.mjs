// Skaermoptagelse (25/9): start spoerger HVER gang, stop og status spoerger aldrig,
// readonly optager aldrig, og filen naevnes kun ved sti.
//
// Intet optages her: serveren koerer mod en attrap-hjaelper der skriver en lille fil
// og venter paa SIGINT, og samtykket gaar til attrap-spoergere. Den AEGTE optagelse
// kan kun maales paa en maskine ingen arbejder paa (CMCP_FREMMED_MASKINE=1).
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const D = mkdtempSync(join(tmpdir(), 'cmcp-optag-'));
const ARGV = join(D, 'argv.txt'), MAPPE = join(D, 'film');
const STUB = join(D, 'stub.sh');
writeFileSync(STUB, `#!/bin/sh
printf '%s ' "$@" >> ${ARGV}; echo >> ${ARGV}
case "$1" in
  record)
    OUT=""; prev=""; for a in "$@"; do [ "$prev" = "--out" ] && OUT="$a"; prev="$a"; done
    echo '{"ok":true,"recording":true,"path":"'"$OUT"'","excluded_apps":["com.1password.1password"],"max_seconds":5}'
    if [ -n "$STUB_SELVSTOP" ]; then sleep 0.3; printf x > "$OUT"; echo "{\\"ok\\":true,\\"recording\\":false,\\"path\\":\\"$OUT\\",\\"seconds\\":5,\\"bytes\\":1,\\"stopped_by\\":\\"time-limit\\"}"; exit 0; fi
    if [ -n "$STUB_KRAK" ]; then sleep 0.3; exit 3; fi
    trap 'printf x > "$OUT"; echo "{\\"ok\\":true,\\"recording\\":false,\\"path\\":\\"$OUT\\",\\"seconds\\":1,\\"bytes\\":1,\\"stopped_by\\":\\"requested\\"}"; exit 0' INT TERM
    while true; do sleep 0.1; done ;;
  apps) echo '{"ok":true,"apps":[{"name":"Finder","bundleId":"com.apple.finder","active":true}]}' ;;
  *) echo '{"ok":true}' ;;
esac
`);
chmodSync(STUB, 0o755);
const spoerger = (svar) => {
  const s = join(D, `spoerger-${svar}.sh`), spor = join(D, `spurgt-${svar}.txt`);
  writeFileSync(s, `#!/bin/sh\necho x >> ${spor}\necho '${svar === 'ja' ? 'button returned:Yes, gave up:false' : 'button returned:, gave up:true'}'\n`);
  chmodSync(s, 0o755);
  return { sti: s, spurgt: () => existsSync(spor) ? readFileSync(spor, 'utf8').trim().split('\n').length : 0 };
};
const optaget = () => (existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '').split('\n').filter(l => l.startsWith('record ')).length;

function server(mode, svar, navn, ekstra = {}) {
  const sp = spoerger(svar);
  const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
    env: { ...process.env, ...ekstra, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
           CMCP_STATE_DIR: join(D, 'state-' + navn), CMCP_BACKGROUND: '0', CMCP_MODE: mode,
           CMCP_OSASCRIPT: sp.sti, CMCP_RECORD_DIR: MAPPE },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', n = 0; const w = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  const kald = async (args) => (await rpc('tools/call', { name: 'computer_record', arguments: args })).result?.content?.[0]?.text || '';
  const klar = rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'optag-' + navn, version: '1' } })
    .then(() => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'));
  return { srv, kald, klar, sp, log: () => { const f = join(D, 'state-' + navn, 'audit.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []; } };
}

// 1. readonly: start afvises (ingen optagelse), status virker.
{
  const s = server('readonly', 'ja', 'ro'); await s.klar;
  const r = await s.kald({ action: 'start' });
  const st = await s.kald({ action: 'status' });
  s.srv.kill();
  check('1 readonly: start afvises og intet optages', /CMCP_MODE=readonly/.test(r) && optaget() === 0, r.slice(0, 80));
  check('1b readonly: status kan stadig spoerges', /"recording": false/.test(st), st.slice(0, 60));
}

// 2. allow + ingen svar: start SPOERGER (ogsaa i allow) og optager ikke.
{
  const s = server('allow', 'nej', 'nej'); await s.klar;
  const r = await s.kald({ action: 'start', maxSeconds: 5 });
  s.srv.kill();
  check('2 start spoerger hver gang, ogsaa i allow - og optager ikke uden ja', s.sp.spurgt() === 1 && optaget() === 0, r.slice(0, 70));
}

// 2b. Baggrundstilstand (standard): spoergsmaalet skal kunne gaa til menulinjen.
//     Foer 25/9 var maalet «ukendt», og et ukendt maal kan aldrig godkendes derfra.
{
  const sp = spoerger('ja');
  const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
    env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
           CMCP_STATE_DIR: join(D, 'state-bg'), CMCP_BACKGROUND: '1', CMCP_MODE: 'allow',
           CMCP_OSASCRIPT: sp.sti, CMCP_RECORD_DIR: MAPPE },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', n = 0; const w = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'optag-bg', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const r = (await rpc('tools/call', { name: 'computer_record', arguments: { action: 'start', maxSeconds: 5 } })).result?.content?.[0]?.text || '';
  srv.kill();
  check('2b baggrund: start venter paa et ja i menulinjen - og er IKKE et ukendt maal der aldrig kan godkendes',
        !/cannot be approved from the menu bar/.test(r) && !/unknown/.test(r) && optaget() === 0, r.slice(0, 110));
}

// 3. allow + ja: start -> status -> dobbelt start afvist -> stop -> fil + spor.
{
  const s = server('allow', 'ja', 'ja'); await s.klar;
  const r1 = await s.kald({ action: 'start', maxSeconds: 5 });
  const st = await s.kald({ action: 'status' });
  const r2 = await s.kald({ action: 'start', maxSeconds: 5 });
  const r3 = await s.kald({ action: 'stop' });
  const r4 = await s.kald({ action: 'stop' });
  s.srv.kill();
  const filer = existsSync(MAPPE) ? readdirSync(MAPPE) : [];
  check('3a ja -> optagelsen starter, i den valgte mappe', /"recording": true/.test(r1) && r1.includes(MAPPE) && optaget() === 1, r1.slice(0, 90));
  check('3b status siger at den optager', /"recording": true/.test(st), st.slice(0, 60));
  check('3c en optagelse ad gangen: anden start afvises - uden at spoerge mennesket', /already running/.test(r2) && optaget() === 1 && s.sp.spurgt() === 1, r2.slice(0, 80));
  check('3d stop spoerger IKKE og giver filen', /"recording": false/.test(r3) && /stopped_by": "requested/.test(r3) && s.sp.spurgt() === 1, r3.slice(0, 90));
  check('3e filen findes, og svaret naevner kun stien', filer.length === 1 && filer[0].endsWith('.mov') && !/[A-Za-z0-9+/]{200,}/.test(r3), filer.join(','));
  check('3f stop uden optagelse er en fejl, ikke et tavst ok', /nothing is being recorded/.test(r4), r4.slice(0, 60));
  const linjer = s.log().filter(d => d.tool === 'computer_record');
  const start = linjer.filter(d => d.decision === 'allowed' && d.asked === true);
  check('3g sporet: start er godkendt af et menneske, og hvert kald har sit eget id',
        start.length === 1 && linjer.every(d => typeof d.call === 'string') && new Set(linjer.map(d => d.call)).size >= 4,
        `${linjer.length} linjer, ${new Set(linjer.map(d => d.call)).size} kald`);
  // Fable 25/9: stop-linjen bar hverken fil, varighed eller aarsag, og start/stop/status
  // kunne kun skelnes paa laengden af et fingeraftryk.
  const stoppet = linjer.filter(d => d.recording === 'stopped');
  check('3h sporet: slutningen staar med fil, aarsag og stoerrelse',
        stoppet.length === 1 && stoppet[0].file?.startsWith(MAPPE) && stoppet[0].stopped_by === 'requested' && stoppet[0].bytes === 1,
        JSON.stringify(stoppet[0] || null).slice(0, 140));
  const handlinger = linjer.filter(d => d.args?.action).map(d => d.args.action);
  check('3i sporet: start, status og stop staar i klartekst, ikke som fingeraftryk',
        ['start', 'status', 'stop'].every(a => handlinger.includes(a)), handlinger.join(','));
}

// 6. Optagelsen stopper AF SIG SELV (loft). Foer 25/9 skrev det nul linjer i loggen,
//    og en ny start kasserede det gamle resultat tavst.
{
  const s = server('allow', 'ja', 'selv', { STUB_SELVSTOP: '1' }); await s.klar;
  const r1 = await s.kald({ action: 'start', maxSeconds: 5 });
  await new Promise(r => setTimeout(r, 900));
  const st = await s.kald({ action: 'status' });
  s.srv.kill();
  const stoppet = s.log().filter(d => d.tool === 'computer_record' && d.recording === 'stopped');
  check('6a en optagelse der stopper af sig selv, staar i loggen med aarsag og fil',
        /"recording": true/.test(r1) && /"recording": false/.test(st) && stoppet.length === 1
          && stoppet[0].stopped_by === 'time-limit' && stoppet[0].file?.startsWith(MAPPE),
        JSON.stringify(stoppet[0] || null).slice(0, 140));
}

// 7. Hjaelperen doer midt i optagelsen uden et ord. Loggen skal sige det, og stop
//    maa ikke paastaa at den ventede 40 sekunder.
{
  const s = server('allow', 'ja', 'krak', { STUB_KRAK: '1' }); await s.klar;
  await s.kald({ action: 'start', maxSeconds: 5 });
  await new Promise(r => setTimeout(r, 900));
  const t0 = Date.now();
  const r = await s.kald({ action: 'stop' });
  const ms = Date.now() - t0;
  s.srv.kill();
  const stoppet = s.log().filter(d => d.tool === 'computer_record' && d.recording === 'stopped');
  check('7a en hjaelper der doer uden svar, staar i loggen som en fejl',
        stoppet.length === 1 && stoppet[0].outcome === 'error', JSON.stringify(stoppet[0] || null).slice(0, 140));
  check('7b ...og stop siger det som det er, straks', /ended without/.test(r) && !/40 seconds/.test(r) && ms < 5000, `${ms} ms: ${r.slice(0, 80)}`);
}

// 4. Skemaet: forkerte typer og ukendte handlinger afvises foer noget sker.
{
  const s = server('allow', 'ja', 'skema'); await s.klar;
  const foer = optaget();
  const a = await s.kald({ action: 'record-everything' });
  const b = await s.kald({ action: 'start', maxSeconds: '600' });
  s.srv.kill();
  check('4 ukendt handling og forkert type afvises af skemaet', /must be one of/.test(a) && /must be integer/.test(b) && optaget() === foer, `${a.slice(0, 50)} | ${b.slice(0, 50)}`);
}

// 5. Den AEGTE hjaelper i plan-tilstand: optager intet, skriver ingen fil.
{
  const H = join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
  const ud = join(D, 'MAA-ALDRIG-FINDES.mov');
  const r = spawnSync(H, ['record', '--plan', '--out', ud, '--seconds', '5'], { encoding: 'utf8' });
  let j = {}; try { j = JSON.parse(r.stdout.trim()); } catch {}
  check('5a den aegte hjaelper: plan-tilstand optager intet og skriver ingen fil', j.plan === true && j.recording === false && Array.isArray(j.excluded_apps) && !existsSync(ud), r.stdout.trim().slice(0, 100));
  const f = spawnSync(H, ['record', '--out', ud, '--seconds', '5', '--no-redact'], { encoding: 'utf8' });
  check('5b ...og et ukendt flag afvises i stedet for at blive ignoreret', f.status !== 0 && /unknown flag/.test(f.stdout) && !existsSync(ud), f.stdout.trim().slice(0, 80));
}

console.log('SPR. en aegte optagelse (fil, varighed, udeladte programmer) - kraever CMCP_FREMMED_MASKINE=1 paa en maskine ingen arbejder paa');
console.log('SPRUNGET OVER: 1 (bevist intet - ikke bestaaet)');
rmSync(D, { recursive: true, force: true });
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
