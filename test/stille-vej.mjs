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
import { FREMMED_MASKINE, ROER_GRUND } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⛔ MAALT 24/9: HER STOD KUN BYGGE-MAPPENS BINAER, og den var sidst skrevet
//    kl. 23:02 aftenen foer. Alle dagens rettelser laa i `vendor/`, som er den
//    binaer serveren og npm-pakken faktisk bruger. Proeven maalte altsaa
//    GAARSDAGENS kode - og en ny proeve af sloeringens tidsloft var roed mod en
//    binaer der slet ikke havde rettelsen.
//    Samme fejl blev fundet og rettet i redaction-unit.py 18/9, og i errors.mjs.
//    Den blev aldrig foert hertil. Nu samme raekkefoelge som de andre: den binaer
//    produktet sender ud, foerst.
const HJAELPER = [process.env.CMCP_HELPER,
                  join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper'),
                  join(ROOT, 'helper', '.build', 'release', 'cmcp-helper')]
                 .find(p => p && existsSync(p)) || join(ROOT, 'helper', '.build', 'release', 'cmcp-helper');
const fails = [];
// Sprunget over = bevist intet. Taelles i opsummeringen (run-all laeser «SPRUNGET OVER: N»).
const sprunget = [];
const sprang = (l, why) => { console.log(`SPR. ${l} - ${why}`); sprunget.push(l); };
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
  // ⛔ 24/9: her ventede proeven FAST 2,5 sek og skrev saa - og laeste feltet
  //    STRAKS bagefter. Alene gik det; under en fuld suite gav det «feltet
  //    indeholder null». To kapløb: feltet fandtes maaske ikke endnu da der blev
  //    skrevet, og tastetrykkene var maaske ikke behandlet da der blev laest.
  //    Samme klasse som i larmende-veje og e2e samme dag. Nu ventes paa feltet.
  const findFelt = () => (koer('inspect', '--app', NAVN, '--limit', '10').nodes || [])
                           .find(n => n.role === 'AXTextField');
  // Frist i tid, ikke i antal: ved load 20-30 (maalt 24/9) tager hvert inspect
  // selv flere sekunder. Og kom feltet aldrig, siges DET - ikke «feltet er null».
  const feltFrist = Date.now() + 60_000;
  let feltFandtes = !!findFelt();
  while (!feltFandtes && Date.now() < feltFrist) {
    await new Promise(r => setTimeout(r, 500)); feltFandtes = !!findFelt();
  }
  if (!feltFandtes) check('proevemaalets tekstfelt kom frem inden 60 sek', false, 'proeven skrev ikke blindt');

  // 2. Skriv ind i et program der IKKE er forrest, gennem dets egen koe.
  const TEKST = 'stille-' + Math.random().toString(36).slice(2, 8);
  const svar = koer('type', '--app', NAVN, '--text', TEKST);

  check('produktet siger selv at det ikke tog skaermen', svar.took_screen === false,
        JSON.stringify(svar));

  // 3. ...og teksten ankom faktisk. Uden det her maaler punkt 2 kun en paastand.
  // ...og vent til programmet har BEHANDLET tastetrykkene, i stedet for at
  // laese i samme oejeblik de blev sendt. Op til 30 sek.
  let tre = koer('inspect', '--app', NAVN, '--limit', '10');
  let felt = (tre.nodes || []).find(n => n.role === 'AXTextField');
  const laesFrist = Date.now() + 30_000;
  while (felt?.value !== TEKST && Date.now() < laesFrist) {
    await new Promise(r => setTimeout(r, 500));
    tre = koer('inspect', '--app', NAVN, '--limit', '10');
    felt = (tre.nodes || []).find(n => n.role === 'AXTextField');
  }
  check('og teksten ankom faktisk i programmet', felt?.value === TEKST,
        `feltet indeholder ${JSON.stringify(felt?.value ?? null)}`);

  // 3z. ⛔ Konsulenten 22/9: hjaelperen klippede feltvaerdier ved 200 tegn UDEN
  //     at sige det. Samme dag kostede det en forkert maaling: «40 tegn tabt»
  //     var 40 tegn klippet. Et svar der blev kappet, skal sige det.
  const LANG = 'x'.repeat(260);
  koer('set-value', '--app', NAVN, '--role', 'AXTextField', '--text', LANG);
  const langt = koer('inspect', '--app', NAVN, '--limit', '20');
  const lf = (langt.nodes || []).find(n => n.role === 'AXTextField');
  check('en klippet feltvaerdi siger at den blev klippet',
        lf?.value_cut === true && lf?.value_chars === 260 && lf?.value?.length === 200,
        `klippet=${lf?.value_cut} tegn=${lf?.value_chars} laengde=${lf?.value?.length}`);
  koer('set-value', '--app', NAVN, '--role', 'AXTextField', '--text', TEKST);

  // 3y. ⛔ MAALT 23/9: et Finder-vindue med mange filer fik et opslag til at
  //     tage 39,5 sekunder - over serverens graense paa 30, saa et helt
  //     almindeligt kald fejlede med «hjaelperen svarede ikke». Nu stopper
  //     gennemgangen paa tid og SIGER at svaret er en DEL af traeet.
  //     (Finder selv er ikke langsom: samme program uden det vindue svarer
  //     paa 0,2 sek. Det var tilstanden, ikke programmet.)
  const budget = JSON.parse(execFileSync(HJAELPER, ['inspect', '--app', NAVN, '--depth', '40', '--limit', '500'],
                  { encoding: 'utf8', timeout: 30000, env: { ...process.env, CMCP_BUDGET_SEK: '0' } }));
  check('en gennemgang der loeb toer for tid siger det',
        budget.stopped_early === true && /PART of the tree/.test(budget.note || ''),
        `stoppede=${budget.stopped_early} note=${(budget.note || '').slice(0, 40)}`);

  // 3x. ⛔ MAALT 24/9: SLOERINGENS TIDSLOFT BANDT IKKE DET DET HED EFTER.
  //     Tjekket laa inde i vindues-loekken og brugte `continue`, saa naar
  //     tiden var brugt, blev vi ved med at spoerge hvert resterende program.
  //     Maalt med et loft paa 10 sek: 13,76 · 13,88 · 21,25 sek. Paa en travl
  //     maskine sprang hele skaermbilledet derfor serverens graense paa 45.
  //
  //     Den naerliggende rettelse - bryde loekken - ville have SPRUNGET de
  //     resterende programmer over og dermed sloeret MINDRE. Den blev forkastet.
  //     Reglen er nu produktets egen, ét niveau op: naaede vi ikke igennem i
  //     tide, sloeres hele billedet. Aldrig mindre end foer - kun bundet.
  //
  //     Foer i dag fandtes kun et regex over kilden (paastand 44c). Det her er
  //     den foerste proeve der MAALER faldbagen.
  const t0s = Date.now();
  const sloer0 = JSON.parse(execFileSync(HJAELPER, ['secure-rects'],
                  { encoding: 'utf8', timeout: 30000, env: { ...process.env, CMCP_REDACT_BUDGET_SEK: '0' } }));
  const tidS = (Date.now() - t0s) / 1000;
  const skaerme = JSON.parse(execFileSync(HJAELPER, ['displays'], { encoding: 'utf8', timeout: 10000 })).displays;
  const venstre = Math.min(...skaerme.map(d => d.x));
  const hoejre  = Math.max(...skaerme.map(d => d.x + d.width));
  const r0 = sloer0.rects?.[0];
  // ⛔ AERLIGT OM HVAD DE TO TJEK BEVISER (mutation M20, 24/9):
  //    Med tidsloftet paa programlisten slaaet fra - den gamle adfaerd - blev
  //    DAEKNINGS-tjekket nedenfor roedt: den gamle kode gav kun et enkelt
  //    vindues rektangel (x -1920..0), ikke hele fladen. Det er beviset.
  //    TIDS-tjekket her forblev groent (0,07 sek), fordi den gamle kode med
  //    loft 0 ogsaa springer de dybe gennemgange over. Det skelner altsaa IKKE
  //    ny fra gammel. Den virkelige langsomhed kom af at spoerge mange
  //    programmer paa en travl maskine med et loft STOERRE end nul - og den
  //    kan ikke genskabes paa bestilling. Tjekket staar som en fornuftsgraense,
  //    ikke som bevis.
  check('sloeringens loft er bundet (fornuftsgraense - skelner ikke ny fra gammel)',
        tidS < 5, `${tidS.toFixed(2)} sek med loft 0`);
  // ⛔ SIKKERHEDSGENNEMGANG 24/9: tjekket her maalte KUN x. En fejl i y -
  //    og der VAR en: `heleSkaermen()` byggede paa Cocoa-rummet, hvor y vender
  //    opad - ville staa groent. Paa denne maskine ramte y rigtigt ved et
  //    tilfaelde (skaermene er bund-justerede). Nu maales begge akser.
  const top  = Math.min(...skaerme.map(d => d.y));
  const bund = Math.max(...skaerme.map(d => d.y + d.height));
  check('...og den sloerer HELE fladen - ikke kun det den naaede at finde',
        sloer0.count === 1 && !!r0 && r0.x <= venstre && r0.x + r0.w >= hoejre
          && r0.y <= top && r0.y + r0.h >= bund,
        r0 ? `rektangel x ${r0.x}..${r0.x + r0.w} y ${r0.y}..${r0.y + r0.h} mod skaermene x ${venstre}..${hoejre} y ${top}..${bund}` : 'ingen rektangel');

  // ⛔ A1 - MIN EGEN REGRESSION, FANGET AF EN SIKKERHEDSGENNEMGANG 24/9.
  //    Commit 589fac5 flyttede vindues-faldbagen fra inspect's loft (10) til
  //    sloeringens nye (30), og skrev «aldrig mindre sloering end foer». Det var
  //    falsk: vinduer naaet efter 10 sek fik en praecis gennemgang i stedet for
  //    at blive svaertet helt. Samme ting gjorde `CMCP_BUDGET_SEK` virkningsloes
  //    for sloeringen - man kunne saette den til 0 og intet skete.
  //    Beviset er ADFAERD, ikke et navn i kilden: med CMCP_BUDGET_SEK=0 skal
  //    HVERT vindue svaertes helt, straks. I regressionen kom der kun de smaa
  //    praecise felter - eller ingen.
  //    Maalt ved rettelsen mod foraelderens egen binaer (bygget fra 589fac5^):
  //    hvert rektangel foraelderen svaertede, daekkede den nye ogsaa.
  const vinA1 = JSON.parse(execFileSync(HJAELPER, ['windows'], { encoding: 'utf8', timeout: 30000 }));
  const antalVinduer = (vinA1.windows || []).length;
  const sloerV = JSON.parse(execFileSync(HJAELPER, ['secure-rects'],
                  { encoding: 'utf8', timeout: 30000, env: { ...process.env, CMCP_BUDGET_SEK: '0' } }));
  const store = (sloerV.rects || []).filter(r => r.w >= 100 && r.h >= 60).length;
  // ⛔ GENNEMGANGEN HAVDE INTET LOFT INDENI (sikkerhedsgennemgang 24/9).
  //    Tidsloftet var kun en PORT foer hvert vindue; gennemgangen af ét vindue
  //    kunne loebe frit. Maalt alene: skaermbilledet svigtede én af to gange
  //    (82 sek, over serverens 45). Nu stopper gennemgangen og svaerter vinduet.
  //    Et lille positivt budget lader porten slippe det foerste vindue igennem,
  //    saa det er GENNEMGANGEN der skal stoppe - ikke porten.
  //    Maalt med loftet fjernet (M22): 1,17 / 16,19 / 11,32 sek, og ét vindue
  //    faerre svaertet helt. Med loftet: 0,65-0,81 sek hver gang.
  //    ⛔ Aerligt: ikke deterministisk - én af tre mutanter slap igennem. Derfor
  //    tre koersler, og ALLE skal holde. En mutant skal vaere heldig tre gange.
  const walkTider = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    execFileSync(HJAELPER, ['secure-rects'], { encoding: 'utf8', timeout: 60000,
      env: { ...process.env, CMCP_BUDGET_SEK: '0.05', CMCP_REDACT_BUDGET_SEK: '1000' } });
    walkTider.push((Date.now() - t) / 1000);
  }
  check('gennemgangen af ét vindue er bundet - den stopper og svaerter i stedet for at haenge',
        walkTider.every(x => x < 5), walkTider.map(x => x.toFixed(2) + ' s').join(' · '));

  // ⛔ 24/9, SAMME DAG: den foerste udgave af det her tjek var USUND. Den kraevede
  //    `store >= antalVinduer` - men `windows` taeller ogsaa vinduer paa ANDRE
  //    skriveborde og minimerede vinduer, som sloeringen med rette springer over
  //    (den ser kun paa programmer der er fremme). To forskellige populationer.
  //    Den bestod ved et tilfaelde (15/11, 9/7, 8/7) og fejlede saa: 4 mod 6, paa
  //    kode der ikke var aendret. Et tjek der kan fejle af den forkerte grund,
  //    laerer folk at ignorere roedt.
  //    Det sunde invariant: min regression (M21) gav NUL hele vinduer - loftet
  //    virkede slet ikke. Rettelsen giver mindst ét, saa laenge noget er fremme.
  //
  //    ⛔ OG MAALT BAGEFTER: dette tjek skelner IKKE laengere M21 fra rettelsen -
  //    og det er rigtigt. Gennemgangs-loftet (tilfoejet i tredje runde) bruger ogsaa
  //    10-sekunders-graensen, saa selv med vindues-reglen brudt stopper gennemgangen
  //    straks og svaerter vinduet helt. MAALT: M21 daekker 0 af rettelsens rektangler
  //    MINDRE, i begge budgetter. To uafhaengige lag; ingen af dem alene er baerende.
  //    Den DISKRIMINERENDE vagt er gennemgangs-loftets tjek ovenfor (M22 -> roed).
  //    Dette staar tilbage som en fornuftsgraense: loftet giver hele vinduer.
  check('med CMCP_BUDGET_SEK=0 svaertes vinduer HELT - loftet styrer sloeringen igen',
        antalVinduer > 0 && store >= 1,
        `${store} hele vinduer svaertet (${antalVinduer} almindelige vinduer i alt, ogsaa paa andre skriveborde)`);
  // LAEST, ikke maalt: i den rigtige skaermbilledsvej (Capture.swift) sendes
  // optagelsens eget omraade altid med, saa faldbagen bliver praecis det
  // optagne omraade i optagelsens eget koordinatrum. Hele-skaermen-grenen
  // ovenfor rammer kun den bare kommando. At maale det i skaermbilledsvejen
  // kraever et billede af menneskets skaerm, og det tager vi ikke.

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
  const forrest = FREMMED_MASKINE ? koer('focused') : null;
  const forrestNavn = forrest?.element?.app;
  if (!FREMMED_MASKINE) {
    sprang('leverer vi i det program mennesket SIDDER i, indroemmer den det', ROER_GRUND);
  } else if (forrestNavn) {
    const eget = koer('scroll', '--dx', '0', '--dy', '0', '--app', forrestNavn);
    check('leverer vi i det program mennesket SIDDER i, indroemmer den det',
          eget.took_screen === true, `${forrestNavn}: ${JSON.stringify(eget)}`);
  } else {
    sprang('leverer vi i det program mennesket SIDDER i, indroemmer den det', 'intet forreste program at maale mod');
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
  if (FREMMED_MASKINE) {
    const globalt = koer('scroll', '--dx', '0', '--dy', '0');
    check('uden modtager indroemmer den at den tog skaermen', globalt.took_screen === true,
          globalt.why ? 'med begrundelse' : 'UDEN begrundelse');
  } else {
    sprang('uden modtager indroemmer den at den tog skaermen', ROER_GRUND);
  }

  // 5. Et program der ikke koerer, er en FEJL - ikke en stille tilbagefalden
  //    til den globale stroem. Et tastetryk der lander et andet sted end
  //    agenten bad om, er praecis det der goer at man ikke kan lade den koere.
  let faldtTilbage = true;
  // ⛔ 24/9: tom tekst. Med «x» ville en regression (tilbagefald til den globale
  //    stroem) skrive x'et i det felt mennesket skriver i. Fejlvejen er den samme.
  try { koer('type', '--app', 'findes-ikke-' + Date.now(), '--text', ''); }
  catch (e) {
    const ud = JSON.parse(String(e.stdout || '{}'));
    faldtTilbage = ud.code !== 'app-not-found';
  }
  check('ukendt program afvises i stedet for at ramme et andet vindue', !faldtTilbage);
} finally {
  luk();
}

console.log();
if (sprunget.length) console.log(`SPRUNGET OVER: ${sprunget.length} (bevist intet - ikke bestaaet)`);
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
