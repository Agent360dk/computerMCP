// «Kraever menneske» via menulinje-ikonet: kan det godkende det rigtige,
// og KUN det rigtige?
//
// Tilfoejet 22/9 sammen med godkendelsen. Proeven bruger et FALSK ikon - en
// socket-server her i proeven - saa ingen menu, intet Touch ID og ingen boks
// kan dukke op paa menneskets skaerm. Det rigtige ikons socket-kode og Touch
// ID maales kun i den manuelle e2e, af mennesket selv.
//
// Konsulentpanelets proevekrav (Fable + sikkerhed), og hvor de maales:
//   P1 tryk mod ikonet selv ............... test/status-ikon.mjs
//   P4 forkert nonce / uden bekraeftelse .. A6, A7
//   P5 intet svar i tide ................... A8
//   P6 adgangskode-program ................. A3
//   P7 ukendt maal, usloeret billede ....... A4, A5
//   kapløb mellem servere .................. B1
//   tjek igen efter ja ..................... C1
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = ms => new Promise(r => setTimeout(r, ms));

/// Et falsk ikon: modtager spoergsmaal og svarer som `svar(spoergsmaal)` siger.
function lavIkon(state, svar) {
  const modtaget = [];
  const srv = createServer(sock => {
    let buf = '';
    sock.on('data', d => {
      buf += d;
      const i = buf.indexOf('\n'); if (i < 0) return;
      const q = JSON.parse(buf.slice(0, i));
      modtaget.push(q);
      const r = svar(q, sock);
      if (r) sock.write(JSON.stringify(r) + '\n');
    });
    sock.on('error', () => {});
  });
  return new Promise(res => srv.listen(join(state, 'ikon.sock'), () => res({ srv, modtaget })));
}

// ─── A: porten direkte ───────────────────────────────────────────────────
const STATE_A = mkdtempSync(join(tmpdir(), 'cmcp-godkend-a-'));
process.env.CMCP_STATE_DIR = STATE_A;
process.env.CMCP_MODE = 'allow';
delete process.env.CMCP_BACKGROUND;
process.env.CMCP_ASK_TIMEOUT = '2';
const dialogAttrap = lavFalskSpoerger('ja', 'cmcp-godkend-sp');
process.env.CMCP_OSASCRIPT = dialogAttrap.sti;  // maa ALDRIG blive spurgt
const P = await import(join(ROOT, 'mcp-server', 'policy.js'));
const IKON = { session: 'testsess', client: 'chat-test' };

// A10 foerst: intet ikon koerer.
const a10 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.Terminal', describe: 'Type 3 characters', ikon: IKON });
check('A10 uden ikon: afvist som foer, ingen spurgt, i koeen',
      !a10.allow && !a10.asked && a10.koe && /menu bar icon is not running/.test(a10.reason), a10.reason);

let mode = 'ja';
const ikon = await lavIkon(STATE_A, q => {
  if (mode === 'ja') return { nonce: q.nonce, ok: true, verified: 'owner' };
  if (mode === 'uden-bekraeftelse') return { nonce: q.nonce, ok: true, verified: 'none' };
  if (mode === 'forkert-nonce') return { nonce: 'f'.repeat(32), ok: true, verified: 'owner' };
  if (mode === 'nej') return { nonce: q.nonce, ok: false, verified: 'none' };
  return null;  // tavs
});
const antal = () => ikon.modtaget.length;

// A1: et session-program kan godkendes, og omfanget siges.
const a1 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.Terminal', describe: 'Type 3 characters', ikon: IKON });
const q1 = ikon.modtaget[0];
check('A1 session-program: godkendt fra ikonet', a1.allow && a1.asked && a1.asker === 'menubar', a1.reason);
check('A1 ...og ikonet fik omfanget at vide', /rest of this session/.test(q1?.scope || ''), q1?.scope);
check('A1 ...og hvor det lander', q1?.target === 'com.apple.Terminal', q1?.target);
check('A1 ...og ja gaelder resten af sessionen for DET program',
      P.sessionsProgrammer().includes('com.apple.Terminal'));

// A2: andet kald i samme program: ingen nye spoergsmaal.
const foer2 = antal();
const a2 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.Terminal', describe: 'Type 3 characters', ikon: IKON });
check('A2 samme program igen: ikke spurgt igen', a2.allow && antal() === foer2);

