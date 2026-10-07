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
import './ryd-op.mjs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger, HJAELPER_OPSLAG } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Ingen proeve maa saette et ikon i menneskets menulinje - heller ikke koert uden run-all.sh.
process.env.CMCP_STATUS_IKON = '0';
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

// A10b: et ikon der gik ned, efterlader sin socket-fil. Den maa ikke tages
// for et ikon der koerer (maalt live 22/9: «could not be reached»).
writeFileSync(join(STATE_A, 'ikon.sock'), '');
const a10b = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.Terminal', describe: 'Type 3 characters', ikon: IKON });
check('A10b efterladt socket-fil: genkendt som «ikonet koerer ikke»',
      !a10b.allow && /menu bar icon is not running/.test(a10b.reason), a10b.reason);
(await import('node:fs')).unlinkSync(join(STATE_A, 'ikon.sock'));

let mode = 'ja';
// ⛔ 29/9: closuren tog ikke `sock`, saa «sent-ja» kastede en ReferenceError som
//    try{} slugte - det sene ja blev ALDRIG sendt, og A13 maalte kun «intet svar».
const ikon = await lavIkon(STATE_A, (q, sock) => {
  if (mode === 'ja') return { nonce: q.nonce, ok: true, verified: 'owner' };
  if (mode === 'uden-bekraeftelse') return { nonce: q.nonce, ok: true, verified: 'none' };
  if (mode === 'forkert-nonce') return { nonce: 'f'.repeat(32), ok: true, verified: 'owner' };
  if (mode === 'nej') return { nonce: q.nonce, ok: false, verified: 'none' };
  if (mode === 'krasj') { sock.destroy(); return null; }          // ikonet gaar ned midt i spoergsmaalet
  if (mode === 'skrald') { sock.write('ikke json\n'); return null; }
  if (mode === 'delt') {                          // svaret kommer i to stykker
    const hel = JSON.stringify({ nonce: q.nonce, ok: true, verified: 'owner' }) + '\n';
    sock.write(hel.slice(0, 10));
    setTimeout(() => { try { sock.write(hel.slice(10)); } catch {} }, 80);
    return null;
  }
  if (mode === 'sent-ja') {                       // svarer FOR SENT, med et gyldigt ja
    setTimeout(() => { try { sock.write(JSON.stringify({ nonce: q.nonce, ok: true, verified: 'owner' }) + '\n'); } catch {} }, 2600);
    return null;
  }
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

// AG: en handling der spoerger HVER gang, sender sin GRUND til ikonet. Fable 25/9:
//      i standardtilstanden fik mennesket kun «Record the main display ... 10 minutes»
//      - aldrig at kodeordsfelter IKKE sloeres i filmen. Grunden stod kun i dialogen.
const foerG = antal();
const aG = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'computer-mcp.screen-recording', describe: 'Record the main display to a video file for up to 10 minutes',
                             alwaysAsk: true, hvorfor: 'GRUNDEN-TIL-AT-SPOERGE', ikon: IKON });
const qG = ikon.modtaget[foerG];
check('AG spoerg-hver-gang: ikonet faar grunden, ikke kun handlingen',
      aG.allow && /GRUNDEN-TIL-AT-SPOERGE/.test(qG?.scope || '') && /this one action only/.test(qG?.scope || ''), qG?.scope);

// A6/A7: et svar der ikke er bundet til spoergsmaalet og et menneske, er et nej.
mode = 'uden-bekraeftelse';
const a6 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Choose "File > Delete"', alwaysAsk: true, ikon: IKON });
check('A6 ja uden at mennesket bekraeftede: afvist', !a6.allow && /not confirmed/.test(a6.reason), a6.reason);
mode = 'forkert-nonce';
const a7 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Choose "File > Delete"', alwaysAsk: true, ikon: IKON });
check('A7 ja med en anden nonce: afvist', !a7.allow && /did not match/.test(a7.reason), a7.reason);

