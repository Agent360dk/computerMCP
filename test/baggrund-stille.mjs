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
  // ⛔ RIGTIG hjaelper, med vilje. Foerste udgave pegede paa en sti der ikke
  //    fandtes, «saa proeven ikke kunne udfoere noget». Men saa kunne
  //    `resolveBundleId` heller ikke opsloe et program, og ALT blev afvist som
  //    ukendt maal - hvorefter hver eneste «afvises»-paastand bestod af den
  //    forkerte grund. En proeve der ikke kan skelne, maaler ingenting.
  //
  //    De handlinger der faktisk udfoeres her er nul-rul og `escape` ind i
  //    Finders egen koe. Ingen af dem kan maerkes.
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
  check('og afvisningen fortaeller HVAD man skal saette',
        /Set `app`/.test(t1) && /call it again/.test(t1), t1.slice(0, 90));

  // 4b. ⛔ `computer_launch` blev stille 22/9 - men af et ANDET felt end de
  //     fire input-vaerktoejer. Den er stille naar `background: true`, ikke
  //     naar et program navngives (det goer den altid). En maengde af navne
  //     kunne ikke baere den forskel, saa hvert vaerktoej siger nu selv hvad
  //     der goer DETTE kald stille - og afvisningen siger hvad der mangler.
  const startHoejt = await rpc('tools/call', { name: 'computer_launch', arguments: { app: 'Calculator' } });
  const t1b = JSON.stringify(startHoejt.result ?? startHoejt.error ?? {});
  check('launch uden background afvises - og siger hvad der mangler',
        /Refused/.test(t1b) && /background: true/.test(t1b), t1b.slice(0, 100));

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
  check('med app slipper det forbi baggrunds-porten OG udfoeres',
        !/Refused|Error/.test(t2), t2.slice(0, 80));
  check('og produktet siger selv at skaermen ikke blev roert',
        /pointer stayed/.test(t2), t2.slice(0, 110));

  // 5. ⛔ DEN VIGTIGSTE. Naar kaldet navngiver et program, skal faren
  //    vurderes paa DET program - ikke paa det der tilfaeldigvis er forrest.
  //    Foer 21/9 spurgte porten altid «hvad er forrest?», saa
  //    `computer_type --app "Keychain Access"` blev vurderet paa menneskets
  //    aabne vindue. Adgangskode-porten er produktets kerne; den maa ikke
  //    kigge det forkerte sted.
  //    ⛔ RETTET AF MODSTANDER-REVIEWET: foerste udgave gav bundle-id'et
  //    ordret, som tilfaeldigvis er tegn-for-tegn identisk med posten i
  //    ALWAYS_ASK_APPS. Den bestod derfor UDEN at navne-oversaettelsen blev
  //    koert - og ville vaere groen ogsaa med fund 1 aabent. Nu gives NAVNET.
  const noegle = await rpc('tools/call',
    { name: 'computer_scroll', arguments: { dx: 0, dy: 0, app: 'Keychain Access' } });
  const t3 = JSON.stringify(noegle.result ?? noegle.error ?? {});
  check('et adgangskode-program slipper IKKE igennem, selv naar det ikke er forrest',
        /Refused|denied|dialog/.test(t3), t3.slice(0, 100));

  // 6. ⛔ FUND 1, Critical: et program vi ikke kan opsloe maa vaere et UKENDT
  //    maal - ikke modellens raa streng. Foer rettelsen blev `targetBundleId`
  //    til strengen selv: sand, ikke i ALWAYS_ASK_APPS, og dermed hverken
  //    farlig eller ukendt. At NAVNGIVE programmet gjorde porten svagere end
  //    at lade vaere.
  const fantasi = await rpc('tools/call',
    { name: 'computer_scroll', arguments: { dx: 0, dy: 0, app: 'Program-Der-Ikke-Findes-' + Date.now() } });
  const t4 = JSON.stringify(fantasi.result ?? fantasi.error ?? {});
  check('et program vi ikke kan opsloe behandles som et ukendt maal',
        /Refused|denied|dialog|not running/.test(t4), t4.slice(0, 100));

  // 7. ⛔ FUND 2, Critical: `computer_key cmd+q` goer det samme som
  //    `computer_quit`, som altid spoerger OG er skjult i baggrund.
  //    Tastetrykket var ingen af delene. Forsiden lover at alt der lukker
  //    eller sletter spoerger - det gjaldt kun menuer.
  const luk = await rpc('tools/call',
    { name: 'computer_key', arguments: { combo: 'cmd+q', app: 'Finder' } });
  const t5 = JSON.stringify(luk.result ?? luk.error ?? {});
  check('cmd+q behandles som en handling der lukker noget',
        /Refused|denied|dialog/.test(t5), t5.slice(0, 100));

  // 8. ⛔ FUND H4, fra andet modstander-review: den stille vej er kun stille
  //    hvis modtageren ikke er det program mennesket SIDDER i. `took_screen`
  //    sagde det bagefter - men en etiket efter handlingen er ikke en port.
  const apps = await rpc('tools/call', { name: 'computer_apps', arguments: {} });
  let aktiv = null;
  try { aktiv = (JSON.parse(apps.result.content[0].text).apps || []).find(a => a.active); } catch { /* videre */ }
  if (aktiv) {
    const paaHam = await rpc('tools/call',
      { name: 'computer_scroll', arguments: { dx: 0, dy: 0, app: aktiv.bundleId } });
    const t7 = JSON.stringify(paaHam.result ?? paaHam.error ?? {});
    check('det program mennesket SIDDER i afvises, ikke bare maerkes',
          /Refused/.test(t7) && /using right now|working in right now/.test(t7),
          `${aktiv.name}: ${t7.slice(0, 80)}`);
  } else {
    console.log('UMAALT  intet aktivt program at maale mod');
  }

  // 8b. ⛔ UDVIDET 22/9: `press`, `set_value` og `menu` gik UDENOM porten,
  //     fordi de altid er stille og derfor ikke stod i KAN_STILLES. Men et
  //     `set_value` ind i det felt mennesket skriver i, overskriver det.
  //
  //     ⛔ SIKKER OGSAA HVIS PORTEN FEJLER: hvert kald sigter paa noget der
  //     ikke findes. Slipper det igennem, svarer hjaelperen «ikke fundet» og
  //     intet roeres i menneskets vindue. Kun et «Refused» taeller som groent.
  if (aktiv) {
    const INGEN = 'findes-ikke-' + Date.now();
    for (const [navn, arg] of [
      ['computer_press',     { app: aktiv.bundleId, title: INGEN }],
      ['computer_set_value', { app: aktiv.bundleId, title: INGEN, value: 'x' }],
      ['computer_menu',      { app: aktiv.bundleId, path: INGEN + ' > ' + INGEN }],
    ]) {
      const r = await rpc('tools/call', { name: navn, arguments: arg });
      const t = JSON.stringify(r.result ?? r.error ?? {});
      check(`${navn.replace('computer_', '')} mod det program mennesket sidder i afvises`,
            /Refused/.test(t) && /working in right now/.test(t), t.slice(0, 80));
    }
  }

  // ...og kalibrering den anden vej: en harmloes tast maa IKKE faelde porten,
  // ellers maaler paastanden bare «baggrund afviser alt».
  const harmloes = await rpc('tools/call',
    { name: 'computer_key', arguments: { combo: 'escape', app: 'Finder' } });
  const t6 = JSON.stringify(harmloes.result ?? harmloes.error ?? {});
  check('men en harmloes tast gaar igennem',
        !/Refused/.test(t6), t6.slice(0, 80));
} finally {
  srv.kill();
}

console.log();
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
