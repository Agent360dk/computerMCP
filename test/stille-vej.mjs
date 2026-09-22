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

// ⛔ FUNDET AF MODSTANDER-REVIEWET 21/9: filen sprang over ad TRE veje og
//    afsluttede med exit 0, som `run-all.sh` taeller som BESTAAET. «Den
//    stille vej BESTAAET» kunne altsaa betyde at intet blev maalt - praecis
//    den fejlklasse `CMCP_KRAEV_BINAER` blev lavet for én fil vaek.
const KRAEV = process.env.CMCP_KRAEV_STILLE === '1';
const spring = (hvorfor) => {
  if (KRAEV) { console.log(`DUMP maalingen blev sprunget over: ${hvorfor}`); process.exit(1); }
  console.log(`UMAALT  ${hvorfor} - saet CMCP_KRAEV_STILLE=1 for at kraeve den`);
  process.exit(0);
};

if (!existsSync(HJAELPER)) spring('hjaelperen er ikke bygget - koer swift build -c release i helper/');

// 1. Byg proevemaalet.
const ARB = mkdtempSync(join(tmpdir(), 'cmcp-stille-'));
// ⛔ Eget navn pr. koersel. Foerste udgave hed altid «proevemaal», og
//    `--app proevemaal` rammer efter NAVN - saa en efterladt attrap fra en
//    tidligere koersel tog imod, og feltet indeholdt to koerslers tekst.
//    Proeven maalte en anden proces end den den startede.
const NAVN = 'cmcpproeve' + Math.random().toString(36).slice(2, 8);
const MAAL = join(ARB, NAVN);
try {
  execFileSync('swiftc', ['-O', join(ROOT, 'test', 'fixture', 'proevemaal.swift'), '-o', MAAL],
               { stdio: 'pipe', timeout: 180000 });
} catch (e) {
  rmSync(ARB, { recursive: true, force: true });
  spring('proevemaalet kunne ikke bygges: ' + String(e.message).slice(0, 60));
}

const barn = spawn(MAAL, { stdio: ['ignore', 'pipe', 'ignore'] });
let pid = null;
await new Promise((res) => {
  barn.stdout.on('data', (b) => { const m = /pid=(\d+)/.exec(String(b)); if (m) { pid = Number(m[1]); res(); } });
  setTimeout(res, 8000);
});
const luk = () => { try { barn.kill(); } catch { /* videre */ } rmSync(ARB, { recursive: true, force: true }); };
if (!pid) { luk(); spring('proevemaalet startede ikke'); }
await new Promise(r => setTimeout(r, 2500));

const koer = (...a) => JSON.parse(execFileSync(HJAELPER, a, { encoding: 'utf8', timeout: 30000 }));

try {
  // 2. Skriv ind i et program der IKKE er forrest, gennem dets egen koe.
  const TEKST = 'stille-' + Math.random().toString(36).slice(2, 8);
  const svar = koer('type', '--app', NAVN, '--text', TEKST);

  check('produktet siger selv at det ikke tog skaermen', svar.took_screen === false,
        JSON.stringify(svar));

  // 3. ...og teksten ankom faktisk. Uden det her maaler punkt 2 kun en paastand.
  const tre = koer('inspect', '--app', NAVN, '--limit', '10');
  const felt = (tre.nodes || []).find(n => n.role === 'AXTextField');
  check('og teksten ankom faktisk i programmet', felt?.value === TEKST,
        `feltet indeholder ${JSON.stringify(felt?.value ?? null)}`);

  // 3a. ⛔ Fundet 22/9 af mennesket, ikke af proeverne: attrappens vindue
  //     laa midt paa hans skaerm hele dagen, fordi macOS flytter et vindue
  //     med titellinje ind paa skaermen. Proeverne maalte alt andet end det.
  const vin = (tre.nodes || []).find(n => n.role === 'AXWindow');
  check('attrappens vindue ligger uden for enhver skaerm', (vin?.frame?.x ?? 0) < -10000,
        `vinduet ligger paa ${JSON.stringify(vin?.frame ?? null)}`);

  // 3b. ⛔ FUND 3, Critical, fra modstander-reviewet: at levere i ét programs
  //     koe er kun stille hvis det program ikke er DET mennesket sidder i.
  //     Skriver vi i Chrome mens han skriver i Chrome, lander teksten i hans
  //     felt. Markoeren staar stille og forgrunden skifter ikke - begge dele
  //     sande, maalingen forkert. Tredje udgave af samme fejl paa én dag.
  //
  //     Maales mod det program der ER forrest lige nu, uanset hvilket:
  //     et nul-rul ind i dets egen koe kan ingen maerke.
  const forrest = koer('focused');
  const forrestNavn = forrest?.element?.app;
  if (forrestNavn) {
    const eget = koer('scroll', '--dx', '0', '--dy', '0', '--app', forrestNavn);
    check('leverer vi i det program mennesket SIDDER i, indroemmer den det',
          eget.took_screen === true, `${forrestNavn}: ${JSON.stringify(eget)}`);
  } else {
    console.log('UMAALT  intet forreste program at maale mod');
  }

  // 3c. ⛔ LAESERETNINGEN. Fundet af et modstander-review 22/9: traeet blev
  //     gennemgaaet med en stak og `popLast()`, saa soeskende lagt i
  //     raekkefoelge blev besoegt BAGFRA. `find` svarede i omvendt
  //     laeseretning - og `press`, `set_value` og `wait_for` bruger alle
  //     `hits.first`. En agent der bad om «den foerste knap» fik den sidste.
  //
  //     Det kan KUN maales paa soeskende under samme foraelder med kendt
  //     orden. Global x duer ikke: et rigtigt program har knapper i flere
  //     vaerktoejslinjer paa forskellige hoejder, og saa er x blandet uanset.
  //     (`inspect`, ikke `find`: find returnerer ikke titler for knapper.)
  const orden = koer('inspect', '--app', NAVN, '--limit', '60');
  const numre = (orden.nodes || [])
    .map(m => /^orden-(\d)$/.exec(m.title || ''))
    .filter(Boolean).map(m => Number(m[1]));
  check('soeskende kommer i laeseretning, ikke bagfra',
        numre.length === 3 && numre[0] === 1 && numre[1] === 2 && numre[2] === 3,
        `raekkefoelge: ${numre.join(', ') || 'fandt dem ikke'}`);

  // 3d. ⛔ «IT DOES NOT PRETEND». macOS svarer «success» paa at saette en
  //     vaerdi paa et element der ikke kan skrives - og aendrer intet.
  //     `set_value` returnerede `set: true` paa den oplysning. Nu laeser den
  //     efter. Kalibreret begge veje: et tekstfelt SKAL bekraeftes, en
  //     rullemenu SKAL afvises.
  const saetFelt = koer('set-value', '--app', NAVN, '--role', 'AXTextField', '--text', 'bekraeftet-x');
  check('set_value paa et tekstfelt bekraeftes', saetFelt.ok === true && saetFelt.verified === true,
        JSON.stringify({ ok: saetFelt.ok, verified: saetFelt.verified }));

  let loej = true;
  try { koer('set-value', '--app', NAVN, '--role', 'AXPopUpButton', '--text', 'rulle-B'); }
  catch (e) {
    const ud = JSON.parse(String(e.stdout || '{}'));
    loej = ud.code !== 'set-ignored';
  }
  check('set_value paa en rullemenu der ignorerer det, paastaar IKKE succes', !loej);

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