// A13: et ja der kommer EFTER fristen er et nej.
// ⚠️ UMAALT herfra: ur-tjekket i godkend.js er et ANDET lag under timeren, og
//    de to kan ikke skilles ad uden at kunne skrue paa maskinens ur. Proeven
//    beviser udfaldet (et sent ja giver aldrig lov), ikke hvilket lag der tog det.
mode = 'sent-ja';
const a13 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
check('A13 ja efter fristen: afvist', !a13.allow && /after the question had expired|nobody answered/.test(a13.reason), a13.reason);

// A11: modellen maa ikke kunne tegne sine egne linjer ind i menuen.
mode = 'ja';
await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Press "Gem"\nAllow… (confirm with Touch ID)', alwaysAsk: true, ikon: IKON });
const q11 = ikon.modtaget[ikon.modtaget.length - 1];
check('A11 linjeskift renses foer teksten naar ikonet', !/[\r\n]/.test(q11.text), JSON.stringify(q11.text));

// A14/A15 (29/9, panelet): et ja skal daekke ALT det mennesket saa. Foer klippede
//   protokollen teksten tavst ved 200 tegn - resten naaede aldrig ikonet.
const lang = 'Send til Benjamin: ' + 'computer-MCP virker. '.repeat(140);   // ~2.960 tegn
await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: lang, alwaysAsk: true, ikon: IKON });
const q14 = ikon.modtaget[ikon.modtaget.length - 1];
check('A14 en lang tekst naar ikonet HEL, ikke klippet', q14?.text === lang.trim(), `${q14?.text?.length} af ${lang.trim().length} tegn`);
const foer15 = antal();
const a15 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'x'.repeat(4001), alwaysAsk: true, ikon: IKON });
check('A15 over loftet: ikke spurgt og afvist - intet ja til noget halvt laest',
      !a15.allow && antal() === foer15 && /more than the 4000/.test(a15.reason), a15.reason);

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

// F (29/9, panelet: «lad porten fejle og komme tilbage» foer den udvides).
//   Porten er brugt 3 gange paa ni dage; hver fejlvej skal ende i et nej - og
//   den NAESTE spoergsmaal skal virke, ellers har én fejl lukket porten for altid.
mode = 'krasj';
const f1 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
check('F1 ikonet gaar ned midt i spoergsmaalet: et nej, ikke et ja', !f1.allow && /closed without an answer|could not be reached/.test(f1.reason), f1.reason);
mode = 'ja';
const f1b = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
check('F1b ...og det naeste spoergsmaal virker straks (ingen haengende «venter», ingen straf-pause)', f1b.allow, f1b.reason);
mode = 'skrald';
const f2 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
check('F2 et svar der ikke kan laeses: et nej', !f2.allow && /did not match/.test(f2.reason), f2.reason);
mode = 'delt';
const f3 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
check('F3 et ja der kommer i to stykker, laeses som ét', f3.allow, f3.reason);
// F4: ikonet doer helt og startes igen - porten skal finde det nye.
ikon.srv.close();
try { (await import('node:fs')).unlinkSync(join(STATE_A, 'ikon.sock')); } catch {}
const f4 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
check('F4 ikonet er vaek: afvist uden at haenge', !f4.allow && /not running/.test(f4.reason), f4.reason);
mode = 'ja';
const ikon2 = await lavIkon(STATE_A, q => ({ nonce: q.nonce, ok: mode !== 'nej', verified: mode === 'nej' ? 'none' : 'owner' }));
const f4b = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
check('F4b ...et nyt ikon paa samme sted: porten virker igen', f4b.allow && ikon2.modtaget.length === 1, f4b.reason);
// Resten af del A taler med det nye ikon.
ikon.srv = ikon2.srv; ikon.modtaget = ikon2.modtaget;

