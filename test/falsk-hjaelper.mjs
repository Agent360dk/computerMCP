// En hjaelper der ikke kan roere skaermen.
//
// ⛔ FUNDET AF RAADGIVEREN 19/9. Tre af proeverne beder om en AEGTE handling og
//    regner med at porten afviser den: `failclosed.mjs` klikker i (5,5) - som
//    er Apple-menuen - `server-e2e.mjs` klikker i (10,10), og `concurrent.mjs`
//    sender escape to gange. Saa laenge porten er groen, naar intet frem.
//
//    Men proeverne findes jo netop for det tilfaelde hvor porten IKKE er groen.
//    En roed port under en proevekoersel ville altsaa aabne Apple-menuen paa
//    den skaerm mennesket sidder og arbejder ved - og det er praecis den
//    klasse afbrydelse Gustav har bedt fire gange om at slippe for.
//
//    Seam'en fandtes allerede (`CMCP_HELPER`, brugt i paastand 8). Den bruges
//    nu i ALLE port-proever: bryder porten sammen, lander handlingen i en
//    tekstfil i stedet for paa skaermen, og proeven kan stadig se at den kom.
import { writeFileSync, chmodSync, mkdtempSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawn, spawnSync } from 'child_process';
import { tmpdir } from 'os';

export function lavFalskHjaelper(navn = 'cmcp-falsk') {
  const dir = mkdtempSync(join(tmpdir(), navn + '-'));
  // Den rigtige hjaelper - opslag sendes videre dertil, saa proeverne stadig
  // maaler virkeligheden. Findes den ikke, svarer attrappen selv.
  const ROD = new URL('..', import.meta.url).pathname;
  const rigtig = [join(ROD, 'mcp-server', 'vendor', 'cmcp-helper'),
                  join(ROD, 'helper', '.build', 'release', 'cmcp-helper')]
                 .find(p => existsSync(p)) || '/usr/bin/false';
  const spor = join(dir, 'kaldt.jsonl');
  const js = join(dir, 'h.mjs');
  // ⛔ Foerste udgave slugte ALT og faeldede syv aegte tjek i server-e2e:
  //    proeven spoerger om skaermbilleder, vinduer og rettigheder, og fik
  //    {ok:true} tilbage. En attrap der svarer forkert paa det den ikke skal
  //    beskytte imod, er ikke en beskyttelse - den er en ny fejlkilde.
  //
  //    Derfor: OPSLAG sendes videre til den rigtige hjaelper og svarer sandt.
  //    Kun HANDLINGER - dem der kan roere skaermen - sluges og noteres.
  writeFileSync(js, `
import { appendFileSync, writeSync } from 'fs';
import { spawnSync } from 'child_process';
const argv = process.argv.slice(2);
const kommando = argv[0] || '';
// ⛔ FUNDET 22/9: her stod en liste over HANDLINGER der skulle sluges -
//    'menu', 'window' - mens hjaelperens rigtige kommandoer hedder
//    'menu-click', 'window-button', 'window-set', 'set-value' og 'drag'.
//    De fem gik lige igennem til den AEGTE hjaelper. En proeve bad Finder om
//    «File > Move to Trash» og slap kun fordi menuerne er paa dansk.
//    En liste over hvad der er farligt, er altid ufuldstaendig. Nu er det
//    omvendt: kun kendte OPSLAG sendes videre, alt andet sluges.
const OPSLAG = new Set(['apps','displays','find','focused','inspect','menus','permissions',
                        'redact','screenshot','secure-rects','version','wait-for','windows',
                        'at']);   // 'at' spoerger hvem der ejer et punkt - rent opslag
appendFileSync(${JSON.stringify(spor)}, JSON.stringify({ argv, ts: Date.now() }) + '\\n');
if (!OPSLAG.has(kommando)) {
  writeSync(1, JSON.stringify({ ok: true, note: 'attrap - intet blev udfoert' }) + '\\n');
  process.exit(0);
}
// alt andet er et opslag: lad den rigtige hjaelper svare sandt
// ⛔ FUNDET 20/9: her stod \`input: ''\`, altsaa TOM stdin. Da soegestrenge
// flyttede fra argumenter til stdin, forsvandt de undervejs i attrappen - og
// \`wait-for\` fandt straks det foerste element i stedet for at vente.
// Proeven maalte attrappen, ikke produktet. En attrap der taber en del af
// kaldet, er ikke en attrap; den er en anden kode.
//
// Foerste rettelse laeste stdin selv og sendte den videre. Den haengte hele
// suiten: readFileSync(0) venter i det uendelige naar der ingen stdin er.
// Anden rettelse laeste kun ved --match-stdin, og saa forsvandt den ALLIGEVEL
// et sted mellem laesning og videresendelse.
//
// Det enkleste er ogsaa det rigtige: lad barnet ARVE stdin. Saa er der ingen
// mellemled der kan tabe den.
const ind = ${JSON.stringify(rigtig)};
// ⛔ 24/9: uden maxBuffer klippede Node et stort inspect-svar (standardloft) til
//    ugyldig JSON - attrappen svarede FORKERT paa et opslag den skulle videregive.
const r = spawnSync(ind, argv, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
// ⛔ 24/9: process.stdout.write til et ROER er asynkron, og process.exit lige
//    efter klippede store svar (inspect af Finder) til ugyldig JSON. Synkront nu.
writeSync(1, r.stdout || '');
writeSync(2, r.stderr || '');
process.exit(r.status === null ? 1 : r.status);
`);
  const wrapper = join(dir, 'w.sh');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  return {
    sti: wrapper,
    /// Hvad naaede frem til hjaelperen? Tom liste = porten holdt.
    kald() {
      if (!existsSync(spor)) return [];
      return readFileSync(spor, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    },
    /// ⛔ FUNDET I REVIEWET 20/9, og det er den vaerste slags fund: FEM
    ///    paastande laeste sporfilen i samme oejeblik serveren blev draebt, uden
    ///    at vente paa at attrappen havde skrevet den. De bestod paa et
    ///    KAPLOEB, ikke paa en maaling. Maalt: et drag naaede faktisk
    ///    hjaelperen, mens paastanden sagde "intet naaede frem".
    ///
    ///    En paastand om at noget IKKE skete, er lige saa afhaengig af
    ///    instrumentet som en paastand om at noget skete - og den ser meget
    ///    mere overbevisende ud.
    async roligt(ms = 500) { await new Promise(r => setTimeout(r, ms)); return this; },

    /// Naaede en HANDLING frem? (opslag som `frontmost` er harmloese)
    ///
    /// ⛔ FUNDET I REVIEWET 20/9. Her stod en HAANDHOLDT liste over handlinger -
    ///    og `drag` var aldrig blevet skrevet paa den. Resultatet: paastand 22b
    ///    sagde "intet naaede frem" mens attrappen havde modtaget et drag.
    ///    Vagten kunne ikke blive roed, uanset hvad porten gjorde.
    ///
    ///    Tredje gang samme dag at en liste nogen skal huske at udvide, ER
    ///    hullet. Vendt om: alt er en handling, undtagen de opslag vi ved er
    ///    harmloese. Et nyt vaerktoej er daekket den dag det skrives.
    handlingerNaaedeFrem() {
      const OPSLAG = new Set(['version', 'permissions', 'apps', 'windows', 'displays',
                              'menus', 'inspect', 'find', 'focused', 'audit', 'wait-for',
                              'secure-rects', 'screenshot', 'redact', 'at']);
      return this.kald().filter(k => !OPSLAG.has(k.argv[0]));
    }
  };
}

/// En spoerger der ikke kan vise noget.
///
/// ⛔ Uden den kunne samtykke-porten kun proeves ved at vise en aegte hvid boks
///    paa menneskets skaerm. MAALT i den rigtige revisionslog: 323 gange paa to
///    dage. Naesten alle fra proevekoersler.
///
///    Attrappen skriver de strenge osascript skriver, gennem den RIGTIGE
///    svar-tolkning i policy.js. ⚠️ Strengene er indtil videre SKREVET, ikke
///    optaget: den ene ting der stadig kraever en aegte dialog er at
///    `giving up after N` faktisk producerer `gave up:true`. Den kontrakt skal
///    optages een gang - 1 boks, 1 sekund - naar mennesket siger ja. Indtil da
///    er attrappen god nok til at bevise VORES logik, ikke OS'ets.
export function lavFalskSpoerger(svar = 'udloeb', navn = 'cmcp-spoerger') {
  const dir = mkdtempSync(join(tmpdir(), navn + '-'));
  const spor = join(dir, 'spurgt.jsonl');
  const js = join(dir, 's.mjs');
  // ⛔ FUNDET 22/9: attrappen svarede «Ja», og koden leder efter «Yes».
  //    `policy.js:290` tester `/button returned:Yes/`. Stubben blev skrevet da
  //    dialogen var paa dansk; koden blev engelsk (husets vagt 27 kraever det),
  //    og attrappen fulgte ikke med. Ethvert `lavFalskSpoerger('ja')` har
  //    dermed maalt et NEJ - en proeve der troede den gav samtykke, og som
  //    derfor aldrig kunne se hvad der sker EFTER et ja.
  //
  //    Knapteksterne staar to steder i policy.js: {"No","Yes"} for den
  //    almindelige port og {"Cancel","Done"} for `computer_ask_user`.
  const udskrift = svar === 'ja' ? 'button returned:Yes, gave up:false'
                 : svar === 'faerdig' ? 'button returned:Done, gave up:false'
                 : svar === 'nej' ? 'button returned:No, gave up:false'
                 : 'button returned:, gave up:true';
  writeFileSync(js, `
import { appendFileSync } from 'fs';
appendFileSync(${JSON.stringify(spor)}, JSON.stringify({ argv: process.argv.slice(2), ts: Date.now() }) + '\\n');
process.stdout.write(${JSON.stringify(udskrift)} + '\\n');
`);
  const wrapper = join(dir, 'w.sh');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  return {
    sti: wrapper,
    /// Hvor mange gange blev mennesket forsoegt spurgt? 0 = porten holdt foer den naaede dialogen.
    gangeSpurgt() {
      if (!existsSync(spor)) return 0;
      return readFileSync(spor, 'utf8').trim().split('\n').filter(Boolean).length;
    },
    /// HVAD mennesket fik at se. Et samtykke kan kun vaere informeret, hvis
    /// teksten siger hvad der godkendes - det maaler `gangeSpurgt` ikke.
    tekster() {
      if (!existsSync(spor)) return [];
      return readFileSync(spor, 'utf8').trim().split('\n').filter(Boolean)
        .map(l => { try { return JSON.parse(l).argv.join(' '); } catch { return ''; } });
    }
  };
}

/// Et adgangskodefelt der ikke kan ses.
///
/// ⛔ MAALT 19/9: paastand 3 og 10 - to KERNELOEFTER (vaerdien af et sikkert
///    felt forlader aldrig hjaelperen; set_value naegter at skrive i et) - blev
///    SPRUNGET OVER paa hver eneste koersel, fordi der ikke laa et
///    adgangskodefelt paa skaermen. "Bevist intet" stod der, hver gang.
///
///    Attrappen stiller selv feltet op. Vinduet er helt gennemsigtigt
///    (alphaValue 0), ligger bagest og tager ingen mus - det findes for
///    tilgaengeligheds-API'et og ikke for oejet.
///
///    ⛔ Foerste forsoeg lagde vinduet 30.000 punkter ude til venstre. macOS
///    klemte det IND igen (bad om x=-30000, endte paa x=255), og der blinkede
///    et vindue paa menneskets skaerm i otte sekunder. Uden for skaermen er
///    ikke en ting man kan bede om; gennemsigtighed er.
export function lavSikkertFelt(sekunder = 20, vaerdi = 'HEMMELIG-MAA-ALDRIG-UD', kunSikkert = false) {
  const bin = new URL('fixtures/sikkert-felt', import.meta.url).pathname;
  if (!existsSync(bin)) return null;
  const argv = [String(sekunder), vaerdi];
  if (kunSikkert) argv.push('kun-sikkert');
  const p = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'ignore'] });
  return {
    vaerdi,
    /// Venter til vinduet er oppe - ellers maaler proeven paa et trae der ikke findes endnu.
    ///
    /// ⛔ 24/9: «oppe» betoed «processen printede klar + 300 ms». Under en fuld suite
    ///    var tilgaengeligheds-traeet ikke bygget paa 300 ms, og proeverne fandt
    ///    «0 felt(er)». Femte proeve samme dag der ventede paa et TIDSPUNKT. Nu betyder
    ///    klar at FELTET kan findes gennem den binaer produktet sender ud - op til 10 sek.
    klar() {
      return new Promise((res) => {
        const tid = setTimeout(() => res(false), 5000);
        p.stdout.on('data', async (d) => {
          if (!String(d).includes('klar')) return;
          clearTimeout(tid);
          const rod = new URL('..', import.meta.url).pathname;
          const hj = [join(rod, 'mcp-server', 'vendor', 'cmcp-helper'),
                      join(rod, 'helper', '.build', 'release', 'cmcp-helper')].find(x => existsSync(x));
          if (!hj) return res(true);                      // ingen binaer: som foer
          const frist = Date.now() + 60_000;   // tid, ikke antal (load 15-30 maalt 24/9)
          while (Date.now() < frist) {
            const r = spawnSync(hj, ['find', '--app', 'sikkert-felt', '--role', 'AXTextField', '--limit', '1'],
                                { encoding: 'utf8', timeout: 10000 });
            try { if (JSON.parse(r.stdout.trim().split('\n').pop()).count > 0) return res(true); } catch {}
            await new Promise(r2 => setTimeout(r2, 500));
          }
          res(false);                                     // feltet kom aldrig: proeven skal vide det
        });
      });
    },
    luk() { try { p.kill(); } catch {} }
  };
}

