import { appendFileSync, mkdirSync, chmodSync, existsSync, readFileSync, writeFileSync, renameSync,
         openSync, closeSync, writeSync, unlinkSync, statSync, readSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash, randomUUID, randomBytes } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

const DIR = process.env.CMCP_STATE_DIR || join(homedir(), '.local', 'state', 'computer-mcp');
const FILE = join(DIR, 'audit.jsonl');

/// Hvem skrev linjen?
///
/// Én maskine kan have flere agenter i gang: én server pr. MCP-klient, og en
/// chat mere er bare en proces mere. De deler ÉN log. Uden et maerke pr.
/// server staar der bagefter atten linjer og ingen maade at se hvilken samtale
/// der klikkede - og saa er "alt skrives ned" kun sandt for den foerste.
///
/// Maerket lever kun saa laenge processen goer. Det kan ikke bruges til at
/// genkende brugeren, og det staar aldrig andre steder end i loggen.
export const SESSION = randomUUID().slice(0, 8);

/// Hvilket kald hoerer denne linje til?
///
/// ⛔ Sikkerhedsgennemgangen 24/9: et kald skriver flere linjer - porten
///    («allowed») og udfaldet («ok»/«error») - og med to agenter i gang
///    kunne de ikke parres. «Blev det der blev tilladt ogsaa det der skete?»
///    var ikke til at besvare ud fra loggen. Id'et saettes én gang ved
///    indgangen og foelger kaldet gennem alle dets await, uden at hver
///    record()-linje skal huske at sende det med.
const KALD = new AsyncLocalStorage();
export function iKald(fn) { return KALD.run(randomUUID().slice(0, 8), fn); }
const CLIENT = process.env.CMCP_CLIENT || null;

/// Tekst der skrives ind i et program, logges ALDRIG ordret.
///
/// Loeftet er at adgangskoder ikke forlader maskinen. Et revisionsspor der
/// gemmer hvert tastetryk i klartekst i en fil, ville bryde netop det loefte -
/// og goere loggen til det foerste sted en angriber ville kigge. Vi gemmer
/// laengden og et fingeraftryk: nok til at bevise at to handlinger skrev det
/// samme, aldrig nok til at laese hvad der stod.
/// Saltet. Tilfaeldigt pr. proces, og det forlader ALDRIG hukommelsen.
///
/// ⛔ Uden det var loeftet bogstaveligt sandt og praktisk halvt. Et usaltet
/// sha256 af et otte-tegns kodeord kan gaettes igennem offline af den der har
/// loggen: tolv hex er 48 bit, rigeligt til at bekraefte et gaet. Loggen ville
/// dermed vaere praecis det vores egen artikel advarer imod - stedet hvor
/// hemmeligheden ligger, uden for de kontroller der beskytter originalen.
///
/// Prisen er aerlig og skal staa paa sitet: to handlinger kan stadig
/// sammenlignes inden for SAMME koersel, men ikke paa tvaers af koersler.
/// Det er formaalet loggen har - at vise at agenten skrev det samme to gange -
/// og ikke mere end det.
const SALT = randomBytes(16).toString('hex');

export function fingerprint(text) {
  if (typeof text !== 'string') return null;
  return {
    length: text.length,
    sha256_12: createHash('sha256').update(SALT).update(text).digest('hex').slice(0, 12),
    salted: true
  };
}

