import { appendFileSync, mkdirSync, chmodSync, existsSync } from 'fs';
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
    if (typeof v === 'string' && !STRUKTUR_NOEGLER.has(k)) { out[k] = fingerprint(v); continue; }
    out[k] = v;
  }
  return out;
}

let warned = false;

export function record(entry) {
  const line = JSON.stringify({
    ts: new Date().toISOString(), session: SESSION, ...(CLIENT ? { client: CLIENT } : {}), ...entry
  });
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

export const AUDIT_PATH = FILE;