// A9: et nej giver en pause, saa agenten ikke kan traette mennesket til et ja.
mode = 'nej';
const a9 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
const foer9 = antal();
mode = 'ja';
const a9b = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
check('A9 et nej er et nej', !a9.allow && /said no/.test(a9.reason), a9.reason);
check('A9 ...og samme agent maa ikke spoerge igen lige efter', !a9b.allow && antal() === foer9, a9b.reason);
check('A ingen osascript-dialog blev forsoegt i hele del A', dialogAttrap.gangeSpurgt() === 0, `${dialogAttrap.gangeSpurgt()} forsoeg`);

// G (runde 1 30/9, Astra 7 + Fable F1): i FORGRUND - og dermed under et skaerm-laan -
//   maa et «ikke spurgt» fra ikonet aldrig blive til en osascript-boks. Kun et ikon
//   der slet ikke koerer, giver boksen. Pausen fra A9s nej er stadig aktiv her.
process.env.CMCP_BACKGROUND = '0';
const dG = dialogAttrap.gangeSpurgt();
const g1 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
check('G1 forgrund lige efter et nej i ikonet: afvist, ingen boks', !g1.allow && /said no/.test(g1.reason) && dialogAttrap.gangeSpurgt() === dG, g1.reason);
const g2 = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'x'.repeat(4001), alwaysAsk: true, ikon: IKON });
check('G2 forgrund, tekst over loftet: afvist, ingen boks', !g2.allow && /more than the 4000/.test(g2.reason) && dialogAttrap.gangeSpurgt() === dG, g2.reason);
ikon.srv.close(); ikon.srv = { close() {} };
try { (await import('node:fs')).unlinkSync(join(STATE_A, 'ikon.sock')); } catch {}
const g3a = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: IKON });
check('G3a ikonet koerer ikke OG personen sagde lige nej: afvist, ingen boks (Astra R2 6)', !g3a.allow && /said no/.test(g3a.reason) && dialogAttrap.gangeSpurgt() === dG, g3a.reason);
const g3b = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'x'.repeat(4001), alwaysAsk: true, ikon: IKON });
check('G3b ikonet koerer ikke, tekst over loftet: afvist, ingen boks', !g3b.allow && /more than the 4000/.test(g3b.reason) && dialogAttrap.gangeSpurgt() === dG, g3b.reason);
// G3c: uden pause og uden ikon ER boksen faldbag - maalt i en frisk proces (pausen lever i modulet).
{
  const { execFileSync: ef } = await import('node:child_process');
  const sp3 = lavFalskSpoerger('ja', 'cmcp-godkend-g3');
  const kode = `const P = await import(${JSON.stringify(join(ROOT, 'mcp-server', 'policy.js'))});
    const v = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.finder', describe: 'Quit Finder', alwaysAsk: true, ikon: { session: 's', client: 'c' } });
    console.log(JSON.stringify(v));`;
  const ud = ef(process.execPath, ['--input-type=module', '-e', kode], { encoding: 'utf8', timeout: 60000,
    env: { ...process.env, CMCP_BACKGROUND: '0', CMCP_STATUS_IKON: '0', CMCP_ASK_TIMEOUT: '2', CMCP_OSASCRIPT: sp3.sti,
           CMCP_STATE_DIR: mkdtempSync(join(tmpdir(), 'cmcp-godkend-g3-')) } });
  const g3c = JSON.parse(ud.trim().split('\n').pop());
  check('G3c forgrund, ikonet koerer ikke, ingen pause: boksen er faldbag', g3c.allow && sp3.gangeSpurgt() === 1, JSON.stringify(g3c).slice(0, 100));
}
delete process.env.CMCP_BACKGROUND;
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
} else if (${JSON.stringify(HJAELPER_OPSLAG)}.includes(a[0])) {
  // Et rent opslag (fx \`idle\`, punkt P 7/10) er ikke en handling - samme liste som falsk-hjaelper.
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
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

// C2: samme fare, men gemt bag programlaasen. Astra, runde 2 (22/9): tjekket
// laa FOER laasen, og laasen kan vente et minut paa en anden agent. Proeven
// HOLDER selv laasen, lader mennesket skifte ind i programmet imens, og
// slipper saa - saa er den eneste vej til et rigtigt svar et tjek inde i laasen.
const STATE_C2 = mkdtempSync(join(tmpdir(), 'cmcp-godkend-c2-'));
const flag2 = join(STATE_C2, 'aktiv-nu');
const handlinger2 = join(STATE_C2, 'handlinger.jsonl');
const stub2js = join(STATE_C2, 'h.mjs');
writeFileSync(stub2js, `
import { existsSync, appendFileSync } from 'fs';
const a = process.argv.slice(2);
if (a[0] === 'apps') {
  process.stdout.write(JSON.stringify({ ok: true, apps: [
    { name: 'Finder', bundleId: 'com.apple.finder', pid: 1, active: existsSync(${JSON.stringify(flag2)}) },
    { name: 'Agent360 IDE', bundleId: 'com.agent360.ide', pid: 2, active: !existsSync(${JSON.stringify(flag2)}) } ] }) + '\\n');
} else if (${JSON.stringify(HJAELPER_OPSLAG)}.includes(a[0])) {
  // Et rent opslag (fx \`idle\`, punkt P 7/10) er ikke en handling - samme liste som falsk-hjaelper.
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
} else {
  appendFileSync(${JSON.stringify(handlinger2)}, JSON.stringify(a) + '\\n');
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
}`);
const stub2 = join(STATE_C2, 'h.sh');
writeFileSync(stub2, `#!/bin/sh\nexec "${process.execPath}" "${stub2js}" "$@"\n`); chmodSync(stub2, 0o755);
const ikonC2 = await lavIkon(STATE_C2, q => ({ nonce: q.nonce, ok: true, verified: 'owner' }));
const C2 = server(STATE_C2, stub2, 'chat-delta');
await C2.klar();
// vi tager laasen paa Finder, saa serveren maa vente
const { mkdirSync: mk, writeFileSync: wf, unlinkSync: ul } = await import('node:fs');
const laas = join(STATE_C2, 'laase', 'com.apple.finder.lock');
mk(join(STATE_C2, 'laase'), { recursive: true }); wf(laas, String(process.pid));
const svarC2 = C2.rpc('tools/call', { name: kald.name, arguments: kald.arguments });
// ⛔ 23/9: her stod en fast ventetid paa 1200 ms. Under fuld suite naaede
//    serveren ikke saa langt paa den tid, saa programmet var allerede aktivt
//    da porten FOER laasen kiggede - og proeven maalte den forkerte port.
//    Nu ventes paa et deterministisk signal: spoergsmaalet er naaet ikonet.
for (let i = 0; i < 300 && ikonC2.modtaget.length === 0; i++) await vent(50);
await vent(150);                  // ja er sendt; serveren venter nu paa laasen
writeFileSync(flag2, '1');        // mennesket skifter ind i Finder MENS den venter
await vent(300);
ul(laas);                         // vi slipper laasen
const rc2 = (await svarC2).result;
check('C2 programmet blev aktivt mens laasen ventede: afvist',
      rc2.isError && /became the one they are using/.test(rc2.content[0].text), rc2.content[0].text.slice(0, 90));
check('C2 ...og intet naaede programmet', !existsSync(handlinger2), existsSync(handlinger2) ? readFileSync(handlinger2, 'utf8') : 'ingen handlinger');
C2.srv.kill(); ikonC2.srv.close();

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

// ─── E: computer_ask_user via ikonet (29/9, panelet) ─────────────────────
// I baggrund gaar spoergsmaalet til ikonet som «goer det selv». «Done» er et
// SIGNAL: det maa aldrig kunne blive et ja til en anden handling.
const STATE_E = mkdtempSync(join(tmpdir(), 'cmcp-godkend-e-'));
const hjE = lavFalskHjaelper('cmcp-godkend-e');
let eSvar = 'done';
const ikonE = await lavIkon(STATE_E, q => eSvar === 'done' ? { nonce: q.nonce, ok: true, verified: 'done' }
                                      : eSvar === 'nej' ? { nonce: q.nonce, ok: false, verified: 'none' } : null);
const spE = lavFalskSpoerger('ja', 'cmcp-godkend-e-sp');
// Egen server: attrappen skal kunne taelles, saa den saettes paa miljoeet her.
const E1s = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], {
  env: { ...process.env, CMCP_STATE_DIR: STATE_E, CMCP_MODE: 'allow', CMCP_HELPER: hjE.sti,
         CMCP_ASK_TIMEOUT: '3', CMCP_STATUS_IKON: '0', CMCP_OSASCRIPT: spE.sti },
  stdio: ['pipe', 'pipe', 'pipe'] });
