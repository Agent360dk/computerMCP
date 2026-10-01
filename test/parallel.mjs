// PARALLEL: kan 5, 10 og 15 agenter arbejde SAMTIDIG i baggrunden, mens et
// menneske skriver i et andet program - uden at nogen af dem tager skaermen?
//
// ⛔ HVORFOR DEN FINDES (1/10-2026)
//    Gustav: «ellers er der ikke nogen grund til at vi kan koere 15 samtidig».
//    concurrent.mjs beviser kun at revisionsloggen ikke blandes. Her koerer hver
//    agent en rigtig use case (sin egen server, sin egen hjaelper-vagt), alle paa
//    én gang, og det maales udefra:
//      1. hvad der stod FORREST, hvert 100. ms, hele vejen - maa aldrig skifte
//      2. menneskets tekst i TextEdit, tegn for tegn - intet maa mangle eller komme til
//      3. hver agents eget tjek (det programmet SELV viser bagefter)
//      4. ingen agent naaede et program uden for sin liste (vagt-hjaelperen)
//
// ⛔ KUN PAA EN FREMMED MASKINE: proeven skriver som et menneske i TextEdit og
//    starter og lukker programmer. Paa menneskets Mac er det ikke en proeve.
import './ryd-op.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { SCENARIER, koerScenarie } from './brugsscenarier.mjs';
import { startFilm } from './film.mjs';
import { startForrestLog, doem } from './forrest-log.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = (ms) => new Promise(r => setTimeout(r, ms));

// To tilstande:
//   FREMMED (CMCP_FREMMED_MASKINE=1, GitHubs Mac): proeven spiller mennesket i TextEdit og filmer.
//   EGEN MAC (CMCP_PARALLEL_EGEN_MAC=1, 1/10 Gustav: «testet og tjekket paa computeren»):
//     mennesket ER der og arbejder som han plejer. Proeven skriver ALDRIG, filmer ikke,
//     lukker ikke hans programmer, og koerer kun opgaver der ikke aendrer hans data
//     (Lommeregner, Skak, Aktivitetsovervaagning, Finder laest). Maalet: kom NOGEN af
//     agenternes programmer frem foran ham - hvert 100. ms, hele vejen.
const FREMMED = process.env.CMCP_FREMMED_MASKINE === '1';
const EGEN = !FREMMED && process.env.CMCP_PARALLEL_EGEN_MAC === '1';
if (!FREMMED && !EGEN) {
  console.log('SPR. saet CMCP_FREMMED_MASKINE=1 (GitHubs Mac) eller CMCP_PARALLEL_EGEN_MAC=1 (din egen Mac, mens du arbejder)');
  process.exit(0);
}

// Arbejderne: hver sit program, saa to agenter aldrig deler fokus i samme program.
// ⛔ 1/10: Skak er et DOKUMENT - et ugemt parti gav et gem-panel foran Gustav. Kun paa GitHubs Mac.
const ARBEJDERE = (EGEN ? [14, 13] : [14, 15, 9, 4, 17, 5, 13, 6]).map(nr => SCENARIER.find(s => s.nr === nr)).filter(Boolean);
// Laeserne: flere agenter der laeser Finder samtidig - laesning deler intet fokus.
const laeser = (i) => ({
  nr: 100 + i, navn: `laese Finder ${i}`, apps: ['com.apple.finder'], klasse: 'laes',
  async trin() {},
  async tjek(c) {
    const v = await c.vinduer('com.apple.finder');
    const m = await c.find('com.apple.finder', { role: 'AXButton', limit: 5 });
    return `${v.length} vindue(r), ${m.length} knap(per) laest`;
  },
});
const NIVEAUER = (process.env.CMCP_PARALLEL_NIVEAUER || '5,10,15').split(',').map(Number);

