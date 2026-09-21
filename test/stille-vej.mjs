// DEN STILLE VEJ: kan agenten skrive i et program uden at tage skaermen?
//
// ⛔ HVORFOR DEN FINDES (21/9-2026)
//    Produktets loefte er «computer use you can actually leave running».
//    Indtil i dag afgjorde en HAANDSKREVET NAVNELISTE hvilke vaerktoejer der
//    «tager skaermen». En liste er en hensigt, ikke en maaling.
//
//    Det der faktisk tager skaermen er LEVERINGSKANALEN:
//      post(tap: .cghidEventTap)  -> den globale stroem. Lander i det vindue
//                                    mennesket bruger. Tager tastaturet.
//      event.postToPid(pid)       -> ét programs egen koe. Roerer intet andet.
//
//    Proeven koerer den paa et proevemaal VI EJER: et vindue paa (-20000,
//    -20000), uden for enhver skaerm, uden Dock-ikon. Foerste forsoeg brugte
//    TextEdit - den genskabte menneskets EGNE dokumenter. Et instrument der
//    kan roere brugerens data er forkert instrument.
//
// ⛔ Proeven sender ALDRIG et tastetryk i den globale stroem. Den ville lande
//    i det vindue mennesket sidder i. Den ene C-kanal-paastand proeves med et
//    nul-rul, som ingen kan maerke.
//
// ⛔ OG DET SAMME GAELDER MUTATIONERNE. Betalt to gange 21/9, samme dag som
//    filen blev skrevet: en mutation der fik `modtager()` til at returnere nil
//    sendte proevens egen tekst ud i den globale stroem, og den landede i
//    menneskets Chrome-fane. Et `type --text x` uden modtager gjorde det samme
//    en time foer.
//
//    Reglen naar du mutationsbeviser den her fil: MUTÉR ALDRIG NOGET DER KAN
//    FAA EN HANDLING TIL AT GAA AD KANAL C. Muter i stedet det der BESKRIVES
//    (svarets felter) eller det der leveres TIL (post til pid 1, launchd, som
//    ingen brugerflade har). Begge dele goer proeven roed uden at nogen maerker
//    det. De tre der er brugt:
//      M1  postToPid(1)             -> teksten ankommer ikke. Roed paa punkt 2
//      M2  took_screen altid falsk  -> roed paa punkt 4
//      M3  modtager() returnerer nil -> roed paa 1, 2 og 5, MEN ramte mennesket.
//          Gentag den ikke paa en maskine der er i brug.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HJAELPER = process.env.CMCP_HELPER || join(ROOT, 'helper', '.build', 'release', 'cmcp-helper');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

if (!existsSync(HJAELPER)) {
  console.log('SPRUNGET OVER  hjaelperen er ikke bygget - koer swift build -c release i helper/');
  process.exit(0);
}

// 1. Byg proevemaalet.
const ARB = mkdtempSync(join(tmpdir(), 'cmcp-stille-'));
const MAAL = join(ARB, 'proevemaal');
try {
  execFileSync('swiftc', ['-O', join(ROOT, 'test', 'fixture', 'proevemaal.swift'), '-o', MAAL],
               { stdio: 'pipe', timeout: 180000 });
} catch (e) {
  console.log('SPRUNGET OVER  proevemaalet kunne ikke bygges:', String(e.message).slice(0, 80));
  rmSync(ARB, { recursive: true, force: true });
  process.exit(0);
}

const barn = spawn(MAAL, { stdio: ['ignore', 'pipe', 'ignore'] });
let pid = null;
await new Promise((res) => {
  barn.stdout.on('data', (b) => { const m = /pid=(\d+)/.exec(String(b)); if (m) { pid = Number(m[1]); res(); } });
  setTimeout(res, 8000);
});
const luk = () => { try { barn.kill(); } catch { /* videre */ } rmSync(ARB, { recursive: true, force: true }); };
if (!pid) { console.log('SPRUNGET OVER  proevemaalet startede ikke'); luk(); process.exit(0); }
await new Promise(r => setTimeout(r, 2500));

const koer = (...a) => JSON.parse(execFileSync(HJAELPER, a, { encoding: 'utf8', timeout: 30000 }));

try {
  // 2. Skriv ind i et program der IKKE er forrest, gennem dets egen koe.
  const TEKST = 'stille-' + Math.random().toString(36).slice(2, 8);
  const svar = koer('type', '--app', 'proevemaal', '--text', TEKST);

  check('produktet siger selv at det ikke tog skaermen', svar.took_screen === false,
        JSON.stringify(svar));

  // 3. ...og teksten ankom faktisk. Uden det her maaler punkt 2 kun en paastand.
  const tre = koer('inspect', '--app', 'proevemaal', '--limit', '10');
  const felt = (tre.nodes || []).find(n => n.role === 'AXTextField');
  check('og teksten ankom faktisk i programmet', felt?.value === TEKST,
        `feltet indeholder ${JSON.stringify(felt?.value ?? null)}`);

  // 4. KALIBRERING DEN ANDEN VEJ: uden modtager SKAL den indroemme det.
  //    Et nul-rul er den eneste globale handling ingen kan maerke.
  const globalt = koer('scroll', '--dx', '0', '--dy', '0');
  check('uden modtager indroemmer den at den tog skaermen', globalt.took_screen === true,
        globalt.why ? 'med begrundelse' : 'UDEN begrundelse');

  // 5. Et program der ikke koerer, er en FEJL - ikke en stille tilbagefalden
  //    til den globale stroem. Et tastetryk der lander et andet sted end
  //    agenten bad om, er praecis det der goer at man ikke kan lade den koere.
  let faldtTilbage = true;
  try { koer('type', '--app', 'findes-ikke-' + Date.now(), '--text', 'x'); }
  catch (e) {
    const ud = JSON.parse(String(e.stdout || '{}'));
    faldtTilbage = ud.code !== 'app-not-found';
  }
  check('ukendt program afvises i stedet for at ramme et andet vindue', !faldtTilbage);
} finally {
  luk();
}

console.log();
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
