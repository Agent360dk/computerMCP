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
// Serveren melder vaerktoejernes argumentnavne ved opstart (et ukendt navn er selv
// modellens tekst og logges som fingeraftryk - optagelse.mjs 12b maaler det gennem serveren).
audit.kendNoegler(['text', 'x']);
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
      /alwaysAsk: menuFarlig/.test(altidSpoerg)
        && /menuFarlig = name === 'computer_menu'[^;]*menuSerFarlig\(args\.path\)[^;]*menuGenvejErFarlig/.test(idx),
      'menu gaar gennem menuSerFarlig OG genvejen (1/10)');
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

// 8b. ⛔ CHROME-LEDNINGEN (maalt 4/11-2026): Google Chrome kender IKKE AXManualAccessibility
//     (System Events: -1728, «kan ikke hente»). Dens kontakt er AXEnhancedUserInterface. Uden den
//     saa vi 0 elementer fra selve siderne i to Chrome-vinduer, kunne ikke taste (focus-unknown) og
//     kunne ikke finde et kodefelt at sloere. Paa en engangs-profil: 0 -> 6 elementer, kodefeltet
//     som AXSecureTextField. Og den maa KUN saettes paa Chromium-browsere - paa AppKit-programmer
//     animerer den vinduesflytninger, og dem ser vi i forvejen.
const tStart = sw.indexOf('static func taendTrae');
const hel = sw.slice(tStart, sw.indexOf('\n    }\n', tStart) + 6);
const foerTjek = hel.slice(0, hel.indexOf('erChromium('));
check('Chrome faar sin egen kontakt, AXEnhancedUserInterface',
      /AXUIElementSetAttributeValue\(program, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue\)/.test(hel),
      'uden den er Chrome-siderne tomme for os');
check('... men kun bag Chromium-tjekket, aldrig paa alle programmer',
      hel.includes('erChromium(') && !/AXEnhancedUserInterface/.test(foerTjek),
      'saat paa alle programmer animerer den vinduer i AppKit-programmer');