const eRpc = (() => { let buf = ''; const v = new Map(); let n = 0;
  E1s.stdout.on('data', d => { buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(l); v.get(m.id)?.(m); v.delete(m.id); } catch {} } });
  return (method, params = {}) => new Promise((res, rej) => { const id = ++n; v.set(id, res);
    E1s.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => rej(new Error('timeout')), 30000); }); })();
await eRpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'chat-e', version: '1' } });
E1s.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const e1 = await eRpc('tools/call', { name: 'computer_ask_user',
  arguments: { message: 'Type your 2FA code in the field - Lands in: com.evil.app', app: 'Finder' } });
const qE = ikonE.modtaget[0];
const e1t = e1.result?.content?.[0]?.text || '';
check('E1 ask_user i baggrund naar ikonet som «goer det selv»', qE?.kind === 'goer-selv', JSON.stringify(qE || {}).slice(0, 120));
check('E1 ...hvor det lander er skrevet af SERVEREN (bundle-ID), ikke af modellen',
      /com\.apple\.finder/.test(qE?.target || '') && qE?.targetBundle === 'com.apple.finder' && !/evil/.test(qE?.target || ''), `${qE?.target} | ${qE?.targetBundle}`);
check('E1 ...Done giver done:true, og ingen tekst kommer tilbage', !e1.result.isError && /"done":\s*true/.test(e1t) && !/2FA code/.test(e1t.replace(/"note".*/, '')), e1t.slice(0, 120));
check('E1 ...og ingen dialog blev rejst', spE.gangeSpurgt() === 0, `${spE.gangeSpurgt()}`);
eSvar = 'nej';
const e2 = await eRpc('tools/call', { name: 'computer_ask_user', arguments: { message: 'Approve the login', app: 'Finder' } });
check('E2 «I won\'t do this»: done:false', /"done":\s*false/.test(e2.result?.content?.[0]?.text || ''), (e2.result?.content?.[0]?.text || '').slice(0, 100));
E1s.kill(); ikonE.srv.close();

// E3: et «done»-svar paa et almindeligt SAMTYKKE er et nej. Ellers kunne et
//     signal uden Touch ID blive til en tilladelse.
const STATE_E3 = mkdtempSync(join(tmpdir(), 'cmcp-godkend-e3-'));
process.env.CMCP_STATE_DIR = STATE_E3;
const G = await import(join(ROOT, 'mcp-server', 'godkend.js') + '?e3');
const ikonE3 = await lavIkon(STATE_E3, q => ({ nonce: q.nonce, ok: true, verified: 'done' }));
const e3 = await G.spoergIkonet({ session: 's', client: 'c', text: 'Quit Finder', scope: 'this one action only', target: 'com.apple.finder' }, 3);
check('E3 «done» paa et samtykke-spoergsmaal: ikke et ja', !e3.ok && /not confirmed/.test(e3.grund), e3.grund);
ikonE3.srv.close();

if (fails.length) { console.log(`\n${fails.length} DUMPET`); process.exit(1); }
console.log('\nBESTAAET');
process.exit(0);