// ⛔ FUNDET AF PANELET 19/9 med en maaling, ikke en laesning: den gamle udgave
//    sloerede KUN de tre noegler paa oeverste niveau. En probe viste at samme
//    hemmelighed i `contains`, `message`, `path` og i et indlejret
//    {password: ...} overlevede i KLARTEKST i revisionsloggen - den fil hvis
//    hele pointe er at den ikke maa blive laekagen.
//
//    To rettelser: flere noegler, og REKURSIVT. En hemmelighed et niveau nede
//    er stadig en hemmelighed.
// ⛔ EN NOEGLELISTE OVER DET FARLIGE ER EN DENYLISTE, og den har altid et hul.
//    Foerste rettelse 19/9 var netop det: flere noegler, rekursivt. Den egne
//    proeve faeldede den med det samme - en hemmelighed under en noegle der
//    ikke stod paa listen (`title`, eller et hvilket som helst indlejret navn)
//    stod stadig i KLARTEKST. Samme fejlklasse som "danske ord kan ikke baere
//    en regel": man kan ikke skrive alle navne ned paa forhaand.
//
//    Derfor vendt om: KUN de felter der beskriver HVAD der blev gjort, logges
//    ordret. Alt andet tekst bliver til et fingeraftryk - ogsaa noegler vi
//    aldrig har set. Standarden er sikker, og et nyt vaerktoej med et nyt
//    tekstfelt er dermed daekket den dag det skrives, ikke den dag nogen
//    husker at udvide listen.
//
//    Tal og ja/nej logges som de er: en koordinat eller et loft er ikke en
//    hemmelighed, og uden dem kan loggen ikke laeses.
const STRUKTUR_NOEGLER = new Set([
  // hvem handlingen ramte
  'app', 'bundleId', 'role', 'subrole',
  // menustien - den vigtigste enkeltoplysning i hele loggen: uden den staar
  // der "klikkede i en menu" og ikke HVILKEN. Menutitler er programmets egne,
  // ikke brugerens tekst.
  'path',
  // tastekombinationen: et akkord-navn ("cmd+s"), ikke indtastet tekst
  'combo', 'button', 'direction'
]);

/// Ligner vaerdien det felt den staar i?
const FORMER = {
  // ⛔ `app` stod her foerst med et formkrav - og en 66-tegns hemmelighed slap
  //    igennem, fordi den bestod af bogstaver, tal og bindestreger. Et
  //    formkrav paa fritekst er en kapdyst man taber.
  //
  //    Den rigtige linje er en anden: loggen skal skrive det SERVEREN fandt
  //    frem til, ikke det modellen skrev. Serveren slaar programmet op og
  //    noterer det som `target` - et rigtigt bundle-id, som den selv har
  //    bestemt. Modellens `app` faar derfor et fingeraftryk som al anden
  //    fritekst, og loggen mister ingenting: den kan stadig svare paa hvilket
  //    program handlingen ramte.
  role: (v) => v.length <= 40 && /^[A-Za-z]+$/.test(v),
  subrole: (v) => v.length <= 40 && /^[A-Za-z]+$/.test(v),
  // menusti: korte led adskilt af >
  path: (v) => v.length <= 120 && v.split('>').every(d => d.trim().length <= 48),
  // tastekombination: modifikatorer og en tast
  combo: (v) => v.length <= 40 && /^[\w+ -]+$/.test(v),
  button: (v) => v.length <= 20 && /^[a-z]+$/.test(v),
  direction: (v) => v.length <= 20 && /^[a-z]+$/.test(v),
};

function harRigtigForm(k, v) {
  const f = FORMER[k];
  return f ? f(v) : false;
}