/// Et "Gem / Gem ikke"-ark der ikke kan ses.
///
/// ⛔ Hul H8: et menneske moeder det ark ved HVER lukning med ugemt arbejde, og
///    spoergsmaalet - kan agenten naa knapperne i det - kunne ikke besvares,
///    fordi der aldrig laa et ark paa maskinen, og fordi det at fremkalde et
///    ville tage menneskets skaerm. Attrappen stiller selv arket op: baade
///    foraeldrevinduet og arket har alphaValue 0.
export function lavArk(sekunder = 20) {
  const bin = new URL('fixtures/ark', import.meta.url).pathname;
  if (!existsSync(bin)) return null;
  const p = spawn(bin, [String(sekunder)], { stdio: ['ignore', 'pipe', 'ignore'] });
  return {
    klar() {
      return new Promise((res) => {
        const tid = setTimeout(() => res(false), 5000);
        p.stdout.on('data', (d) => {
          if (String(d).includes('klar')) { clearTimeout(tid); setTimeout(() => res(true), 400); }
        });
      });
    },
    luk() { try { p.kill(); } catch {} }
  };
}

/// ⛔ SIKKERHEDSNET for proever der koerer mod den AEGTE hjaelper (24/9).
///
/// e2e og baggrund-stille proever at porten AFVISER «type x uden app». Svigter
/// porten, sendes x'et til den aegte hjaelper - og lander i det felt mennesket
/// skriver i. En proeve af en vagt maa ikke goere skade naar vagten svigter.
/// Indpakningen sender alt videre til den aegte hjaelper, UNDTAGEN input der
/// ikke navngiver et program: det stoppes, og det noteres saa proeven ogsaa
/// kan paastaa at intet naaede frem.
export function lavVagtHjaelper(aegte, navn = 'cmcp-vagthjaelper') {
  const dir = mkdtempSync(join(tmpdir(), navn + '-'));
  const spor = join(dir, 'stoppet.txt');
  const sti = join(dir, 'h.sh');
  writeFileSync(sti, `#!/bin/sh
case "$1" in
  type|key|scroll|click|move|drag|paste)
    case " $* " in
      *" --app "*) ;;
      *) printf '%s\\n' "$*" >> "${spor}"
         echo '{"ok":false,"code":"test-safety-net","error":"stopped by the test safety net: input without --app"}'
         exit 1 ;;
    esac ;;
esac
exec "${aegte}" "$@"
`);
  chmodSync(sti, 0o755);
  return {
    sti,
    /// Hvad forsoegte at naa Mac'en uden et program? Tom = porten holdt.
    stoppet() { return existsSync(spor) ? readFileSync(spor, 'utf8').trim().split('\n').filter(Boolean) : []; }
  };
}