// Mennesket: et TextEdit-dokument forrest, og ord der skrives som et menneske gør.
// ⛔ Koersel 36832790982 OG 36837334933 (1/10): TextEdit svarede ikke paa AppleEvents
//    fra proeven paa GitHubs Mac (-1712, 40 gange), og jobbet broendte 90 min. Nu
//    INGEN AppleEvents: `open` (LaunchServices) aabner, og hjaelperen - som har
//    tilgaengeligheds-tilladelsen paa koereren - skriver og laeser. Hård frist 20 s.
const HJ = join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
const hj = (...a) => JSON.parse(execFileSync(HJ, a, { encoding: 'utf8', timeout: 10000 }));
function startMenneske() {
  const d = mkdtempSync(join(tmpdir(), 'cmcp-parallel-'));
  const fil = join(d, 'menneske.txt');
  writeFileSync(fil, '');
  execFileSync('open', ['-a', 'TextEdit', fil]);
  const frist = Date.now() + 20000;
  for (;;) {
    try { if (hj('windows', '--app', 'com.apple.TextEdit').count > 0 && hj('focused').element?.bundleId === 'com.apple.TextEdit') break; } catch {}
    if (Date.now() > frist) throw new Error('UMÅLT: TextEdit kom ikke frem med et vindue inden 20 s');
    execFileSync('sleep', ['0.5']);
  }
  // Sin egen proces: tastaturet maa ikke bremse proevens egen haendelsesloekke.
  // ⛔ 1/10 (koersel 36869119105): uden --app gik tasterne til det FORRESTE program -
  //    og naar Finders menu-klik (scenarie 15) kort gjorde Finder forrest, forsvandt
  //    tasterne derind, mens helperen stadig svarede ok (sendt-tallet talte dem med).
  //    TextEdits dokument endte TOMT, selvom "skrevet" viste 250+ tegn. Nu skriver
  //    mennesket PRAECIS som produktet selv skriver i baggrunden: med --app, via
  //    tilgaengeligheds-laget, saa teksten rammer TextEdit uanset hvad der er forrest.
  const log = join(d, 'skrevet.txt'), stop = join(d, 'stop');
  const p = spawn('bash', ['-c', `i=0; while [ ! -f "${stop}" ]; do
      "${HJ}" type --app com.apple.TextEdit --text "m$i " >/dev/null 2>&1 && printf "m$i " >> "${log}"
      i=$((i+1)); sleep 0.12; done`], { stdio: 'ignore' });
  const slut = new Promise(r => p.on('close', r));
  return {
    async slut() { writeFileSync(stop, ''); await slut; await vent(800); return existsSync(log) ? readFileSync(log, 'utf8') : ''; },
    // Feltets laengde og de foerste 200 tegn (hjaelperen klipper laengere vaerdier, og siger det).
    tekst() {
      const m = (hj('find', '--app', 'com.apple.TextEdit', '--role', 'AXTextArea').matches || [])[0] || {};
      return { start: m.value || '', laengde: m.value_chars ?? (m.value || '').length };
    },
    luk() { try { execFileSync('killall', ['TextEdit'], { stdio: 'ignore' }); } catch {} },
  };
}

// Hvilke pids er agenternes programmer? Laeses loebende, for et program kan vaere lukket igen
// naar dommen faeldes.
function startPidKort(bundles) {
  const kort = new Map();
  const tag = () => { try { for (const a of hj('apps').apps || []) if (bundles.has(a.bundleId)) kort.set(a.pid, a.bundleId); } catch {} };
  tag();
  const ur = setInterval(tag, 1000);
  return { kort, stop() { clearInterval(ur); tag(); } };
}

function nulstil() {
  try { execFileSync('killall', ['Chess', 'Calculator', 'Contacts', 'System Settings', 'Activity Monitor', 'Notes', 'Safari'], { stdio: 'ignore' }); } catch {}
  try { execFileSync('rm', ['-rf', `${process.env.HOME}/Library/Containers/com.apple.Chess/Data/Library/Saved Application State`]); } catch {}
}

