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
                                     parsed.extra ?? null));
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
    const r = await callHelper(['apps'], { timeout: 15000 });
    const apps = r.apps || [];
    const lower = want.toLowerCase();
    const hit = apps.find(a => (a.bundleId || '').toLowerCase() === lower)
             || apps.find(a => (a.name || '').toLowerCase() === lower);
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
    const r = await callHelper(['apps'], { timeout: 15000 });
    const lower = want.toLowerCase();
    const hit = (r.apps || []).find(a => (a.bundleId || '').toLowerCase() === lower)
             || (r.apps || []).find(a => (a.name || '').toLowerCase() === lower);
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
    const r = await callHelper(['apps'], { timeout: 15000 });
    const active = (r.apps || []).find(a => a.active);
    return active ? active.bundleId : null;
  } catch { return null; }
}
