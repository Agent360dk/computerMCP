import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

/// Hjaelperen er en separat binaer, ikke en node-udvidelse. Det er et valg:
/// den binaer er det eneste der faar Tilgaengeligheds- og Skaermoptagelses-
/// rettigheder, den er lille nok til at laese igennem, og den kan udskiftes
/// uden at roere serveren.
export function helperPath() {
  // ⛔ Er CMCP_HELPER sat, er den et VALG - ikke et forslag.
  //    Foer 21/9 blev en sti der ikke fandtes filtreret bort i stilhed, og
  //    saa koerte den indbyggede binaer i stedet. Peger man paa sin egen
  //    bygning med en tastefejl, proever man noget andet end man tror - og
  //    det opdages foerst naar en rettelse «ikke virker».
  if (process.env.CMCP_HELPER && !existsSync(process.env.CMCP_HELPER)) return null;
  const candidates = [
    process.env.CMCP_HELPER,
    join(HERE, 'vendor', 'cmcp-helper'),
    join(HERE, '..', 'helper', '.build', 'release', 'cmcp-helper'),
    join(HERE, '..', 'helper', '.build', 'debug', 'cmcp-helper')
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export class HelperError extends Error {
  // ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9: `extra` blev TABT. Vaerktoejs-
  //    beskrivelsen lover at flere traeffere er "a refusal, not a guess:
  //    narrow the search", og hjaelperen sender faktisk kandidaterne med -
  //    men afvisningen bar kun beskeden videre. Modellen saa dem aldrig og
  //    kunne derfor ikke praecisere uden at gaette eller soege forfra.
  //    Et loefte i en vaerktoejsbeskrivelse er ogsaa et loefte.
  constructor(message, code, extra = null) { super(message); this.code = code; this.extra = extra; }
}

/// Alt hjaelperen sagde UD OVER de tre faste felter.
///
/// ⛔ MAALT 23/9-2026, og det er en vagt der var groen over en urettet sti.
///    Linjerne ovenfor siger at sikkerhedsrevieweet 20/9 rettede at `extra`
///    blev TABT. Rettelsen blev lavet her i JS'en - den laeste `parsed.extra`.
///    Men Swift-siden har aldrig lagt noget DER: `Out.fail(_, code:, extra:)`
///    FLETTER nyttelasten ind oeverst i objektet (JSONOut.swift:13).
///
///    Maalt paa den rigtige binaer:
///      $ cmcp-helper set-value --app com.apple.finder --title FINDES-IKKE --text x
///      {"code":"not-found","count":0,"error":"nothing matched","ok":false}
///                          ^^^^^^^^^ oeverst, ikke under "extra"
///      callHelper(...) -> err.extra === null
///
///    Altsaa: hver eneste `extra:` i hjaelperen - kandidaterne ved flere
///    traeffere, det sikre felt der blev afvist, forsoegstallene i wait-for -
///    blev smidt vaek foer modellen saa dem. Vaerktoejsbeskrivelsen lover at
///    flere traeffere er «a refusal, not a guess: narrow the search». Det
///    loefte kunne ikke holdes, og intet sagde fra i fjorten dage.
///
///    Rettet ÉT sted i stedet for ti: alt der ikke er ok/error/code ER
///    nyttelasten. Saa virker den ogsaa for det naeste kaldested nogen skriver.
function ekstraFra(parsed) {
  if (parsed && typeof parsed.extra === 'object' && parsed.extra !== null) return parsed.extra;
  const ud = {};
  for (const [k, v] of Object.entries(parsed)) if (!['ok', 'error', 'code', 'extra'].includes(k)) ud[k] = v;
  return Object.keys(ud).length ? ud : null;
}

/// Hjaelper-processer der koerer lige nu. Naar et skaerm-laan slutter, draebes
/// dem der TAGER skaermen (runde 1 30/9, Astra 4): «tag skaermen tilbage» skal
/// ogsaa stoppe et traek eller en skrivning der er i gang.
const levende = new Map();
// ⛔ Runde 2 30/9 (Astra 1, Fable 3): kun «skaerm-tagende» blev draebt - en stille
//    skrivning i det forreste program, `paste`, `launch` og vindueskald fortsatte.
//    Nu draebes ALT denne server har i gang, som ikke er et rent opslag.
const OPSLAG = new Set(['apps', 'displays', 'find', 'focused', 'inspect', 'menus', 'permissions', 'redact',
  'screenshot', 'secure-rects', 'version', 'wait-for', 'windows', 'at', 'resolve-app', 'samtale', 'idle']);
export function afbrydSkaermKald() {
  let n = 0;
  for (const [child, argv] of levende) {
    // Et opslag (ogsaa `press --dry`) draebes ikke. `paste` faar SIGUSR1 i stedet for
    // SIGTERM (runde 4, Astra 4): den stopper FOER Cmd+V og laegger personens
    // udklipsholder tilbage; har den allerede trykket, bliver gendannelsen faerdig.
    if (OPSLAG.has(argv[0]) || argv.includes('--dry')) continue;
    try { child.afbrudtAfLaan = true; child.kill(argv[0] === 'paste' ? 'SIGUSR1' : 'SIGTERM'); n++; } catch {}
  }
  return n;
}

export function callHelper(args, { timeout = 30000, stdin = null } = {}) {
  return new Promise((resolve, reject) => {
    const bin = helperPath();
    if (!bin) {
      return reject(new HelperError(
        'cmcp-helper was not found. Build it with `swift build -c release` in helper/, or point CMCP_HELPER at it.',
        'helper-missing'
      ));
    }
    // Argumenter gives som et array, aldrig som en streng gennem en skal.
    // Ellers ville en vindues-titel med et semikolon i kunne blive til en
    // kommando, og saa ville hele samtykke-modellen vaere ligegyldig.
    const child = execFile(bin, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const text = String(stdout || '').trim();
      let parsed = null;
      if (text) { try { parsed = JSON.parse(text.split('\n').pop()); } catch { /* ikke JSON */ } }
      if (parsed && parsed.ok === false) {
        return reject(new HelperError(parsed.error || 'the helper failed',
                                     parsed.code || 'helper-error',
                                     ekstraFra(parsed)));
      }
      if (err && !parsed && child.afbrudtAfLaan) {
        return reject(new HelperError('the screen loan ended while this ran (taken back, expired or handed back), so it was stopped part way', 'screen-taken-back'));
      }
      if (err && !parsed) {
        return reject(new HelperError(
          err.killed ? `the helper did not answer within ${timeout} ms` : (String(stderr).trim() || err.message),
          err.killed ? 'helper-timeout' : 'helper-failed'
        ));
      }
      if (!parsed) return reject(new HelperError('the helper did not answer with JSON', 'helper-bad-output'));
      resolve(parsed);
    });
    levende.set(child, args);
    child.on('exit', () => levende.delete(child));

    // Hemmeligheder gaar paa stdin, aldrig som argument: `ps` viser hele
    // kommandolinjen for enhver proces med samme bruger-id. Vi LOVEDE det paa
    // tools-siden og gjorde det ikke - hjaelperen har haft --stdin siden 18/9,
    // og JS-siden sendte --text alligevel. Stroemmen SKAL lukkes, ellers venter
    // hjaelperen paa EOF for evigt.
    if (stdin !== null && child.stdin) {
      child.stdin.on('error', () => { /* hjaelperen kan allerede vaere doed */ });
      child.stdin.end(String(stdin), 'utf8');
    }
  });
}

/// ⛔ 9/10 (F1 paa Gustavs Mac): WhatsApp hedder «\u200eWhatsApp» - et usynligt
///    venstre-mod-hoejre-maerke (U+200E) foran navnet, baade paa disken og i
///    CFBundleDisplayName. `app: "WhatsApp"` fandt derfor intet, maalet blev
///    «ukendt», og hvert skrivende kald i WhatsApp blev afvist i baggrunden.
///
///    Samme regel som hjaelperens `Navne.vaelg` (Navne.swift), saa porten og
///    leveringen rammer samme program (18/9) - test/usynlige-navne.mjs koerer
///    begge sider mod de samme tilfaelde:
///      1. bundle-id praecist, saa bundle-id uden hensyn til store/smaa bogstaver
///      1b. et praecist navn (smaa bogstaver tegn for tegn) - det foerste
///      2. ellers navnet uden usynlige formateringstegn (Unicode Cf) - men kun naar
///         praecis ét program passer. Passer flere, vaelges intet: et ukendt maal afvises.
const USYNLIGE = /\p{Cf}/gu;
/// ⛔ R16 (Astra + Opus, MAALT 9/10): smaa bogstaver TEGN FOR TEGN og sammenligning
///    paa tegn - som Navne.swift. `toLowerCase()` paa hele strengen bruger graesk
///    slut-sigma, Swift goer ikke; tegn for tegn er de ens (proeven tjekker hvert tegn).
const smaa = (s) => Array.from(String(s ?? ''), c => c.toLowerCase()).join('');
export const navneNoegle = (s) => smaa(String(s ?? '').replace(USYNLIGE, '').trim());
export function findProgram(apps, want) {
  const w = String(want ?? '').trim();
  if (!w) return null;
  const lw = smaa(w);
  const hit = apps.find(a => (a.bundleId || '') === w)
           || apps.find(a => a.bundleId && smaa(a.bundleId) === lw)
           || apps.find(a => smaa(a.name || '') === lw);
  if (hit) return hit;
  const n = navneNoegle(want);
  if (!n) return null;
  const hits = apps.filter(a => navneNoegle(a.name) === n);
  return hits.length === 1 ? hits[0] : null;
}

/// Oversaetter det program-argument agenten skrev, til et kanonisk bundle-ID.
///
/// ⛔ Findes fordi porten ellers kan omgaas med ét ord. `ALWAYS_ASK_APPS`
/// indeholder bundle-ID'er, men baade vaerktoejs-skemaet og hjaelperen tager
/// imod et NAVN: `AX.app()` falder tilbage til at matche `localizedName`.
/// MAALT 18/9: `computer_press {app:"1Password"}` ramte 1Password, mens porten
/// saa strengen "1Password" - som ikke staar i listen - og svarede
/// `allow=true, asked=false`. Forsidens andet loefte var dermed falsificerbart
/// af en fremmed paa tredive sekunder.
///
/// Rettelsen er at oversaette FOER porten spoerges - ikke at laegge navne ind i
/// listen. Navne er oversatte: "Keychain Access" hedder "Noeglering" paa en
/// dansk Mac, og en regel bygget paa ord holder kun paa det sprog den blev
/// skrevet i.
///
/// Kan navnet ikke oversaettes, koerer programmet ikke, og handlingen fejler
/// alligevel et skridt senere. Vi giver da det raa argument videre, saa et
/// bundle-ID for et program der lige er lukket, stadig bedoemmes som sig selv.
export async function resolveBundleId(appArg) {
  const want = String(appArg || '').trim();
  if (!want) return null;
  // ⛔ FUNDET AF MODSTANDER-REVIEWET 21/9, og det var en Critical i den
  //    egenskab hele produktet hviler paa.
  //
  //    Den returnerede FOER modellens raa streng naar opslaget ikke lykkedes -
  //    baade «ikke fundet» og «kaldet fejlede». Saa blev `targetBundleId` til
  //    fx "Keychain Access": sand, men ikke i ALWAYS_ASK_APPS. Hverken
  //    adgangskode-porten eller ukendt-maal-porten fyrede.
  //
  //    Konsekvensen var paa hovedet: UDEN `app` ville samme kald vaere blevet
  //    afvist (forrest = null -> ukendt maal -> naegt). AT NAVNGIVE PROGRAMMET
  //    GJORDE PORTEN SVAGERE. Og hjaelperen slaar det SAMME navn op paa sin
  //    egen side og leverer tastetrykkene.
  //
  //    Nu: kan vi ikke opsloe det, er svaret null, og `unknownTarget` fyrer.
  //    Det koster et afslag naar maskinen er under pres - og et afslag er den
  //    rigtige pris. Timeout hoevet fra 5 til 15 sekunder af samme grund som
  //    `frontmostBundleId` fik det 19/9: hjaelperen er maalt til 23-38 sekunder
  //    under load 143, og en timeout maa ikke blive til et tavst ja.
  try {
    const r = await callHelper(['apps', '--all'], { timeout: 15000 });  // samme maengde som leveringen
    const hit = findProgram(r.apps || [], want);
    return hit ? (hit.bundleId || null) : null;
  } catch {
    return null;
  }
}

/// Som `resolveBundleId`, men siger ogsaa om programmet er DET mennesket
/// sidder i lige nu.
///
/// ⛔ FUNDET AF ANDET MODSTANDER-REVIEW 21/9: `took_screen: true` var en
///    ETIKET, ikke en port. Den blev sat EFTER handlingen, saa et
///    `computer_type --app "Google Chrome"` mens mennesket skrev i Chrome
///    landede i hans felt - og saa fik han at vide at det var sket.
///    README lover «Nothing ... types into the window you are using». Det
///    loefte kraever en port, ikke en maerkat.
///
///    Samme `apps`-kald som i forvejen, saa det koster ingenting.
export async function resolveApp(appArg) {
  const want = String(appArg || '').trim();
  if (!want) return null;
  try {
    const r = await callHelper(['apps', '--all'], { timeout: 15000 });  // samme maengde som leveringen
    const hit = findProgram(r.apps || [], want);
    return hit ? { bundleId: hit.bundleId || null, active: !!hit.active, name: hit.name } : null;
  } catch {
    return null;
  }
}

/// Hvilket program er forrest lige nu. Bruges til at afgoere om en handling
/// rammer et program der altid skal spoerge (adgangskode-bokse, terminaler).
export async function frontmostBundleId() {
  try {
    // ⛔ 15 sekunder, ikke 5. MAALT 19/9: paa en belastet maskine tog opslaget
    //    over fem sekunder, `null` kom tilbage, og fail-closed-vagten spurgte om
    //    lov til et museklik. Vagten er rigtig - et ukendt maal ER farligt - men
    //    en graense der udloeses af travlhed, giver dialoger for handlinger der
    //    slet ikke er farlige. Samme klasse som skaermbilledets 45 sekunder.
    const r = await callHelper(['apps', '--all'], { timeout: 15000 });  // samme maengde som leveringen
    const active = (r.apps || []).find(a => a.active);
    return active ? active.bundleId : null;
  } catch { return null; }
}