const rapport = [];
for (const n of NIVEAUER) {
  if (FREMMED) { nulstil(); await vent(2500); }   // ⛔ aldrig paa menneskets Mac: killall lukker HANS programmer
  const hold = [...ARBEJDERE.slice(0, n), ...Array.from({ length: Math.max(0, n - ARBEJDERE.length) }, (_, i) => laeser(i + 1))];
  console.log(`\n== ${n} agenter samtidig: ${hold.map(s => s.nr).join(', ')}`);
  let menneske = null;
  if (FREMMED) {
    try { menneske = startMenneske(); } catch (e) { check(`${n}.0 mennesket kom i gang`, false, e.message); continue; }
    await vent(1500);
  }
  const film = FREMMED ? startFilm(`parallel-${n}-agenter`) : { stop: async () => null };
  const agentBundles = new Set(hold.flatMap(s => s.apps).filter(a => a !== 'com.apple.finder'));
  const pids = startPidKort(agentBundles);
  const vagt = startForrestLog();
  await vent(1500);
  const t0 = Date.now();
  // Én delt state-mappe pr. runde: programlaas og revisionskaede deles, som paa en rigtig Mac.
  const delt = mkdtempSync(join(tmpdir(), 'cmcp-parallel-state-'));
  const res = await Promise.all(hold.map(s => koerScenarie(s, { film: false, menneskeArbejder: EGEN, stateDir: delt })));
  const sek = ((Date.now() - t0) / 1000).toFixed(1);
  await vent(2500);   // et program kan hente sig selv frem sekunder efter (Kontakter, 27/9)
  const maaling = await vagt.stop();
  pids.stop();
  const skrevet = menneske ? await menneske.slut() : '';
  let staar = { start: '', laengde: -1 };
  try { if (menneske) staar = menneske.tekst(); } catch {}
  const filmSti = await film.stop();
  menneske?.luk();
  const iRunden = maaling.skift.filter(x => x.t >= t0 - 1500);

  // ⛔ 1/10 (koersel 36869119105): «tog > 0» fejlede ogsaa en scenarie der selv
  //    tog skaermen OG gav den aerligt tilbage (menu-klik, README linje 204: "it is
  //    a moment, not nothing") - det er allerede koerScenariens egen 'delvist', ikke
  //    en fejl. Et IKKE-tilbagegivet tag staar som 'fejlede' i koerScenarie selv
  //    (branchen "tog skærmen og gav den ikke tilbage"), saa status alene er nok;
  //    5.1b dømmer den AERLIGE tilbagegivelsestid for mennesket uafhaengigt.
  const roede = res.filter(r => r.status === 'fejlede');
  const tid = (t) => `${((t - t0) / 1000).toFixed(1)} s`;
  // ⛔ 1/10: maalt i macOS' egen log, med aarsag - den gamle vagt var blind (1 linje mod 26 skift).
  check(`${n}.0 maaleren saa skaermen (${maaling.puls} puls, ${maaling.skift.length} skift)`, !maaling.umaalt, maaling.umaalt || '');
  const fund = doem(iRunden, (pid) => pids.kort.has(pid));
  check(`${n}.1 intet agent-program kom frem, og intet skift blev revet tilbage fra mennesket`, fund.length === 0,
    fund.map(f => `${f.slags} (${pids.kort.get(f.pid) || 'pid ' + f.pid}, ${f.aarsag}) efter ${tid(f.t)}`).join(', '));
  let fremmede = fund.length;
  if (FREMMED) {
    const tePid = [...new Set(iRunden.filter(x => x.t < t0).map(x => x.pid))].pop();
    const efter = iRunden.filter(x => x.t >= t0);
    // ⛔ 1/10 (koersel 36869119105): «TextEdit forrest hele vejen» var for strengt -
    //    scenarie 15 klikker Finders menu (cmd+n, shift+cmd+g), og et menu-klik
    //    SKAL kort goere programmet forrest for at kunne trykke dets menulinje.
    //    README (linje 204) lover selv ærligt «took_screen»+«gave_back»: "it is a
    //    moment, not nothing" - IKKE nul beroering nogensinde. Det der skal maales
    //    er om skaermen blev givet AERLIGT tilbage, ikke om den aldrig blev taget.
    //    Give-tilbage-vinduerne er 240 ms (tryk), 2000 ms (menu), 4000 ms (start);
    //    3,5 s tolerance daekker alle tre plus AX-rundtursforsinkelse under last.
    const TOLERANCE_MS = 3500;
    const udsving = [];
    let start = null;
    for (const x of efter) {
      if (x.pid !== tePid) { if (!start) start = x; }
      else if (start) { udsving.push({ start, slut: x, varighedMs: x.t - start.t }); start = null; }
    }
    if (start) udsving.push({ start, slut: null, varighedMs: null });
    const forLangsomme = udsving.filter(u => u.varighedMs === null || u.varighedMs > TOLERANCE_MS);
    fremmede += forLangsomme.length;
    check(`${n}.1b paa GitHubs Mac: TextEdit faar skaermen aerligt tilbage (${udsving.length} udsving, ${TOLERANCE_MS}ms tolerance)`,
      forLangsomme.length === 0,
      forLangsomme.map(u => `pid ${u.start.pid} (${u.start.aarsag}) efter ${tid(u.start.t)}` +
        (u.varighedMs == null ? ' - aldrig givet tilbage' : `, varede ${u.varighedMs} ms`)).join(', '));
    check(`${n}.2 menneskets tekst er intakt (${skrevet.length} tegn)`,
      staar.laengde === skrevet.length && skrevet.startsWith(staar.start.replace(/\s+$/, '')),
      `skrevet ${skrevet.length}, staar ${staar.laengde}: «${staar.start.slice(0, 60)}»`);
  }
  check(`${n}.3 ingen agent fejlede eller tog skaermen (${res.filter(r => r.status === 'bevist').length} bevist, ${res.filter(r => r.status === 'delvist').length} delvist)`,
    roede.length === 0, roede.map(r => `${r.nr} ${r.navn}: ${String(r.bevis).slice(0, 120)}`).join(' | '));
  check(`${n}.4 ingen agent naaede et program uden for sin liste`, res.every(r => !(r.stoppet || []).length && !(r.udenfor || []).length));
  for (const r of res) console.log(`     ${r.status.padEnd(8)} ${String(r.nr).padStart(3)} ${r.navn}: ${String(r.bevis).slice(0, 110)}`);
  // Sporet beholdes: uden det kan ingen se HVORFOR en agent fejlede (Astra/Opus, 1/10).
  rapport.push({ n, sek, film: filmSti, fund: fremmede, maaling: { puls: maaling.puls, umaalt: maaling.umaalt, skift: iRunden }, tegn: skrevet.length, res });
  console.log(`     ${n} agenter paa ${sek} s · film: ${filmSti || 'ingen'}`);
}
if (process.env.CMCP_PARALLEL_RAPPORT) writeFileSync(process.env.CMCP_PARALLEL_RAPPORT, JSON.stringify(rapport, null, 2));
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