/// ⛔ «MAAL ALDRIG PAA MIN SKAERM» (Gustav, missionen 23/9).
///
/// MAALT 24/9: otte optagelsesforsoeg pr. suite-koersel, og fem af dem
/// fotograferede den rigtige skaerm - hele skaermen i 800 og 1400 px, et fuldt
/// billede til /tmp, og hans Chrome-vinduer. Sloerede og aldrig vist, men det
/// er stadig en maaling paa hans skaerm, og macOS viser optage-indikatoren.
/// En optagelse af den rigtige skaerm kraever nu dette flag, sat paa en maskine
/// der ikke er hans (CMCP_FREMMED_MASKINE=1). Uden det springes tjekket over og rapporteres UMAALT.
export const OPTAG_SKAERM = process.env.CMCP_FREMMED_MASKINE === '1';
/// Samme flag daekker handlinger i de programmer mennesket bruger (et nul-rul i
/// hans forreste program, et nul-rul i den globale stroem, escape i Finder).
/// Umaerkelige - men det er stadig input paa hans maskine. (Fable, runde 2.)
export const FREMMED_MASKINE = OPTAG_SKAERM;
export const ROER_GRUND = 'umaalt her: sender input i et program mennesket bruger - koer med CMCP_FREMMED_MASKINE=1 paa en maskine der ikke er Gustavs';
export const OPTAG_GRUND = 'umaalt her: optager den rigtige skaerm - koer med CMCP_FREMMED_MASKINE=1 paa en maskine der ikke er Gustavs';
