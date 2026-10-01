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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = (ms) => new Promise(r => setTimeout(r, ms));
const osa = (s) => execFileSync('osascript', ['-e', s], { encoding: 'utf8' }).trim();

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
const ARBEJDERE = (EGEN ? [14, 4, 13] : [14, 15, 9, 4, 17, 5, 13, 6]).map(nr => SCENARIER.find(s => s.nr === nr)).filter(Boolean);
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
function startMenneske() {
  // ⛔ Koersel 36832790982 (1/10): «make new document» ventede paa TextEdits
  //    aabne-panel (iCloud) ved foerste start og loeb ud efter 2 min. En tom fil
  //    aabnet direkte giver et dokumentvindue uden panelet.
  const d = mkdtempSync(join(tmpdir(), 'cmcp-parallel-'));
  const fil = join(d, 'menneske.txt');
  writeFileSync(fil, '');
  execFileSync('open', ['-a', 'TextEdit', fil]);
  for (let i = 0; i < 40; i++) {
    try { if (Number(osa('tell application "TextEdit" to count documents')) > 0) break; } catch {}
    execFileSync('sleep', ['0.5']);
  }
  osa('tell application "TextEdit" to activate');
  execFileSync('sleep', ['1.5']);
  // Sin egen proces: tastaturet maa ikke bremse proevens egen haendelsesloekke.
  const log = join(d, 'skrevet.txt'), stop = join(d, 'stop');
  const p = spawn('bash', ['-c', `i=0; while [ ! -f "${stop}" ]; do
      osascript -e "tell application \\"System Events\\" to keystroke \\"m$i \\"" && printf "m$i " >> "${log}"
      i=$((i+1)); sleep 0.12; done`], { stdio: 'ignore' });
  const slut = new Promise(r => p.on('close', r));
  return {
    async slut() { writeFileSync(stop, ''); await slut; await vent(800); return existsSync(log) ? readFileSync(log, 'utf8') : ''; },
    tekst: () => osa('tell application "TextEdit" to get text of document 1'),
    luk() { try { osa('tell application "TextEdit" to close every document saving no'); } catch {} },
  };
}

// Vagten udefra: hvad der staar forrest, hvert 100. ms, i én proces.
function startForrestVagt() {
  const js = `ObjC.import('AppKit'); var w=$.NSWorkspace.sharedWorkspace; var f='';
    while (true) { var b = ObjC.unwrap(w.frontmostApplication.bundleIdentifier); if (b !== f) { f = b; console.log(Date.now() + ' ' + b); } delay(0.1); }`;
  const p = spawn('osascript', ['-l', 'JavaScript', '-e', js], { stdio: ['ignore', 'ignore', 'pipe'] });
  let ud = '';
  p.stderr.on('data', d => { ud += d; });   // console.log i JXA skriver paa stderr
  return { stop() { try { p.kill(); } catch {} return ud.trim().split('\n').filter(Boolean).map(l => l.split(' ')); } };
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
  const menneske = FREMMED ? startMenneske() : null;
  if (menneske) await vent(1500);
  const film = FREMMED ? startFilm(`parallel-${n}-agenter`) : { stop: async () => null };
  const vagt = startForrestVagt();
  await vent(800);
  const t0 = Date.now();
  const res = await Promise.all(hold.map(s => koerScenarie(s, { film: false, menneskeArbejder: EGEN })));
  const sek = ((Date.now() - t0) / 1000).toFixed(1);
  await vent(2500);   // et program kan hente sig selv frem sekunder efter (Kontakter, 27/9)
  const skift = vagt.stop();
  const skrevet = menneske ? await menneske.slut() : '';
  const staar = menneske ? menneske.tekst() : '';
  const filmSti = await film.stop();
  menneske?.luk();

  const roede = res.filter(r => r.status === 'fejlede');
  let fremmede;
  if (FREMMED) {
    fremmede = skift.filter(([, b]) => b !== 'com.apple.TextEdit');
    check(`${n}.1 forrest: TextEdit hele vejen (${skift.length} maaling(er) af skift)`, fremmede.length === 0,
      fremmede.map(([t, b]) => `${b} efter ${((t - t0) / 1000).toFixed(1)} s`).join(', '));
    check(`${n}.2 menneskets tekst er intakt (${skrevet.length} tegn)`, staar.replace(/\s+$/, '') === skrevet.replace(/\s+$/, ''),
      `skrevet ${skrevet.length}, staar ${staar.length}: «${staar.slice(0, 80)}»`);
  } else {
    // Mennesket skifter selv program. Kun agenternes egne programmer foran er en fejl.
    const agentApps = new Set(hold.flatMap(s => s.apps).filter(a => a !== 'com.apple.finder'));
    fremmede = skift.filter(([, b]) => agentApps.has(b));
    check(`${n}.1 ingen agents program kom frem foran dig (${skift.length} skift maalt, dine egne: ${skift.length - fremmede.length})`, fremmede.length === 0,
      fremmede.map(([t, b]) => `${b} efter ${((t - t0) / 1000).toFixed(1)} s`).join(', '));
  }
  check(`${n}.3 ingen agent fejlede (${res.filter(r => r.status === 'bevist').length} bevist, ${res.filter(r => r.status === 'delvist').length} delvist)`,
    roede.length === 0, roede.map(r => `${r.nr} ${r.navn}: ${String(r.bevis).slice(0, 120)}`).join(' | '));
  check(`${n}.4 ingen agent naaede et program uden for sin liste`, res.every(r => !(r.stoppet || []).length && !(r.udenfor || []).length));
  for (const r of res) console.log(`     ${r.status.padEnd(8)} ${String(r.nr).padStart(3)} ${r.navn}: ${String(r.bevis).slice(0, 110)}`);
  rapport.push({ n, sek, film: filmSti, forrestSkift: fremmede.length, tegn: skrevet.length, res: res.map(({ spor, ...r }) => r) });
  console.log(`     ${n} agenter paa ${sek} s · film: ${filmSti || 'ingen'}`);
}
if (process.env.CMCP_PARALLEL_RAPPORT) writeFileSync(process.env.CMCP_PARALLEL_RAPPORT, JSON.stringify(rapport, null, 2));
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