/// Sloerer ALT tekst der ikke beskriver selve handlingen - i vilkaarlig dybde.
export function scrubArgs(args = {}, dybde = 0) {
  if (dybde > 6) return '[for dybt]';
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (Array.isArray(v)) {
      out[k] = v.map(x => (x && typeof x === 'object')
        ? scrubArgs(x, dybde + 1)
        : (typeof x === 'string' && !STRUKTUR_NOEGLER.has(k) ? fingerprint(x) : x));
      continue;
    }
    if (v && typeof v === 'object') { out[k] = scrubArgs(v, dybde + 1); continue; }
    // ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9: en struktur-noegle var nok til at
    //    slippe ordret igennem - men VAERDIEN kommer fra modellen. En
    //    indsproejtning kunne laegge en hemmelighed i `path` eller `app` og faa
    //    den skrevet i klartekst i netop den fil hvis loefte er at den aldrig
    //    indeholder klartekst. Lav udnyttelsesvaerdi, men det er den samme
    //    denylist/allowlist-asymmetri vi vendte om for de andre felter.
    //
    //    Nu skal vaerdien ogsaa have den FORM feltet plejer at have. En
    //    menusti er korte led adskilt af >; en tastekombination er
    //    modifikatorer og en tast. Det der ikke ligner sig selv, faar et
    //    fingeraftryk - saa loggen kan stadig laeses, og kan stadig ikke
    //    bruges som gemmested.
    if (typeof v === 'string' && !(STRUKTUR_NOEGLER.has(k) && harRigtigForm(k, v))) {
      out[k] = fingerprint(v); continue;
    }
    out[k] = v;
  }
  return out;
}

/// Det der venter paa et menneske.
///
/// ⛔ Gustav, 20/9: naar produktet aldrig maa tage skaermen, kan det heller ikke
///    banke paa. I dag AFVISES en handling der ville kraeve en dialog, og
///    forklaringen gaar til modellen - som skal sige det i chatten. Det virker
///    kun hvis nogen laeser praecis den chat.
///
///    Koeen goer det synligt: hvad blev afvist, hvornaar, og hvorfor. Den er
///    en LISTE, ikke en knap. Man kan ikke godkende noget herfra - et samtykke
///    uden et menneske er praecis det porten findes for. Vil man give lov,
///    skifter man tilstand; koeen fortaeller bare hvad der venter.
const KOE = join(DIR, 'pending.jsonl');

export function noterVentende(post) {
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
    appendFileSync(KOE, JSON.stringify({ ts: new Date().toISOString(), session: SESSION, ...post }) + '\n',
                   { mode: 0o600 });
    chmodSync(KOE, 0o600);
  } catch { /* en koe der ikke kan skrives, maa ikke vaelte en koersel */ }
}

