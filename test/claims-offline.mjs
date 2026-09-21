// De paastande der kan proeves uden adgang til skaerm eller
// tilgaengeligheds-API - altsaa dem en byggekoerer kan sige noget sandt om.
//
// Resten staar uproevet indtil et menneske koerer ./test/run-all.sh paa en Mac.
// En groen byggekoersel maa ikke kunne forveksles med en fuld proeve, saa
// CI'en siger hoejt hvad den IKKE har set.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const { TOOLS, TOOL_BY_NAME } = await import(join(ROOT, 'mcp-server', 'tools.js'));
const policy = await import(join(ROOT, 'mcp-server', 'policy.js'));
const audit = await import(join(ROOT, 'mcp-server', 'audit.js'));

// 1. Ingen skal-, fil- eller URL-vaerktoejer er sneget ind
const forbidden = /exec|shell|command|run_|open_file|read_file|fetch|download|url/i;
const offenders = TOOLS.filter(t => forbidden.test(t.name));
check('ingen skal-, fil- eller URL-vaerktoejer', offenders.length === 0,
      offenders.length ? offenders.map(t => t.name).join(', ') : `${TOOLS.length} vaerktoejer gennemgaaet`);

// 2. Hvert vaerktoej baerer et niveau. Uden det kan inddelingen glide fra
//    hinanden uden at nogen opdager det.
const tierless = TOOLS.filter(t => !t.tier);
check('alle vaerktoejer har et niveau', tierless.length === 0,
      tierless.map(t => t.name).join(', ') || 'ingen uden');

// 3. Listen over programmer der altid spoerger, er ikke tom.
//    En tom liste ville bestaa alle andre proever og fjerne hele spaerren.
check('altid-spoerg-listen er ikke tom', policy.ALWAYS_ASK_APPS.size > 0,
      `${policy.ALWAYS_ASK_APPS.size} programmer`);

// 4. Revisionsloggen gemmer ikke det skrevne ordret.
const PROBE = 'AABBCC-maa-ikke-staa-i-loggen-112233';
const scrubbed = audit.scrubArgs({ text: PROBE, x: 10 });
const asText = JSON.stringify(scrubbed);
check('skrevet tekst gemmes ikke ordret', !asText.includes(PROBE), asText.slice(0, 80));
check('der gemmes laengde og fingeraftryk i stedet',
      scrubbed.text && scrubbed.text.length === PROBE.length && !!scrubbed.text.sha256_12,
      JSON.stringify(scrubbed.text));
check('andre felter gaar uroert igennem', scrubbed.x === 10);

// 5. Tilstandene findes og standarden er kendt.
check('tilstandene er readonly/auto/ask eller readonly/ask/allow',
      policy.MODES.size === 3, [...policy.MODES].join('/'));

// 6. ⛔ KERNELOEFTET: den stille vej roerer ALDRIG markoeren.
//
//    Produktet siger: "It works in the windows behind the one you are using,
//    and leaves your pointer where you put it." Det er det vi saelger paa, og
//    det var UBEVIST indtil 21/9.
//
//    Foerste forsoeg paa en proeve maalte markoerens position foer og efter et
//    tryk. Den var ubrugelig: den blev roed fordi MENNESKET flyttede musen.
//    En proeve der kan brydes af at nogen aander, maaler ingenting.
//
//    Det her maaler reglen i stedet: alt der flytter en markoer gaar gennem
//    CGEvent med mouseEventSource/mouseCursorPosition, og det hoerer hjemme i
//    Input.swift. Accessibility.swift - hvor press, set_value og menu bor -
//    maa kun bruge tastatur-hændelser. Bryd det, og denne paastand bliver roed.
const ax = readFileSync(new URL('../helper/Sources/cmcp-helper/Accessibility.swift', import.meta.url), 'utf8');
const museKald = [...ax.matchAll(/mouseEventSource|mouseCursorPosition|CGWarpMouseCursorPosition|mouseMoved|leftMouseDown|rightMouseDown|otherMouseDown|leftMouseDragged/g)].map(m => m[0]);
check('den stille vej roerer aldrig markoeren',
      museKald.length === 0,
      museKald.length ? `Accessibility.swift kalder: ${[...new Set(museKald)].join(', ')}` : 'ingen muse-haendelser i Accessibility.swift');

// 7. De tre skrivende vaerktoejer der ALDRIG var proevet: launch, quit, menu.
//
//    ⛔ MAALT 21/9: 6 af 28 vaerktoejer blev ikke roert af nogen proeve, og
//    computer_menu er ét af de TRE der kan arbejde uden at tage skaermen -
//    altsaa den evne produktet saelger paa.
//
//    De kan ikke proeves live uden at starte og lukke programmer paa en
//    rigtig maskine. Derfor proeves PORTEN: sitet lover at «quitting asks
//    every single time», og det loefte skal kunne blive roedt.
const idx = readFileSync(new URL('../mcp-server/index.js', import.meta.url), 'utf8');
const altidSpoerg = idx.slice(idx.indexOf('alwaysAsk:'), idx.indexOf('alwaysAsk:') + 700);

check('quit spoerger hver gang, ogsaa i allow',
      /name === 'computer_quit'/.test(altidSpoerg),
      'computer_quit staar i alwaysAsk');
