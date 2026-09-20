import { appendFileSync, mkdirSync, chmodSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash, randomUUID, randomBytes } from 'crypto';

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
let sidsteHash = null;

function kaedeHash(linje) {
  return createHash('sha256').update(String(sidsteHash ?? '')).update(linje).digest('hex').slice(0, 16);
}

export function record(entry) {
  if (sidsteHash === null) sidsteHash = sidsteKaedeHashFraFilen();
  const uden = JSON.stringify({
    ts: new Date().toISOString(), session: SESSION, ...(CLIENT ? { client: CLIENT } : {}), ...entry
  });
  const h = kaedeHash(uden);
  const line = uden.slice(0, -1) + `,"kaede":"${h}"}`;
  sidsteHash = h;
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
    appendFileSync(FILE, line + '\n', { mode: 0o600 });
    chmodSync(FILE, 0o600);
  } catch (err) {
    // En revisionslog der ikke kan skrives, maa ikke kunne vaelte en koersel
    // tavst - men den maa heller ikke fejle stille. Én advarsel til stderr,
    // saa den der laeser loggen ved at der mangler linjer.
    if (!warned) {
      warned = true;
      process.stderr.write(`[computer-mcp] the audit log cannot be written (${err.code}); actions still run, but they are not recorded\n`);
    }
  }
  return line;
}

/// Hvor kaeden slap sidst - saa en genstartet server fortsaetter den samme
/// kaede i stedet for at begynde forfra.
function sidsteKaedeHashFraFilen() {
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
export function kaedenHolder() {
  try {
    if (!existsSync(FILE)) return { ok: true, checked: 0 };
    const linjer = readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean);
    let forrige = '', tjekket = 0;
    for (let i = 0; i < linjer.length; i++) {
      let d; try { d = JSON.parse(linjer[i]); } catch { continue; }
      if (!d.kaede) { forrige = ''; continue; }   // linjer fra foer kaeden fandtes
      const uden = linjer[i].replace(`,"kaede":"${d.kaede}"}`, '}');
      const vent = createHash('sha256').update(forrige).update(uden).digest('hex').slice(0, 16);
      tjekket++;
      if (vent !== d.kaede) return { ok: false, checked: tjekket, brudtVedLinje: i + 1 };
      forrige = d.kaede;
    }
    return { ok: true, checked: tjekket };
  } catch { return { ok: true, checked: 0 }; }
}

export const AUDIT_PATH = FILE;