export function ventende(limit = 20) {
  try {
    if (!existsSync(KOE)) return [];
    return readFileSync(KOE, 'utf8').trim().split('\n').filter(Boolean)
      .slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

export const KOE_PATH = KOE;

let warned = false;
/// Kom den SIDSTE linje ned i loggen? Serveren spoerger foer hver skrivende
/// handling. ⛔ Foer 24/9 stod der «actions still run, but they are not
/// recorded»: en fuld disk eller en laast mappe gjorde sporet hullet, og
/// produktet koerte videre som om intet var sket. Et spor med huller er ikke
/// et spor - saa en handling der ikke kan skrives ned, sker ikke.
let sidsteSkrevet = true;
export function loggenKanSkrives() { return sidsteSkrevet; }

/// ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9: "append-only" var en HENSIGT, ikke en
/// mekanisme. Det var appendFileSync plus chmod 0600 - og intet der kunne
/// opdage at en linje var fjernet, mens sitet sagde "a log that can only be
/// added to, never edited".
///
/// Et loefte uden en proeve er en paastand. Derfor en rullende kaede: hver
/// linje baerer et fingeraftryk af sig selv OG af den foregaaende. Fjernes en
/// linje, eller aendres ét tegn i den, holder kaeden ikke laengere fra det
/// sted og frem - og `computer_audit` siger det.
///
/// Den aerlige graense, som ogsaa staar paa sitet: kaeden beviser at INGEN
/// LINJE er fjernet eller aendret. Den forhindrer ikke at hele filen slettes,
/// og den kan ikke: en log paa din egen maskine ejes af dig.
// ⛔ FUNDET 21/9, og det var vores egen samtidighed der loej.
//
//    `sidsteHash` var en variabel i PROCESSEN. Produktet lover samtidig at
//    «several can run at once - no lock file». Fire servere paa én maskine
//    skriver i den samme fil, hver med sit eget billede af hvor kaeden slap,
//    og saa braekker den.
//
//    MAALT i menneskets egen log: 3.804 linjer, 3 brud - og ALLE TRE laa
//    praecis paa et sessionsskift. `computer_audit` sagde dermed
//    «a line was removed or edited» til en bruger hvor intet var fjernet.
//    En falsk alarm paa et sikkerhedsloefte er vaerre end ingen alarm: den
//    laerer folk at ignorere den.
//
//    Rettelsen er ikke at svaekke kaeden til at vaere pr. session - saa kunne
//    en HEL session fjernes uden at noget braekkede. Rettelsen er at laese
//    hvor kaeden slap FRA FILEN, under en laas, umiddelbart foer vi skriver.
//    Saa er der stadig én kaede over hele filen, og to servere kan ikke
//    overhale hinanden. MAALT: uden laasen giver fire samtidige skrivere
//    127 brud paa 190 linjer; med den, nul.
const LOCK = FILE + '.lock';
const SOVEPLADS = new Int32Array(new SharedArrayBuffer(4));
const sov = (ms) => { try { Atomics.wait(SOVEPLADS, 0, 0, ms); } catch { /* uden SAB: videre */ } };

/// Koerer `fn` med skrive-laasen taget. Kan laasen ikke faas, koeres `fn`
/// ALLIGEVEL: en tabt linje er vaerre end en linje der braekker kaeden, for
/// den foerste er usynlig og den anden siger det selv.
function medLaas(fn) {
  const start = Date.now();
  for (;;) {
    // ⛔ FUNDET AF REVIEWET: `try { return fn() } finally {...}` laa INDE i det
    //    ydre try. Kastede fn(), landede undtagelsen i catch(err), hvor
    //    err.code !== 'EEXIST' gav `return fn()` - altsaa et ANDET kald, nu
    //    uden laas. En dublet-revisionslinje den dag noget kaster.
    let laast = false;
    try {
      const fd = openSync(LOCK, 'wx');
      try { writeSync(fd, String(process.pid)); } catch { /* ligegyldigt */ }
      closeSync(fd);
      laast = true;
    } catch (err) {
      if (err.code !== 'EEXIST') return fn(false);
      // ⛔ FUNDET AF MODSTANDER-REVIEWET 21/9, tre ting i fem linjer:
      //
      //    1. `catch { continue; }` sprang BAADE tidsgraensen og sov() over.
      //       Var laasen en haengende symlink, gav openSync EEXIST for evigt
      //       og statSync kastede for evigt: record() vendte aldrig tilbage,
      //       100 % CPU, paa hvert eneste vaerktoejskald.
      //    2. Vinduet paa 2 sekunder var kortere end de maskintilstande
      //       repoet SELV dokumenterer (hjaelperen maalt til 23-38 sekunder
      //       under load 143). En stallet skriver fik sin laas braekket af en
      //       anden, og saa skrev begge - praecis det kaedebrud laasen findes
      //       for at fjerne.
      //    3. Pid'et blev SKREVET i laasen og aldrig laest.
      //
      //    Nu: laasen braekkes kun hvis processen bag den er vaek, eller hvis
      //    den er over 30 sekunder gammel. Og ingen gren springer sov() over.
      let braek = false;
      try {
        const alder = Date.now() - statSync(LOCK).mtimeMs;
        const ejer = Number(readFileSync(LOCK, 'utf8').trim());
        let lever = true;
        if (Number.isInteger(ejer) && ejer > 0) {
          try { process.kill(ejer, 0); } catch (e) { lever = e.code !== 'EPERM'; }
        }
        braek = !lever || alder > 30000;
      } catch { /* ikke stat-bar: fald igennem til tidsgraensen */ }
      if (braek) { try { unlinkSync(LOCK); } catch { /* en anden naaede det */ } continue; }
      if (Date.now() - start > 3000) return fn(false);
      sov(5);
      continue;
    }
    // Laasen er vores. fn() koerer UDEN FOR det ydre try, saa en undtagelse
    // herfra aldrig kan blive til et andet kald.
    if (laast) {
      try { return fn(true); } finally { try { unlinkSync(LOCK); } catch { /* videre */ } }
    }
  }
}

/// Sidste kaede-fingeraftryk, laest fra HALEN af filen.
///
/// Hele filen laeses ikke: den vokser, og det her koerer foer hver eneste
/// linje. 8 KiB er rigeligt til de sidste linjer; findes der intet
/// fingeraftryk der, falder vi tilbage til hele filen.
function haleHash() {
  try {
    if (!existsSync(FILE)) return '';
    const st = statSync(FILE);
    if (!st.size) return '';
    const n = Math.min(st.size, 8192);
    const buf = Buffer.alloc(n);
    const fd = openSync(FILE, 'r');
    try { readSync(fd, buf, 0, n, st.size - n); } finally { closeSync(fd); }
    const linjer = buf.toString('utf8').split('\n').filter(Boolean);
    for (let i = linjer.length - 1; i >= 0; i--) {
      try { const d = JSON.parse(linjer[i]); if (d.kaede) return d.kaede; } catch { /* halv linje */ }
    }
    return heleFilenHash();
  } catch {
    // ⛔ FUNDET AF MODSTANDER-REVIEWET: '' betyder «filen er tom». En
    //    kortvarig laesefejl (EMFILE, EACCES) gav ogsaa '', saa kaeden startede
    //    forfra - og fordi linjen BAERER `l:1`, ville den senere blive meldt
    //    som MANIPULATION. Den falske alarm jeg lige havde fjernet, ad en
    //    anden doer. `null` betyder «jeg kunne ikke laese», og den linje
    //    skrives uden maerket.
    return null;
  }
}

export function record(entry) {
  const uden = JSON.stringify({
    ts: new Date().toISOString(), session: SESSION, ...(KALD.getStore() ? { call: KALD.getStore() } : {}),
    ...(CLIENT ? { client: CLIENT } : {}), ...entry, l: 1
  });
  return medLaas((harLaas) => {
    const forrige = haleHash();
    // Kunne halen ikke laeses, er kaeden ikke troovaerdig herfra - og saa maa
    // linjen ikke baere maerket, for saa ville bruddet blive meldt som noget
    // et menneske havde gjort.
    // ⛔ MAALT AF REVIEWET: 2 af 6 gange skrev to servere uden laas efter
    //    3-sekunders-faldbaggen, linjerne bar `l:1`, og `computer_audit`
    //    meldte dem som MANIPULATION. Faldbaggen genskabte praecis den falske
    //    alarm laasen findes for at fjerne. Maerket betyder «skrevet under
    //    laas» - saa skal det kun staa der naar det er sandt.
    const paalidelig = harLaas && forrige !== null;
    const linje = paalidelig ? uden : uden.replace(/,"l":1}$/, '}');
    const h = createHash('sha256').update(String(forrige ?? '')).update(linje).digest('hex').slice(0, 16);
    const line = linje.slice(0, -1) + `,"kaede":"${h}"}`;
    try {
      if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
      appendFileSync(FILE, line + '\n', { mode: 0o600 });
      chmodSync(FILE, 0o600);
      sidsteSkrevet = true;
      // Ankeret skrives under SAMME laas, lige efter linjen. Forsvinder
      // halen senere, staar ankerets fingeraftryk ikke i filen mere.
      if (paalidelig) {
        // Taelleren starter fra filens egen laengde foerste gang, saa en log
        // der fandtes foer ankeret, ikke straks meldes som afkortet.
        const anker = laesAnker();
        const n = Number.isInteger(anker?.n) ? anker.n + 1 : linjerILoggen();
        skrivAnker(h, n);
      }
    } catch (err) {
      sidsteSkrevet = false;
      if (!warned) {
        warned = true;
        process.stderr.write(`[computer-mcp] the audit log cannot be written (${err.code}); every write action is refused until it can\n`);
      }
    }
    return line;
  });
}

/// Hvor kaeden slap sidst - saa en genstartet server fortsaetter den samme
/// kaede i stedet for at begynde forfra.
function heleFilenHash() {
  try {
    if (!existsSync(FILE)) return '';
    const linjer = readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean);
    for (let i = linjer.length - 1; i >= 0; i--) {
      try { const d = JSON.parse(linjer[i]); if (d.kaede) return d.kaede; } catch { /* videre */ }
    }
    return '';
  } catch { return ''; }
}