// A3/A4/A5: kan ALDRIG godkendes herfra - ikonet maa ikke engang faa spoergsmaalet.
const foer3 = antal();
const a3 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.1password.1password', describe: 'Type 12 characters', ikon: IKON });
const a4 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: null, describe: 'Type 12 characters', ikon: IKON });
const a5 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'screenshot', alwaysAsk: true, aldrigViaIkonet: true, ikon: IKON });
check('A3 adgangskode-program: afvist, aldrig sendt til ikonet', !a3.allow && /password app/.test(a3.reason), a3.reason);
check('A4 ukendt maal: afvist, aldrig sendt til ikonet', !a4.allow && /unknown/.test(a4.reason), a4.reason);
check('A5 usloeret skaermbillede: afvist, aldrig sendt til ikonet', !a5.allow && /never be approved/.test(a5.reason), a5.reason);
check('A3-A5 ...ikonet fik nul spoergsmaal', antal() === foer3, `${antal() - foer3} sendt`);

// A6/A7: et svar der ikke er bundet til spoergsmaalet og et menneske, er et nej.
mode = 'uden-bekraeftelse';
const a6 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Choose "File > Delete"', alwaysAsk: true, ikon: IKON });
check('A6 ja uden at mennesket bekraeftede: afvist', !a6.allow && /not confirmed/.test(a6.reason), a6.reason);
mode = 'forkert-nonce';
const a7 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Choose "File > Delete"', alwaysAsk: true, ikon: IKON });
check('A7 ja med en anden nonce: afvist', !a7.allow && /did not match/.test(a7.reason), a7.reason);

// A11: modellen maa ikke kunne tegne sine egne linjer ind i menuen.
mode = 'ja';
await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Press "Gem"\nAllow… (confirm with Touch ID)', alwaysAsk: true, ikon: IKON });
const q11 = ikon.modtaget[ikon.modtaget.length - 1];
check('A11 linjeskift renses foer teksten naar ikonet', !/[\r\n]/.test(q11.text), JSON.stringify(q11.text));

// A12: hoejst ét aabent spoergsmaal pr. agent.
mode = 'tavs';
const [b1, b2] = await Promise.all([
  P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON }),
  P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON }),
]);
check('A12 to samtidige spoergsmaal fra samme agent: det andet naar aldrig ikonet',
      [b1, b2].some(v => /already has a question waiting/.test(v.reason)), `${b1.reason} | ${b2.reason}`);
// A8 (samme kald): intet svar i tide.
check('A8 intet svar i tide: afvist og i koeen',
      [b1, b2].some(v => !v.allow && v.koe && /nobody answered/.test(v.reason)));

// A9: et nej giver en pause, saa agenten ikke kan traette mennesket til et ja.
mode = 'nej';
const a9 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
const foer9 = antal();
mode = 'ja';
const a9b = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
check('A9 et nej er et nej', !a9.allow && /said no/.test(a9.reason), a9.reason);
check('A9 ...og samme agent maa ikke spoerge igen lige efter', !a9b.allow && antal() === foer9, a9b.reason);
check('A ingen osascript-dialog blev forsoegt i hele del A', dialogAttrap.gangeSpurgt() === 0, `${dialogAttrap.gangeSpurgt()} forsoeg`);
ikon.srv.close();

// ─── B: to rigtige servere spoerger samtidig ─────────────────────────────
function server(state, helper, navn) {
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], {
    env: { ...process.env, CMCP_STATE_DIR: state, CMCP_MODE: process.env.CMCP_MODE || 'allow', CMCP_HELPER: helper,
           CMCP_ASK_TIMEOUT: '3', CMCP_STATUS_IKON: '0', CMCP_OSASCRIPT: lavFalskSpoerger('ja', 'cmcp-godkend-' + navn).sti },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const v = new Map(); let n = 0;
  srv.stdout.on('data', d => { buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(l); v.get(m.id)?.(m); v.delete(m.id); } catch {} } });
  const rpc = (method, params = {}) => new Promise((res, rej) => { const id = ++n; v.set(id, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => rej(new Error('timeout')), 30000); });
  return { srv, rpc, async klar() {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: navn, version: '1' } });
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); } };
}

