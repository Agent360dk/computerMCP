// BAGGRUNDS-TILSTANDEN skal ikke laengere skaere haenderne af.
//
// ⛔ HVORFOR DEN FINDES (21/9-2026)
//    Indtil i dag skjulte baggrunds-tilstand ALLE tretten vaerktoejer der
//    kunne tage skaermen. Det gjorde tilstanden til «produktet, minus
//    halvdelen» - og det var praecis derfor den ikke kunne vaere standarden.
//
//    Men «tager skaermen» var en egenskab ved vaerktoejets NAVN. Det er
//    forkert: det er LEVERINGSKANALEN der tager skaermen. Fire af de tretten
//    kan nu faa et `app`, og saa gaar haendelsen i dét programs egen koe.
//
//    Proeven her holder den nye regel fast: de fire TILBYDES i baggrund,
//    afvises uden `app`, og gaar igennem med.
import { spawn } from 'node:child_process';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const env = {
  ...process.env,
  CMCP_BACKGROUND: '1',
  CMCP_MODE: 'allow',
  CMCP_STATE_DIR: join(process.env.TMPDIR || '/tmp', 'cmcp-baggrund-' + process.pid),
  // Hjaelperen skal IKKE kunne udfoere noget her: proeven maaler PORTEN, ikke
  // maskinen. En helper-sti der ikke findes giver en aerlig fejl i stedet for
  // et tastetryk paa menneskets skaerm.
  CMCP_HELPER: '/findes-ikke-med-vilje',
  // ⛔ HUSETS VAGT (paastand 26) kraever det her, og den har ret:
  //    uden en attrap-spoerger kan en proeve rejse en AEGTE macOS-dialog paa
  //    menneskets skaerm. Betalt to gange i dag paa den anden side af samme
  //    regel - en proeve der skrev i hans vindue. Attrappen er ikke betinget
  //    af noget flag: en boks man kan komme til at vise, bliver vist.
  CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-baggrund-spoerger').sti,
};
const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const venter = new Map();
srv.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!l.trim()) continue;
    try { const m = JSON.parse(l); if (venter.has(m.id)) { venter.get(m.id)(m); venter.delete(m.id); } } catch { /* videre */ }
  }
});
let n = 0;
const rpc = (method, params) => new Promise((res, rej) => {
  const id = ++n;
  venter.set(id, res);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  setTimeout(() => rej(new Error('timeout paa ' + method)), 20000);
});

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const navne = ((await rpc('tools/list')).result?.tools || []).map(t => t.name);

  // 1. De fire der kan goeres stille SKAL tilbydes i baggrund.
  const fire = ['computer_type', 'computer_key', 'computer_scroll', 'computer_click'];
  const mangler = fire.filter(x => !navne.includes(x));
  check('de fire stille-bare vaerktoejer tilbydes i baggrund', mangler.length === 0,
        mangler.length ? 'mangler: ' + mangler.join(', ') : fire.join(', '));

  // 2. ...og de der ALDRIG kan goeres stille, gemmes stadig.
  const skal_vaere_vaek = ['computer_move', 'computer_activate', 'computer_space', 'computer_ask_user'];
  const slap_igennem = skal_vaere_vaek.filter(x => navne.includes(x));
  check('de der altid tager skaermen er stadig skjult', slap_igennem.length === 0,
        slap_igennem.join(', ') || 'move, activate, space, ask_user er vaek');

  // 3. Uden `app` afvises kaldet - og afvisningen skal SIGE hvad man goer.
  const uden = await rpc('tools/call', { name: 'computer_type', arguments: { text: 'x' } });
  const t1 = JSON.stringify(uden.result ?? uden.error ?? {});
  check('uden app afvises det', /Refused/.test(t1), t1.slice(0, 70));
  check('og afvisningen fortaeller at man skal navngive programmet',
        /Name the app/.test(t1) && /global input stream/.test(t1));

  // 4. MED `app` slipper det forbi porten. Hjaelperen findes ikke, saa det
  //    fejler bagefter - men det er en ANDEN fejl, og det er hele pointen.
  //    ⛔ Nul-rul, ikke et tastetryk: proeven maaler PORTEN, og den maa ikke
  //    udfoere noget nogen kan maerke. Foerste udgave brugte computer_type,
  //    og den skrev faktisk et «x» ind i Finders koe.
  const med = await rpc('tools/call', { name: 'computer_scroll', arguments: { dx: 0, dy: 0, app: 'Finder' } });
  const t2 = JSON.stringify(med.result ?? med.error ?? {});
  //    Hjaelperen findes ikke i denne proeve, saa den fejler BAGEFTER porten.
  //    Det er netop beviset: den naaede forbi. Om skaermen blev roert, maales
  //    i test/stille-vej.mjs, hvor der er en rigtig hjaelper og et rigtigt maal.
  check('med app slipper det forbi baggrunds-porten',
        !/Refused/.test(t2) && /helper/.test(t2), t2.slice(0, 80));

  // 5. ⛔ DEN VIGTIGSTE. Naar kaldet navngiver et program, skal faren
  //    vurderes paa DET program - ikke paa det der tilfaeldigvis er forrest.
  //    Foer 21/9 spurgte porten altid «hvad er forrest?», saa
  //    `computer_type --app "Keychain Access"` blev vurderet paa menneskets
  //    aabne vindue. Adgangskode-porten er produktets kerne; den maa ikke
  //    kigge det forkerte sted.
  const noegle = await rpc('tools/call',
    { name: 'computer_scroll', arguments: { dx: 0, dy: 0, app: 'com.apple.keychainaccess' } });
  const t3 = JSON.stringify(noegle.result ?? noegle.error ?? {});
  check('et adgangskode-program slipper IKKE igennem, selv naar det ikke er forrest',
        /Refused|denied|dialog/.test(t3), t3.slice(0, 100));
} finally {
  srv.kill();
}

console.log();
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