/// Gaar kaeden fra ende til anden? Svarer hvor den foerste gang ikke goer.
/// Gaar kaeden fra ende til anden? Svarer med HVERT brud, og hvad det er.
///
/// ⛔ Hvorfor to slags brud: indtil 21/9 huskede hver server-proces selv hvor
///    kaeden slap, saa to samtidige servere braekkede den uden at nogen havde
///    roert filen. De linjer baerer ikke `l:1`. Fra og med laasen goer de det.
///    Et brud paa en linje UDEN maerket er derfor vores egen gamle
///    samtidighed; et brud paa en linje MED maerket er en linje der er fjernet
///    eller aendret. At kalde det foerste for manipulation laerer folk at
///    ignorere alarmen - og saa virker den heller ikke naar den er aegte.
/// ⛔ KONSULENTEN 22/9, to huller i «append-only»:
///    (1) et laesefejl svarede `ok: true` - altsaa «kaeden holder» om en fil
///        vi ikke kunne laese.
///    (2) kaeden binder hver linje til den FORRIGE. Fjerner man de sidste
///        linjer, er resten stadig en gyldig kaede. En hale kan altsaa
///        forsvinde uden at nogen opdager det.
///    Ankeret lukker (2): sidste linjes fingeraftryk skrives ved siden af,
///    under samme laas. Findes ankerets fingeraftryk ikke i filen laengere,
///    er halen fjernet. Det kan stadig ikke forhindre at HELE filen slettes -
///    en log paa din egen maskine ejes af dig - men det kan ikke ske i
///    stilhed.
const ANKER = join(DIR, 'kaede-anker.json');