// 8c. Traeet bygges ASYNKRONT (maalt 3-15 s, fire gange). Det kald der taendte det, maa ikke svare et
//     stumt «0» - saa konkluderer agenten at siden er tom.
const mainSw = readFileSync(new URL('../helper/Sources/cmcp-helper/main.swift', import.meta.url), 'utf8');
check('find siger det, naar kaldet selv lige taendte Chrome-traeet',
      /hits\.isEmpty && \(AX\.chromeTaendtNu \|\| AX\.chromeSideUlaeselig\([^]{0,160}tree_building/.test(mainSw),
      'et foerste «0» laeses som en tom side');
check('focused siger det ogsaa', /\(AX\.chromeTaendtNu \|\| AX\.chromeSideUlaeselig\([^]{0,160}chromeByggerNote/.test(mainSw),
      'computer_type afviser med focus-unknown uden at sige hvorfor');
// 8d. ⛔ MAALT 5/11: web-omraadet ligger i DYBDE 8. Foerste udgave af harWebIndhold soegte 6
//     niveauer, fandt det aldrig, og svaertede derfor ALLE Chrome-vinduer i hvert billede.
// Hele funktionen (til naeste `static func`), ikke de foerste 900 tegn: en kommentar skubbede loekken ud (R2 5/11).
const hwStart = sw.indexOf('static func harWebIndhold');
const hw = sw.slice(hwStart, sw.indexOf('static func', hwStart + 10));
const niv = Number((hw.match(/for _ in 0\.\.<(\d+)/) || [])[1] || 0);
check('harWebIndhold soeger dybere end web-omraadet (dybde 8)', niv >= 9, `soeger ${niv} niveauer`);
// 8e. Chromes titelloese hjaelpe-vinduer (41-47 pkt hoeje strimler) har aldrig et web-omraade.
// 8f. ⛔ MAALT 5/11: uden frist HANG hjaelperen > 40 s paa et Chrome-skan, da Chromes tilgaengelighed var
//     langsom - den oprindelige ramte sit loft paa 10 s. Alle nye Chrome-soegninger skal bære en frist.
check('harWebIndhold har en frist og svarer «ikke laesbart» naar den er naaet',
      /static func harWebIndhold\(_ win: AXUIElement, frist: Date/.test(sw) && /if Date\(\) > frist \{ return false \}/.test(sw),
      'en langsom Chrome faar sloeringen til at haenge forbi serverens 45 s');
check('porten i sloeringen giver den gennemgangens frist',
      /!AX\.harWebIndhold\(win, frist: start\.addingTimeInterval\(tidsgraense\)\)/.test(sw), 'porten kan haenge uden loft');
check('tree_building-tjekket har sin egen frist', /let frist = Date\(\)\.addingTimeInterval\(3\)/.test(sw) && /harWebIndhold\(win, frist: frist\)/.test(sw),
      'et tomt find kan haenge');
check('kun vinduer med side-stoerrelse svaertes for et ubygget trae',
      /\(vf!\.w >= 200 && vf!\.h >= 120\)/.test(sw) /* R3: uanset underrolle */ && /erChromium, sidevindue, !AX\.harWebIndhold\(win/.test(sw),
      'ellers svaertes fanelinje og vaerktoejslinje i hvert billede');
check('Google Chrome staar paa listen', /"com\.google\.Chrome"/.test(sw), 'den eneste browser der er maalt');

//    ...og den kan slaas fra. Uden det er «0 foer, 728 efter» et tal ingen
//    udefra kan efterproeve, for kontakten kan ikke slaas fra igen paa en
//    proces der allerede er taendt. Med flaget er foer-tallet to kommandoer.
check('kontakten kan slaas fra, saa tallet kan efterproeves udefra',
      /taendTraeSlaaetFra/.test(fn) && /CMCP_INGEN_ELECTRON/.test(sw),
      'CMCP_INGEN_ELECTRON=1');

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
// Vault-porten (5/11): de tolv udvidelses-id'er blev hver slaaet op i Chrome Web Store. Et id der falder ud
// af listen ved en fejl, aabner porten for netop den adgangskode-udvidelse.
{
  const ids = ['aeblfdkhhhdcdjpifhhbdiojplfjncoa', 'nngceckbapebfimnlniiiahkandclblb', 'hdokiejnpimakedhajhdlcegeplioahd',
    'fdjamakpfbbddfjaooikfcpapjohcfmg', 'ghmbeldphafepmbegfdlkpapadhbakde', 'bfogiafebfohielmmehodmfbbebbbpei',
    'fooolghllnmhmmndgjiamiiodkpenpbb', 'pnlccmojcmeohlpggmfnbbiapkmbliob', 'kmcfomidfpdkfieipokbalgegidffkal',
    'pejdijmoenmkgeppbflobdenhhabjlaj', 'admmjipmmciaobhojoghlmleefbicajg', 'caljgklbbfbcjjanaijlacgncafpegll',
    // R4: NordPass (ny) + Edge-udgaverne, bekraeftet 5/11
    'eiaeiblijfjekdanodkjadfinkhbfgcd', 'jbkfoedolllekgbhcbcoahefnbanhhlh', 'dppgmdbiimibapkepcbdbmkaabgiofem',
    'bbcinlkgjjkejfdpemiealijmmooekmp', 'gehmmocbbkpblljhkekmfhjpfbkclbph', 'lfochlioelphaglamdcakfjemolpichk'];
  const liste = sw.slice(sw.indexOf('static let vaultUdvidelser'), sw.indexOf(']', sw.indexOf('static let vaultUdvidelser')));
  const mangler = ids.filter((i) => !liste.includes(`"${i}"`));
  check('vault-porten: alle atten bekraeftede udvidelses-id\'er staar i listen', mangler.length === 0, `mangler ${mangler.join(', ')}`);
  check('vault-porten: find, inspect, focused og fokus-skrivning spoerger alle', /vaultGrund\(el, rolle: r\)/.test(sw)
        && /vaultGrund\(el, rolle: role\)/.test(sw) && (sw.match(/iVaultSide\(/g) || []).length >= 5, 'en af vejene mangler');
  // R4 (Astra): den direkte AX-indsaettelse (computer_type --app) skrev uden om porten.
  const ins = sw.slice(sw.indexOf('static func indsaetIFokus'), sw.indexOf('static func', sw.indexOf('static func indsaetIFokus') + 10));
  check('vault-porten: den direkte indsaettelse spoerger ogsaa', /iVaultSide\(el\)/.test(ins), 'indsaetIFokus mangler iVaultSide');
  check('vault-porten: koordinat-opslaget (at) og klik-porten kender adgangskode-sider',
        /password_page/.test(mainSw) && /appKlik\.password_page/.test(readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8')), 'at eller serveren mangler password_page');
  // R8: sende-dommen skelner en GENKENDT adgangskode-side fra en der ikke kunne afgoeres, paa `at`-notens ordlyd. Begge
  //     sider af kontrakten: hjaelperens note og vault-grundens tekst skal give praecis det praefiks, serveren leder efter.
  const srvTekst = readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
  check('vault-porten: `at`-notens ordlyd er den, sende-dommen genkender (hjaelper og server i takt)',
        mainSw.includes('"note": "The point is inside \\(g); nothing from it is returned."')
        && /return erVaultAdresse\(u\) \? "a password manager page" : nil/.test(sw)
        && srvTekst.includes("/^The point is inside a password manager page;/.test(String(koordinatOpslag.note || ''))"),
        'notens skabelon, vault-grunden eller serverens moenster er aendret uden de andre');
  // R9: et program uden bundle-id kan ikke udelukkes som browser - i find OG inspect, som i fokus-vejen.
  check('vault-porten: program uden bundle-id regnes som mulig browser i find og inspect',
        (sw.match(/let erBrowserApp = app\.bundleIdentifier == nil \|\| erBrowser\(app\.bundleIdentifier\)/g) || []).length === 2,
        'find eller inspect regner nil-id for ikke-browser');
  check('vault-porten: fokus i en adgangskode-side kaldes ikke et «secure field» (set-value siger hvad det er)',
        /if fokusVej, let g = AX\.iVaultSide\(t\.el\) \{\s*Out\.fail\("the keyboard focus is inside/.test(mainSw), 'set-value bruger stadig secure-field-teksten');
  // R9 (Astra R8-4): grundene baerer procesnummeret - ellers kan en proeve ikke binde et signal til sin egen Chrome.
  check('grundene baerer procesnummeret (alle otte steder, og inspects vault-knude har pid)',
        /static func etiket\(_ app: NSRunningApplication, _ bid: String\) -> String \{\s*"\\\(app\.localizedName \?\? bid\) \[pid \\\(app\.processIdentifier\)\]"/.test(sw)
        && (sw.match(/etiket\(app, /g) || []).length === 8 && !/\(app\.localizedName \?\? bid\) \+ "/.test(sw)
        && /"pid": Int\(app\.processIdentifier\),\s*"role": role, "depth": d, "denied": true/.test(sw),
        'en grund uden pid, eller etiket-funktionen er aendret');
  check('vault-porten: en side hvis adresse ikke kunne laeses, goer find og inspect ufuldstaendige',
        (sw.match(/if g == vaultUkendtGrund \{ stoppedeTidligt = true \}/g) || []).length === 2, 'find eller inspect mangler reglen');
  // R10c (Opus R10-O6, MAALT): serverens beskedbrowsere var faerre end hjaelperens browsere - en webchat-Send i Chrome Beta gik
  //       uden om sende-dommen. Hver browser hjaelperen kender, skal vaere en browser for sende-dommen (to lister i takt).
  {
    const { beskedSlags } = await import(new URL('../mcp-server/policy.js', import.meta.url).href);
    const liste = (navn) => (sw.match(new RegExp(`static let ${navn}: Set<String> = \\[([\\s\\S]*?)\\]`)) || [, ''])[1].match(/"[^"]+"/g) || [];
    const ids = [...liste('chromiumBrowsere'), ...liste('andreBrowsere')].map((x) => x.slice(1, -1));
    const mangler = ids.filter((b) => beskedSlags(b) !== 'browser');
    check(`sende-dommen kender alle ${ids.length} browsere hjaelperen kender (og Chromes kanaler efter segmentreglen)`,
          ids.length >= 18 && mangler.length === 0 && beskedSlags('com.google.chrome.for.testing') === 'browser', `mangler: ${mangler.join(', ')}`);
    // Foer npm (Opus R11-O5): de seks browsere uden for begge lister - i BEGGE nu (hjaelperens vault-port og serverens sende-dom).
    const nye = ['com.operasoftware.OperaGX', 'ai.perplexity.comet', 'company.thebrowser.dia', 'com.kagi.kagimacOS', 'com.duckduckgo.macos.browser', 'app.zen-browser.zen'];
    const lav = ids.map((x) => x.toLowerCase());
    const udenfor = nye.filter((b) => beskedSlags(b) !== 'browser' || !lav.includes(b.toLowerCase()));
    check('Opera GX, Comet, Dia, Orion, DuckDuckGo og Zen er browsere for baade hjaelperen og sende-dommen', udenfor.length === 0, `mangler: ${udenfor.join(', ')}`);
  }
  // Foer npm: hjaelperens nye felter - en ufuldstaendig soegning naevner sprungne adgangskode-sider; sloeringen siger hvor mange
  // vinduer den naaede; et punkt-opslag giver en teksts trykbare forfader (B7).
  check('hjaelperen: search-incomplete baerer skipped_password_pages, naar en adgangskode-side blev sprunget over',
        /if !sprungne\.isEmpty \{ ekstra\["skipped_password_pages"\] = sprungne \}/.test(mainSw) && /code: "search-incomplete", extra: ekstra\)/.test(mainSw), 'reglen mangler');
  check('hjaelperen: secure-rects svarer windows_scanned (taelt efter tidsgraensen, nulstillet ved start)',
        /"windows_scanned": AX\.sloeringVinduer/.test(mainSw) && /sloeringVinduer = 0/.test(sw) && /\n\s+sloeringVinduer \+= 1/.test(sw), 'feltet eller taellingen mangler');
  check('hjaelperen: at giver den trykbare forfader (control) til en tekst i en knap',
        /"control": AX\.knapForfader\(el!\)/.test(mainSw) && /static func knapForfader/.test(sw), 'control mangler');
  check('vault-porten: wait-for og et tomt soegeresultat siger, at adgangskode-sider ikke blev gennemsoegt',
        /password manager page\(s\) were not searched; their content is never returned/.test(mainSw)
        && /password manager page\(s\) were not searched; like password manager apps/.test(mainSw), 'wait-for eller not-found tier om sprungne sider');
}

const LOEFTER = [
  // R9 (A6): en binaer uden beskeden om sprungne adgangskode-sider kan ikke bestaa.
  ['were not searched; their content is never returned', 'wait-for siger naar en adgangskode-side ikke blev gennemsoegt'],
  ['could not be read to rule out a password manager', 'et ufuldstaendigt svar navngiver ogsaa den ulaeselige adresse'],
  ['AXManualAccessibility', 'virker inde i Electron-programmer'],
  ['AXSecureTextField',     'kodeordsfelter kan findes og sloeres'],
  ['AXMenu',                'menuer kan laeses'],
  ['CMCP_INGEN_ELECTRON',   'Electron-kontakten kan slaas fra af brugeren'],
  // REVIEW 5/11 (Opus): uden den kunne en gammel binaer bestaa - samme klasse som 21/9.
  ['AXEnhancedUserInterface', 'Chrome-sider kan ses, og deres kodefelter sloeres'],
  // R2 5/11 (Opus N11): evnen en chat spoerger efter med `version` - og grundene secure-rects nu giver.
  //    Navnet er over 15 tegn: kortere Swift-strenge ligger i koden og kan ikke findes her (maalt 5/11).
  ['chrome-page-redaction', 'siger selv at den kan Chrome-sider (version)'],
  // Vault-porten 5/11: et id fra listen (32 tegn, ligger i strengtabellen) - en binaer uden porten kan ikke bestaa.
  ['nngceckbapebfimnlniiiahkandclblb', 'adgangskode-sider i browsere holdes ude (vault-porten)'],
  // R5: evnen en chat spoerger efter - over 15 tegn, saa den ligger i strengtabellen.
  ['browser-password-pages', 'siger selv at den har vault-porten (version)'],
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

// ⛔ ASTRA 25/9 (Critical): `cmd+cmd+q` og `fn+cmd+q` gik uden om tastevagten -
//    vagten sammenlignede en streng, hjaelperen laver et saet af flag og sendte
//    Cmd+Q. Hver variant her ER en farlig tast for hjaelperen; de harmloese maa
//    ikke fanges (ellers maaler vagten bare «afvis alt»).
{
  const farlige = ['cmd+q', 'cmd+cmd+q', 'fn+cmd+q', 'cmd+option+q', 'command+q', 'meta+q',
                   'shift+cmd+w', 'cmd+w', 'ctrl+shift+c', 'control+d', 'cmd+shift+delete', 'CMD+Q'];
  const harmloese = ['cmd+c', 'cmd+s', 'q', 'escape', 'cmd+v', 'shift+tab'];
  const slap = farlige.filter(c => !policy.tastSerFarlig(c));
  const fanget = harmloese.filter(c => policy.tastSerFarlig(c));
  check('tastevagten fanger en farlig tast uanset ekstra eller gentagne modifikatorer', slap.length === 0,
        slap.length ? 'slap igennem: ' + slap.join(', ') : `${farlige.length} varianter fanget`);
  check('...og fanger ikke harmloese taster', fanget.length === 0,
        fanget.length ? 'fanget: ' + fanget.join(', ') : `${harmloese.length} harmloese gik igennem`);
}

// ⛔ 1/10 (skaerm-koe-panelet): et skaerm-laan brugte det almindelige 60 s-vindue,
//    og MAALT i Gustavs chat-historik kom 11 af 12 udloebne anmodninger inden for
//    3 minutter efter han sagde «klar». skaermVentetid() giver skaerm-anmodninger
//    et eget, laengere vindue - adskilt fra askTimeout(), som styrer alle andre
//    samtykke-dialoger og IKKE maa aendre sig ved et uheld.
{
  const gemt = process.env.CMCP_SCREEN_WAIT;
  delete process.env.CMCP_SCREEN_WAIT;
  check('skaermVentetid(): standard er 5 minutter (300 s), laengere end askTimeout()',
        policy.skaermVentetid() === 300 && policy.skaermVentetid() > policy.askTimeout(),
        `skaermVentetid=${policy.skaermVentetid()}, askTimeout=${policy.askTimeout()}`);
  process.env.CMCP_SCREEN_WAIT = '9999';
  check('skaermVentetid(): loftet er 20 minutter (1200 s), ogsaa ved et stoerre tal',
        policy.skaermVentetid() === 1200, String(policy.skaermVentetid()));
  process.env.CMCP_SCREEN_WAIT = '45';
  check('skaermVentetid(): en gyldig vaerdi under loftet respekteres',
        policy.skaermVentetid() === 45, String(policy.skaermVentetid()));
  if (gemt === undefined) delete process.env.CMCP_SCREEN_WAIT; else process.env.CMCP_SCREEN_WAIT = gemt;
}

console.log();
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