check('at lukke et vindue spoerger hver gang',
      /computer_window' && args\.button === 'close'/.test(altidSpoerg),
      'window+close staar i alwaysAsk');
check('et farligt menupunkt spoerger hver gang',
      /computer_menu' && menuSerFarlig/.test(altidSpoerg),
      'menu gaar gennem menuSerFarlig');
check('et Space-skift spoerger hver gang',
      /name === 'computer_space'/.test(altidSpoerg),
      'computer_space staar i alwaysAsk');
// launch er MED VILJE ikke paa listen: at starte et program kan intet tabe.
// Staar den der en dag, er det en aendring nogen skal have besluttet.
check('launch spoerger IKKE hver gang - det kan intet tabe',
      !/name === 'computer_launch'/.test(altidSpoerg),
      'computer_launch staar med vilje uden for alwaysAsk');

// 8. ⛔ ELECTRON-LEDNINGEN: taender vi selv Chromiums trae, hver gang?
//
//    MAALT 21/9 paa en VS Code-fork med to aabne vinduer:
//      computer_find --role AXButton  ->  0 traeffere
//      efter AXManualAccessibility=true paa programmet:  728 knapper
//    i de SAMME to vinduer. Vi troede vi manglede en syns-model som
//    konkurrenterne har. Det var én attribut.
//
//    ⚠️ HVAD DENNE PAASTAND IKKE BEVISER: at det virker paa en frisk
//    Chromium-proces. Naar traeet foerst er bygget, kan det ikke slaas fra
//    igen (proevet: AXManualAccessibility=false aendrer intet), saa ledningen
//    kan ikke mutationsbevises live paa en koerende app. Beviskortet baerer
//    det hul med vilje. Det her maaler at ledningen ER der, i hver ende.
const sw = readFileSync(new URL('../helper/Sources/cmcp-helper/Accessibility.swift', import.meta.url), 'utf8');
const programElementer = (sw.match(/AXUIElementCreateApplication\(app\.processIdentifier\)/g) || []).length;
const taender = (sw.match(/AX\.taendTrae\(app\.processIdentifier\)/g) || []).length;
check('hvert program-element taender traeet foerst',
      programElementer > 0 && taender === programElementer,
      `${taender} af ${programElementer} steder`);

const fn = sw.slice(sw.indexOf('static func taendTrae'), sw.indexOf('static func taendTrae') + 400);
check('og kontakten er faktisk AXManualAccessibility',
      /AXManualAccessibility/.test(fn) && /kCFBooleanTrue/.test(fn),
      'saettes til true paa programmets AX-element');
check('den taendes kun én gang pr. proces',
      /traeTaendt\.contains\(pid\)/.test(fn) && /traeTaendt\.insert\(pid\)/.test(fn),
      'det koster i appen selv at holde traeet i live');

// 9. ⛔ DEN FIL BRUGEREN FAAR - ikke kilden vi laeser i punkt 8.
//
//    FUNDET 21/9, og det er hele grunden til at afsnittet findes:
//    Electron-rettelsen blev committet kl. 14.20, proeverne var groenne, og
//    `mcp-server/vendor/cmcp-helper` - den binaer der ligger i npm-pakken og
//    som serveren faktisk starter - var fra dagen foer og havde den IKKE.
//    Punkt 8 laeser Swift-KILDEN. En bruger koerer aldrig kilden.
//
//    Samme fejlklasse som huset har betalt for foer: attrappen har en anden
//    form end virkeligheden. Et groent tal om kilden siger intet om artefaktet.
//
//    Navnene herunder er ikke auto-udledt af kilden, og det er med vilje:
//    `AXApplication` og `AXMenuBar` staar i kilden men findes IKKE i binaeren,
//    fordi Swift folder dem sammen med systemets egne konstanter. En vagt
//    bygget paa alle kildens navne ville lyse roedt paa noget der virker.
//    Derfor: kun de navne der baerer et LOEFTE vi giver offentligt.
const LOEFTER = [
  ['AXManualAccessibility', 'virker inde i Electron-programmer'],
  ['AXSecureTextField',     'kodeordsfelter kan findes og sloeres'],
  ['AXMenu',                'menuer kan laeses'],
];
const BIN = join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
let raa = null;
try { raa = readFileSync(BIN, 'latin1'); } catch { /* ikke bygget */ }

if (raa === null) {
  // ⛔ Et instrument der ikke kan maale, maa ALDRIG tie og bestaa.
  //    I udgivelses-arbejdsgangen koeres build-release.sh FOER denne fil, saa
  //    dér skal binaeren findes. CMCP_KRAEV_BINAER=1 goer fraværet til en fejl.
  if (process.env.CMCP_KRAEV_BINAER === '1') {
    check('den sendte binaer findes', false, 'mcp-server/vendor/cmcp-helper mangler - koer scripts/build-release.sh');
  } else {
    console.log('UMAALT  den sendte binaer - ikke bygget her. Saet CMCP_KRAEV_BINAER=1 for at kraeve den');
  }
} else {
  check('den sendte binaer er universel (Intel + Apple silicon)',
        raa.slice(0, 4) === '\xca\xfe\xba\xbe',
        'fat Mach-O magic cafebabe');
  for (const [navn, loefte] of LOEFTER) {
    check(`den sendte binaer kan: ${loefte}`, raa.includes(navn), navn);
  }
}

console.log();
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
