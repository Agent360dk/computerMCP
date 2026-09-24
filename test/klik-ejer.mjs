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
    # Markoeren staar over et Passwords-vindue.
    case " $* " in *" --pointer "*) echo '{"ok":true,"found":true,"bundleId":"com.apple.Passwords"}'; exit 0 ;; esac
    case "$X" in
      100) echo '{"ok":true,"found":true,"bundleId":"com.google.Chrome"}' ;;
      200) echo '{"ok":true,"found":true,"bundleId":"com.apple.Passwords"}' ;;
      400) # Foerste opslag: Chrome. Derefter: Passwords - et vindue kom frem imens.
           if [ -f ${join(D, 'skiftet')} ]; then echo '{"ok":true,"found":true,"bundleId":"com.apple.Passwords"}'
           else : > ${join(D, 'skiftet')}; echo '{"ok":true,"found":true,"bundleId":"com.google.Chrome"}'; fi ;;
      500) # Tilgaengeligheds-laget siger Chrome; vindues-stakken har 1Password under et gennemsigtigt lag.
           echo '{"ok":true,"found":true,"bundleId":"com.google.Chrome","under":["com.apple.dock","com.agilebits.onepassword7"]}' ;;
      600|700) # Foerste opslag: ingen ejer. Derefter: 600 -> Passwords, 700 -> Chrome.
           if [ -f ${join(D, 'set-')}$X ]; then
             [ "$X" = 600 ] && echo '{"ok":true,"found":true,"bundleId":"com.apple.Passwords"}' || echo '{"ok":true,"found":true,"bundleId":"com.google.Chrome"}'
           else : > ${join(D, 'set-')}$X; echo '{"ok":true,"found":false}'; fi ;;
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

// 5. ⛔ Sikkerhedsgennemgangen runde 2: `drag` bruger aldrig `app`, men porten
//    LAESTE feltet og vurderede Chrome, mens traekket landede i Passwords.
const r5 = await kald('computer_drag', { fromX: 200, fromY: 50, toX: 200, toY: 50, app: 'Google Chrome' });
check('5 et felt vaerktoejet ikke bruger, afvises - og intet traekkes',
      /is not a parameter of this tool/.test(r5) && (existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '').split('\n').filter(l => l.startsWith('drag ')).length === 0,
      r5.slice(0, 80));

// 6. ⛔ Begge konsulenter, runde 2: ejeren blev kun slaaet op FOER ventetiden.
//    Her ejer Chrome punktet ved vurderingen, og Passwords naar handlingen skal ske.
const r6 = await kald('computer_click', { x: 400, y: 50 });
check('6 skifter punktets ejer mens kaldet venter, klikkes der ikke', !klikket(400) && /changed while the agent waited/.test(r6),
      r6.slice(0, 110));

// 7. ⛔ Fable, runde 2: AX-opslaget og vindues-serverens klik kan vaere uenige.
const foer7 = spoerger.gangeSpurgt();
const r7 = await kald('computer_click', { x: 500, y: 50 });
check('7 ligger et adgangskode-vindue i stakken under punktet, spoerges der - ogsaa naar AX siger noget andet',
      !klikket(500) && spoerger.gangeSpurgt() === foer7 + 1, r7.slice(0, 90));

// 8. ⛔ Runde 2: et rul uden program lander under MARKOEREN - ikke i det forreste program.
const foer8 = spoerger.gangeSpurgt();
const r8 = await kald('computer_scroll', { dx: 0, dy: 3 });
const rullet = (existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '').split('\n').some(l => l.startsWith('scroll '));
check('8 et rul uden program over et adgangskode-vindue spoerger, og ruller ikke uden ja',
      !rullet && spoerger.gangeSpurgt() === foer8 + 1, r8.slice(0, 90));

srv.kill();

// 9. ⛔ Runde 3 (begge konsulenter): var ejeren UKENDT ved vurderingen, sprang
//    genmaalingen over - og et ja klikkede uden at nogen saa hvad der nu laa der.
//    Her svarer spoergeren JA, saa kun genmaalingen kan standse klikket.
{
  const ja = lavFalskSpoerger('ja', 'cmcp-klikejer-ja');
  const s2 = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
    env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
           CMCP_STATE_DIR: join(D, 'state2'), CMCP_BACKGROUND: '0', CMCP_MODE: 'allow',
           CMCP_ASK_TIMEOUT: '2', CMCP_OSASCRIPT: ja.sti },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let b2 = '', n2 = 0; const w2 = new Map();
  s2.stdout.on('data', d => { b2 += d; let i; while ((i = b2.indexOf('\n')) >= 0) { const l = b2.slice(0, i); b2 = b2.slice(i + 1); try { const m = JSON.parse(l); w2.get(m.id)?.(m); } catch {} } });
  const rpc2 = (m, p) => new Promise(r => { const id = ++n2; w2.set(id, r); s2.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  const kald2 = async (navn, args) => (await rpc2('tools/call', { name: navn, arguments: args })).result?.content?.[0]?.text || '';
  await rpc2('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'klikejer2', version: '1' } });
  s2.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const r700 = await kald2('computer_click', { x: 700, y: 50 });
  check('9a kalibrering: ukendt ejer + ja + nu et almindeligt program -> klikket sker', klikket(700) && ja.gangeSpurgt() === 1,
        r700.slice(0, 80));
  const r600 = await kald2('computer_click', { x: 600, y: 50 });
  check('9b ukendt ejer + ja, men nu et adgangskode-program under punktet -> intet klik',
        !klikket(600) && ja.gangeSpurgt() === 2 && /unknown when it was approved/.test(r600), r600.slice(0, 110));
  s2.kill();
}
rmSync(D, { recursive: true, force: true });
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