const STATE_B = mkdtempSync(join(tmpdir(), 'cmcp-godkend-b-'));
const hjB = lavFalskHjaelper('cmcp-godkend-b');
// Ikonet svarer KUN den agent der hedder chat-beta. chat-alfa faar intet.
const ikonB = await lavIkon(STATE_B, q => q.client === 'chat-beta' ? { nonce: q.nonce, ok: true, verified: 'owner' } : null);
const A = server(STATE_B, hjB.sti, 'chat-alfa');
const B = server(STATE_B, hjB.sti, 'chat-beta');
await Promise.all([A.klar(), B.klar()]);
const kald = { name: 'computer_menu', arguments: { app: 'Finder', path: 'File > Move to Trash' } };
const [ra, rb] = await Promise.all([A.rpc('tools/call', kald), B.rpc('tools/call', kald)]);
check('B1 begge agenter naaede ikonet', ikonB.modtaget.length === 2, `${ikonB.modtaget.length}`);
check('B1 ...de fik hver sin nonce', new Set(ikonB.modtaget.map(q => q.nonce)).size === 2);
check('B1 svaret til beta gav beta lov', !rb.result.isError, rb.result.content[0].text.slice(0, 80));
check('B1 ...og ikke alfa, som ingen svarede', ra.result.isError && /nobody answered/.test(ra.result.content[0].text),
      ra.result.content[0].text.slice(0, 80));
