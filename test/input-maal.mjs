// Tastatur-input uden program lander i det program der er forrest NAAR det sendes.
//
// ⛔ ASTRA, 25/9 (Critical): med CMCP_BACKGROUND=0 blev `type`/`key`/`paste` uden
//    app vurderet paa det forreste program ved vurderingen - og ikke genmaalt
//    efter ventetiden. Skiftede mennesket til Passwords mens dialogen stod
//    aaben, fik Passwords tastetrykkene uden godkendelse.
//
// Intet sendes til Mac'en: attrap-hjaelper + en attrap-spoerger der svarer ja
// og i samme oejeblik «skifter» det forreste program (en fil attrappen laeser).
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const D = mkdtempSync(join(tmpdir(), 'cmcp-inputmaal-'));
const ARGV = join(D, 'argv.txt'), SKIFTET = join(D, 'skiftet');
const STUB = join(D, 'stub.sh');
writeFileSync(STUB, `#!/bin/sh
printf '%s ' "$@" >> ${ARGV}; echo >> ${ARGV}
case "$1" in
  apps) if [ -f ${SKIFTET} ]; then echo '{"ok":true,"apps":[{"name":"Passwords","bundleId":"com.apple.Passwords","active":true}]}'
        else echo '{"ok":true,"apps":[{"name":"TextEdit","bundleId":"com.apple.TextEdit","active":true}]}'; fi ;;
  *) echo '{"ok":true}' ;;
esac
`);
chmodSync(STUB, 0o755);
const spoerger = (skift) => {
  const s = join(D, `spoerger-${skift}.sh`);
  writeFileSync(s, `#!/bin/sh\n${skift ? `: > ${SKIFTET}\n` : ''}echo 'button returned:Yes, gave up:false'\n`);
  chmodSync(s, 0o755); return s;
};
const typet = () => (existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '').split('\n').filter(l => l.startsWith('type ')).length;

async function koer(skift) {
  rmSync(SKIFTET, { force: true });
  const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
    env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
           CMCP_STATE_DIR: join(D, 'state-' + skift), CMCP_BACKGROUND: '0', CMCP_MODE: 'ask',
           CMCP_OSASCRIPT: spoerger(skift) },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', n = 0; const w = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'inputmaal', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const r = (await rpc('tools/call', { name: 'computer_type', arguments: { text: 'hej' } })).result?.content?.[0]?.text || '';
  srv.kill();
  return r;
}

const foer = typet();
const r1 = await koer(false);
check('1 kalibrering: ja + samme program forrest -> teksten sendes', typet() === foer + 1, r1.slice(0, 70));
const foer2 = typet();
const r2 = await koer(true);
check('2 skifter forreste program til Passwords mens dialogen staar aaben -> intet skrives',
      typet() === foer2 && /app in front changed/.test(r2), r2.slice(0, 110));

// 3. ⛔ ASTRA 25/9: logvagten tjekkede foer programlaasen, som kan vente et minut.
//    Her holder proeven SELV programlaasen, venter til beslutningslinjen staar i
//    loggen, laaser saa logfilen og slipper laasen. Kaldet ser foerst problemet
//    efter ventetiden - praecis det scenarie rettelsen findes for.
{
  const { mkdirSync, chmodSync: cm3, unlinkSync } = await import('node:fs');
  const STATE3 = join(D, 'state-laas');
  mkdirSync(join(STATE3, 'laase'), { recursive: true });
  const LAAS = join(STATE3, 'laase', 'com.apple.TextEdit.lock');
  writeFileSync(LAAS, String(process.pid));           // en levende ejer: serveren venter
  const STUB3 = join(D, 'stub3.sh');
  writeFileSync(STUB3, `#!/bin/sh
printf '%s ' "$@" >> ${ARGV}; echo >> ${ARGV}
case "$1" in
  apps) echo '{"ok":true,"apps":[{"name":"TextEdit","bundleId":"com.apple.TextEdit","active":true}]}' ;;
  *) echo '{"ok":true}' ;;
esac
`);
  chmodSync(STUB3, 0o755);
  const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
    env: { ...process.env, CMCP_HELPER: STUB3, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
           CMCP_STATE_DIR: STATE3, CMCP_BACKGROUND: '0', CMCP_MODE: 'allow' },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', n = 0; const w = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'inputmaal3', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const foer3 = typet();
  const svar = rpc('tools/call', { name: 'computer_type', arguments: { text: 'hej' } });
  const LOG3 = join(STATE3, 'audit.jsonl');
  let tilladt = false;
  for (const frist = Date.now() + 20000; !tilladt && Date.now() < frist; await new Promise(r => setTimeout(r, 100))) {
    tilladt = existsSync(LOG3) && readFileSync(LOG3, 'utf8').includes('"decision":"allowed"');
  }
  cm3(LOG3, 0o400);
  unlinkSync(LAAS);
  const r3 = (await svar).result?.content?.[0]?.text || '';
  srv.kill();
  check('3a kalibrering: porten tillod kaldet og skrev beslutningen, FOER laasen blev sluppet', tilladt);
  check('3b bliver loggen uskrivbar mens kaldet venter paa programlaasen, sker handlingen ikke',
        typet() === foer3 && /could not be written just before acting/.test(r3), r3.slice(0, 100));
}