/// ⛔ ASTRA, runde 1 (23/9): mit foerste anker kunne NULSTILLE SIG SELV.
///    Det gemte kun sidste linjes fingeraftryk, og `record()` overskrev det
///    ved hver skrivning. Fjernede man halen og lod agenten arbejde videre,
///    var sporet «helt» igen efter ét helt normalt kald. Vagten holdt til
///    naeste linje.
///    Nu taeller ankeret hvor mange linjer der ER skrevet. Tallet kan kun gaa
///    op, saa en fil med faerre linjer end taelleren har mistet noget - ogsaa
///    efter hundrede nye kald.
function laesAnker() {
  try { return JSON.parse(readFileSync(ANKER, 'utf8')); } catch { return null; }
}

function skrivAnker(hash, n) {
  try {
    writeFileSync(ANKER + '.tmp', JSON.stringify({ hash, n, ts: new Date().toISOString() }), { mode: 0o600 });
    renameSync(ANKER + '.tmp', ANKER);
  } catch { /* ankeret maa aldrig vaelte en skrivning */ }
}

/// Hvor mange linjer staar der i loggen lige nu?
function linjerILoggen() {
  try { return readFileSync(FILE, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
}

export function kaedenHolder() {
  try {
    if (!existsSync(FILE)) return { ok: true, checked: 0, gamle: 0, aegte: 0 };
    const linjer = readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean);
    // Hvor begynder laase-aeraen? Foerste linje der baerer maerket.
    let laaseAeraFra = null;
    for (let i = 0; i < linjer.length; i++) {
      if (linjer[i].includes('"l":1')) { laaseAeraFra = i; break; }
    }
    let forrige = '', tjekket = 0;
    const gamle = [], aegte = [];
    for (let i = 0; i < linjer.length; i++) {
      let d; try { d = JSON.parse(linjer[i]); } catch { continue; }
      if (!d.kaede) { forrige = ''; continue; }   // linjer fra foer kaeden fandtes
      const uden = linjer[i].replace(`,"kaede":"${d.kaede}"}`, '}');
      const vent = createHash('sha256').update(forrige).update(uden).digest('hex').slice(0, 16);
      tjekket++;
      // ⛔ FUNDET AF MODSTANDER-REVIEWET: maerket sidder paa den linje der
      //    mistaenkes, saa den der piller kan bare fjerne det og faa sit brud
      //    kaldt «gammel samtidighed». Amnestien er derfor tidsbegraenset:
      //    en linje UDEN maerket taeller kun som gammel hvis den ogsaa er
      //    skrevet FOER laasen fandtes. Efter det er et manglende maerke i sig
      //    selv mistaenkeligt.
      //
      //    Den aerlige graense, som ogsaa staar paa sitet: en log paa din egen
      //    maskine ejes af dig. Kaeden beviser at ingen linje er fjernet eller
      //    aendret; den kan ikke forhindre at hele filen slettes, og den kan
      //    ikke goere en ejer til en fremmed.
      if (vent !== d.kaede) {
        // ⛔ RETTET IGEN, af det andet modstander-review samme aften, og den
        //    her udgave er den rigtige.
        //
        //    Foerste forsoeg laeste maerket `l` FRA DEN LINJE DER ER UNDER
        //    MISTANKE. Den der piller kunne altsaa bare fjerne seks tegn og
        //    faa sit brud kaldt «gammel samtidighed». MAALT af reviewet:
        //    linje redigeret + maerket fjernet -> {ok:true, aegte:0, gamle:1}.
        //    Andet forsoeg satte en dato-graense - samme hul, for `ts` kan
        //    ogsaa aendres.
        //
        //    Nu: POSITION. Laase-aeraen begynder ved filens FOERSTE linje med
        //    maerket. Alt foer den kan baere et brud fra to servere; alt efter
        //    kan ikke. At snyde det kraever at fjerne maerket fra ALLE linjer
        //    foran - og det braekker kaeden overalt.
        ((laaseAeraFra === null || i < laaseAeraFra) ? gamle : aegte).push(i + 1);
      }
      forrige = d.kaede;                          // fortsaet, saa ALLE brud findes
    }
    // Er halen fjernet? Ankerets fingeraftryk skal stadig staa i filen.
    let haleFjernet = false;
    try {
      const anker = laesAnker();
      if (anker) {
        // To spoergsmaal, og det andet kan ikke skjules af nye linjer:
        //   1. staar ankerets fingeraftryk stadig i filen?
        //   2. er der faerre linjer end vi HAR skrevet?
        if (anker.hash && !linjer.some(l => l.includes(`"kaede":"${anker.hash}"`))) haleFjernet = true;
        if (Number.isInteger(anker.n) && linjer.length < anker.n) haleFjernet = true;
      }
    } catch { /* et ulaeseligt anker er ikke et bevis for noget */ }
    return {
      ok: aegte.length === 0 && !haleFjernet, checked: tjekket,
      gamle: gamle.length, aegte: aegte.length,
      tail_removed: haleFjernet || undefined,
      brudtVedLinje: aegte[0] ?? gamle[0] ?? null,
    };
  } catch (err) {
    // ⛔ Et laesefejl er IKKE «kaeden holder». Det er «vi ved det ikke».
    return { ok: null, ukendt: true, grund: String(err.message).slice(0, 120), checked: 0, gamle: 0, aegte: 0 };
  }
}

export const AUDIT_PATH = FILE;