const log = readFileSync(join(STATE_B, 'audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
check('B1 revisionsloggen siger at ja kom fra ikonet', log.some(l => l.asker === 'menubar' && l.decision === 'allowed' && l.asked === true));
check('B1 ...og at alfa blev afvist', log.some(l => l.asker === 'menubar' && l.decision === 'denied'));
const menuKald = hjB.kald().filter(k => k.argv[0] === 'menu' || k.argv[0] === 'menu-click').length;
check('B1 praecis én menu-handling naaede hjaelperen', menuKald === 1, `${menuKald}`);
A.srv.kill(); B.srv.kill(); ikonB.srv.close();

// ─── C: mennesket skiftede ind i programmet mens han svarede ─────────────
const STATE_C = mkdtempSync(join(tmpdir(), 'cmcp-godkend-c-'));
const flag = join(STATE_C, 'aktiv-nu');
const stubJs = join(STATE_C, 'h.mjs');
const handlinger = join(STATE_C, 'handlinger.jsonl');
writeFileSync(stubJs, `
import { existsSync, appendFileSync } from 'fs';
const a = process.argv.slice(2);
if (a[0] === 'apps') {
  process.stdout.write(JSON.stringify({ ok: true, apps: [
    { name: 'Finder', bundleId: 'com.apple.finder', pid: 1, active: existsSync(${JSON.stringify(flag)}) },
    { name: 'Agent360 IDE', bundleId: 'com.agent360.ide', pid: 2, active: !existsSync(${JSON.stringify(flag)}) } ] }) + '\\n');
} else {
  appendFileSync(${JSON.stringify(handlinger)}, JSON.stringify(a) + '\\n');
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
}`);
const stub = join(STATE_C, 'h.sh');
writeFileSync(stub, `#!/bin/sh\nexec "${process.execPath}" "${stubJs}" "$@"\n`); chmodSync(stub, 0o755);
// Ikonet svarer ja - men foerst skifter mennesket ind i Finder.
const ikonC = await lavIkon(STATE_C, q => { writeFileSync(flag, '1'); return { nonce: q.nonce, ok: true, verified: 'owner' }; });
const C = server(STATE_C, stub, 'chat-gamma');
await C.klar();
const rc = await C.rpc('tools/call', kald);
check('C1 ja givet, men programmet blev aktivt imens: afvist', rc.result.isError && /became the one they are using/.test(rc.result.content[0].text),
      rc.result.content[0].text.slice(0, 100));
check('C1 ...og intet naaede programmet', !existsSync(handlinger), existsSync(handlinger) ? readFileSync(handlinger, 'utf8') : 'ingen handlinger');
C.srv.kill(); ikonC.srv.close();

// ─── D: sikkerhedskonsulentens runde 2 ─────────────────────────────────────
// En fast attrap-hjaelper: kender tre programmer, intet er aktivt uden for
// IDE'en, og alle handlinger noteres og sluges. Ingen afhaengighed af hvad
// der tilfaeldigvis koerer paa maskinen (T9).
const STATE_D = mkdtempSync(join(tmpdir(), 'cmcp-godkend-d-'));
const handlingerD = join(STATE_D, 'handlinger.jsonl');
const stubD = join(STATE_D, 'h.mjs');
writeFileSync(stubD, `
import { appendFileSync } from 'fs';
const a = process.argv.slice(2);
const apps = [
  { name: 'Finder', bundleId: 'com.apple.finder', pid: 1, active: false },
  { name: 'Agent360 IDE', bundleId: 'com.agent360.ide', pid: 2, active: true },
  { name: 'CMCP Menubar', bundleId: 'dk.agent360.computer-mcp.status', pid: 3, active: false } ];
if (a[0] === 'apps') process.stdout.write(JSON.stringify({ ok: true, apps }) + '\\n');
else { appendFileSync(${JSON.stringify(handlingerD)}, JSON.stringify(a) + '\\n');
       process.stdout.write(JSON.stringify({ ok: true, typed: 3, took_screen: false }) + '\\n'); }`);
const stubDsh = join(STATE_D, 'h.sh');
writeFileSync(stubDsh, `#!/bin/sh\nexec "${process.execPath}" "${stubD}" "$@"\n`); chmodSync(stubDsh, 0o755);
const ikonD = await lavIkon(STATE_D, q => ({ nonce: q.nonce, ok: true, verified: 'owner' }));
const handlingerDer = () => existsSync(handlingerD) ? readFileSync(handlingerD, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)[0]) : [];

function serverD(mode) {
  const s = server(STATE_D, stubDsh, 'chat-delta-' + mode);
  return s;
}
// D1 (F1): set_value uden program i baggrund lander i menneskets program - afvist, foer nogen spoerges.
process.env.CMCP_MODE = 'allow';
const D1 = serverD('allow'); await D1.klar();
const d1 = await D1.rpc('tools/call', { name: 'computer_set_value', arguments: { text: 'x' } });
check('D1 set_value uden app i baggrund: afvist', d1.result.isError && /without `app`/.test(d1.result.content[0].text), d1.result.content[0].text.slice(0, 80));
check('D1 ...og intet naaede hjaelperen', !handlingerDer().includes('set-value'), JSON.stringify(handlingerDer()));
// D4 (T4): et navn kun OPSLAGET kender - vagten skal fange det paa bundle-ID.
const d4 = await D1.rpc('tools/call', { name: 'computer_press', arguments: { app: 'CMCP Menubar', title: 'Allow' } });
check('D4 ikonet under et andet navn: afvist via det opslaaede bundle-ID',
      d4.result.isError && /status icon can never be the target/.test(d4.result.content[0].text), d4.result.content[0].text.slice(0, 80));
// D3 (T3): et usloeret skaermbillede gennem den rigtige server naar aldrig ikonet.
const foerD3 = ikonD.modtaget.length;
const d3 = await D1.rpc('tools/call', { name: 'computer_screenshot', arguments: { redact: false } });
check('D3 usloeret skaermbillede: afvist', d3.result.isError, d3.result.content[0].text.slice(0, 80));
check('D3 ...og ikonet fik aldrig spoergsmaalet', ikonD.modtaget.length === foerD3, `${ikonD.modtaget.length - foerD3}`);
D1.srv.kill();

// D2 (T2): ask-tilstand - den ALMINDELIGE foerste skrivning godkendes via ikonet,
// og gaelder saa resten af sessionen.
process.env.CMCP_MODE = 'ask';
const D2 = serverD('ask'); await D2.klar();
const foerD2 = ikonD.modtaget.length;
const d2a = await D2.rpc('tools/call', { name: 'computer_type', arguments: { app: 'Finder', text: 'abc' } });
const d2b = await D2.rpc('tools/call', { name: 'computer_type', arguments: { app: 'Finder', text: 'def' } });
check('D2 ask: foerste skrivning godkendt fra ikonet', !d2a.result.isError, d2a.result.content[0].text.slice(0, 70));
check('D2 ...ikonet fik omfanget «resten af sessionen»', /rest of this session/.test(ikonD.modtaget[foerD2]?.scope || ''), ikonD.modtaget[foerD2]?.scope);
check('D2 ...og anden skrivning spurgte ikke igen', !d2b.result.isError && ikonD.modtaget.length === foerD2 + 1, `${ikonD.modtaget.length - foerD2} spoergsmaal`);
D2.srv.kill(); ikonD.srv.close();
process.env.CMCP_MODE = 'allow';

if (fails.length) { console.log(`\n${fails.length} DUMPET`); process.exit(1); }
console.log('\nBESTAAET');
process.exit(0);