// 4. ⛔ Proeve-reviewet 25/9: «quitting, closing a window and destructive-looking menu
//    items ask every time» var kun bevist ved at LAESE kildeteksten. Her som adfaerd:
//    allow-tilstand (hvor intet andet spoerger), et almindeligt program, en spoerger
//    der ikke svarer - og hvert kald skal spoerge og ikke naa hjaelperen.
{
  const STUB4 = join(D, 'stub4.sh'), ARGV4 = join(D, 'argv4.txt'), SPOR4 = join(D, 'spurgt4.txt');
  writeFileSync(STUB4, `#!/bin/sh
printf '%s ' "$@" >> ${ARGV4}; echo >> ${ARGV4}
case "$1" in
  apps) echo '{"ok":true,"apps":[{"name":"TextEdit","bundleId":"com.apple.TextEdit","active":false},{"name":"Keychain Access","bundleId":"com.apple.keychainaccess","active":false},{"name":"Finder","bundleId":"com.apple.finder","active":true}]}' ;;
  *) echo '{"ok":true}' ;;
esac
`);
  chmodSync(STUB4, 0o755);
  const SP4 = join(D, 'spoerger4.sh');
  writeFileSync(SP4, `#!/bin/sh\necho x >> ${SPOR4}\necho 'button returned:, gave up:true'\n`);
  chmodSync(SP4, 0o755);
  const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
    env: { ...process.env, CMCP_HELPER: STUB4, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
           CMCP_STATE_DIR: join(D, 'state4'), CMCP_BACKGROUND: '0', CMCP_MODE: 'allow', CMCP_OSASCRIPT: SP4 },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', n = 0; const w = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'inputmaal4', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const spurgt = () => existsSync(SPOR4) ? readFileSync(SPOR4, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  const antal = (cmd) => (existsSync(ARGV4) ? readFileSync(ARGV4, 'utf8') : '').split('\n').filter(l => l.startsWith(cmd + ' ')).length;
  const proev = async (navn, args, cmd) => {
    const foer = spurgt(), foerN = antal(cmd);
    const r = (await rpc('tools/call', { name: navn, arguments: args })).result?.content?.[0]?.text || '';
    return { spurgt: spurgt() === foer + 1, naaede: antal(cmd) > foerN, r };
  };
  // Kalibrering: et harmloest menupunkt i samme program spoerger IKKE og naar frem.
  const kal = await proev('computer_menu', { app: 'TextEdit', path: 'File > New' }, 'menu-click');
  check('4a kalibrering: et harmloest menupunkt spoerger ikke i allow - og naar frem', !kal.spurgt && kal.naaede, kal.r.slice(0, 60));
  for (const [navn, args, cmd, hvad] of [
    ['computer_quit', { app: 'TextEdit' }, 'quit', 'afslut'],
    ['computer_window', { app: 'TextEdit', button: 'close' }, 'window-button', 'luk vindue'],
    ['computer_menu', { app: 'TextEdit', path: 'File > Move to Trash' }, 'menu-click', 'farligt menupunkt'],
    ['computer_key', { app: 'TextEdit', combo: 'cmd+cmd+q' }, 'key', 'cmd+cmd+q'],
  ]) {
    const u = await proev(navn, args, cmd);
    check(`4 ${hvad} spoerger hver gang, ogsaa i allow - og sker ikke uden ja`, u.spurgt && !u.naaede, u.r.slice(0, 70));
  }
  // 5. Et adgangskode-program NAVNGIVET ved sit navn, ikke forrest: spoerger hver
  //    gang, og afvisningen siger at det er et adgangskode-program. baggrund-stille
  //    kunne kun maale det naar Keychain Access koerte paa Gustavs Mac.
  const kc = await proev('computer_scroll', { app: 'Keychain Access', dx: 0, dy: 1 }, 'scroll');
  check('5 et navngivet adgangskode-program der ikke er forrest, spoerger - og ruller ikke uden ja',
        kc.spurgt && !kc.naaede, kc.r.slice(0, 70));
  srv.kill();
}

// 6. ⛔ ASTRA runde 2: grenen spurgte `tool.tier`, saa et usloeret skaermbillede
//    (et laesende vaerktoej loeftet til skrivende) sprang programlaasen og linjen
//    foer handlingen over. Spoergeren siger ja; attrappen tager intet billede.
{
  const STATE6 = join(D, 'state6'), STUB6 = join(D, 'stub6.sh');
  writeFileSync(STUB6, `#!/bin/sh
case "$1" in
  apps) echo '{"ok":true,"apps":[{"name":"TextEdit","bundleId":"com.apple.TextEdit","active":true}]}' ;;
  *) echo '{"ok":true}' ;;
esac
`);
  chmodSync(STUB6, 0o755);
  const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
    env: { ...process.env, CMCP_HELPER: STUB6, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
           CMCP_STATE_DIR: STATE6, CMCP_BACKGROUND: '0', CMCP_MODE: 'allow', CMCP_OSASCRIPT: spoerger(false) },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', n = 0; const w = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'inputmaal6', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await rpc('tools/call', { name: 'computer_screenshot', arguments: { redact: false, maxWidth: 100 } });
  srv.kill();
  const linjer = existsSync(join(STATE6, 'audit.jsonl')) ? readFileSync(join(STATE6, 'audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  const shot = linjer.filter(d => d.tool === 'computer_screenshot');
  check('6 et usloeret skaermbillede faar en linje lige foer handlingen, som enhver skrivende handling',
        shot.some(d => d.decision === 'allowed') && shot.some(d => d.phase === 'executing'),
        shot.map(d => d.phase || d.decision || d.outcome).join(', '));
}

rmSync(D, { recursive: true, force: true });
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
