// «Kraever menneske» uden at tage skaermen: spoerg menulinje-ikonet.
//
// Tilfoejet 22/9 efter Gustavs oenske og et konsulentpanel (Fable + sikkerhed).
// I baggrundstilstand afviste porten alt der kraevede et ja, fordi en dialog
// tager skaermen. Nu kan den i stedet lade ikonet blive orange og VENTE paa
// at mennesket svarer - naar det passer ham.
//
// Panelets krav, alle bygget her eller i ikonet:
//   - Svaret gaar tilbage ad SAMME forbindelse som spoergsmaalet, saa et svar
//     ikke kan lande hos en anden agent. (Fable foreslog en fil; sikkerheden
//     fandt at en fil kan skrives af en agent med blot et fil-vaerktoej.)
//     ⛔ Rettet 22/9 efter runde 2: her stod at en agent med kun et
//     fil-vaerktoej heller ikke kan svare. Det er ikke sandt - den kan
//     overskrive ikonets egen binaer, som serveren saa starter. Det samme
//     gaelder allerede hjaelperen. Touch ID holder: en falsk lytter kan sige
//     ja, men ikke med menneskets finger.
//   - Nonce paa 128 bit, kun i hukommelsen, bruges én gang, har en frist.
//     Et svar med en anden nonce, efter fristen eller paa en lukket
//     forbindelse, er et nej.
//   - Ikonet kraever Touch ID (eller Mac'ens kodeord) for hvert ja.
//   - Hvad der ALDRIG kan godkendes herfra, afgoeres i policy.js, ikke her.
//
// ⛔ Hvad dette IKKE beskytter imod, og det skal staa aerligt: en agent med
//    en shell under samme bruger kan draebe ikonet og lytte paa stien selv.
//    Den kan ogsaa klikke paa alt med osascript uden om os. Porten vogter
//    VAERKTOEJS-kanalen; den er ikke et faengsel.
import { createConnection } from 'net';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { startIkon } from './status.js';
import { maalSpoergsmaal } from './tilstede.js';

/// Seneste spoergsmaals maaling (punkt P). Hver agent har hoejst ét spoergsmaal ad
/// gangen (`venter`), saa index.js tager den til netop den loglinje.
let senesteMaaling = null;
export function tagMaaling() { const m = senesteMaaling; senesteMaaling = null; return m; }

const DIR = process.env.CMCP_STATE_DIR || join(homedir(), '.local', 'state', 'computer-mcp');
export const IKON_SOCKET = join(DIR, 'ikon.sock');

/// ⛔ Et ja skal daekke ALT det mennesket saa (29/9, panelet). Foer klippede
///    protokollen teksten ved 200 tegn og Touch ID-arket ved 80 - tavst. Nu
///    gaar hele teksten til ikonet, som viser den ombrudt over «Allow». En
///    tekst over loftet spoerges slet ikke: hellere et nej end et ja til noget
///    halvt laest.
export const TEKST_LOFT = 4000;

let venter = false;          // hoejst ét aabent spoergsmaal pr. agent
let pauseTil = 0;            // efter et nej: ingen nye spoergsmaal i et stykke tid
const PAUSE_MS = 30_000;

/// Spoerg ikonet. Returnerer { ok, grund }. Kaster aldrig.
/// ⛔ MAALT 22/9 i den levende Touch ID-proeve: agentens foerste spoergsmaal
///    kom 0,1 sek efter serveren startede - foer ikonet havde aabnet sin
///    socket - og blev afvist med «ikonet koerer ikke». Samme hvis mennesket
///    har skjult ikonet. Nu startes det, og vi venter op til fem sekunder.
///
/// ⛔ Og MAALT samme time: et ikon der blev lukket eller gik ned, efterlod
///    socket-filen. «Findes filen?» svarede ja, forbindelsen blev afvist, og
///    spoergsmaalet ogsaa. Nu spoerges om der SVARES, ikke om filen findes.
function kanForbinde() {
  return new Promise(res => {
    if (!existsSync(IKON_SOCKET)) return res(false);
    const s = createConnection(IKON_SOCKET);
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
  });
}

async function ikonetKlar() {
  if (await kanForbinde()) return true;
  const start = startIkon(join(dirname(fileURLToPath(import.meta.url)), 'vendor'));
  if (start !== 'started' && start !== 'running') return false;
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (await kanForbinde()) return true;
  }
  return false;
}

/// `computer_ask_user` i baggrund (29/9): mennesket goer det selv - taster et
/// kodeord, godkender en OAuth-side - og trykker «Done». Et signal, ikke et
/// samtykke: «done» godtages KUN paa et spoergsmaal af denne slags, saa det
/// aldrig kan blive til et ja til en anden handling.
export async function spoergOmGoerSelv(sp, timeoutSec) {
  return spoergIkonet({ ...sp, kind: 'goer-selv' }, timeoutSec);
}

/// ⛔ SKAERM-LAANET (29/9, panelet: «tilstanden ejes af ikonet, ikke af en
///    env-var»). Mennesket giver EN agent skaermen i hoejst 15 minutter, med
///    Touch ID. Laanet ER forbindelsen: ikonet holder den aaben saa laenge
///    laanet gaelder, og lukker den naar tiden er gaaet, naar mennesket tager
///    skaermen tilbage, eller naar ikonet doer. Saa kalder vi `slut` - der er
///    ingen fil en agent kan pille ved, og intet der skal spoerges om igen.
///    Svarer { ok, grund, til, afslut } - `til` er det tidligste af vores og
///    ikonets ur; `afslut` giver skaermen tilbage foer tid.
export async function laanSkaermen({ session, client, text, minutter }, timeoutSec, slut) {
  if (venter) return { ok: false, grund: 'this agent already has a question waiting in the menu bar' };
  if (Date.now() < pauseTil) return { ok: false, grund: 'the person just said no; this agent may not ask again for 30 seconds' };
  // Runde 1 (Astra 8): over loftet spoerges der ikke - samme regel som samtykket.
  const helTekst = ren(text).trim();
  if ([...helTekst].length > TEKST_LOFT) return { ok: false, grund: `the reason is ${[...helTekst].length} characters - more than the ${TEKST_LOFT} the menu bar shows in full` };
  if (!(await ikonetKlar())) return { ok: false, grund: 'the menu bar icon is not running' };
  return new Promise((resolve) => {
    venter = true;
    senesteMaaling = null;
    const afslutMaaling = maalSpoergsmaal();
    const nonce = randomBytes(16).toString('hex');
    const frist = Date.now() + timeoutSec * 1000;
    let buf = '', svaret = false, lukket = false;
    // Maalingen (punkt P) skal staa paa loglinjen, saa svaret venter paa den - hoejst
    // 1,5 s. Ved et ja maales ingen ny idle (et menneske svarede netop); kun maalingen
    // fra spoergsmaalets start, som et menneskes svartid normalt allerede har overhalet.
    const afgoer = (v) => {
      if (svaret) return; svaret = true; venter = false; clearTimeout(ur);
      afslutMaaling(v.ok === true).then((x) => { senesteMaaling = x; }, () => {}).finally(() => resolve(v));
    };
    const sock = createConnection(IKON_SOCKET);
    const ur = setTimeout(() => { afgoer({ ok: false, grund: 'nobody answered in the menu bar in time' }); sock.destroy(); }, timeoutSec * 1000);
    sock.on('connect', () => {
      sock.write(JSON.stringify({
        nonce, session, client: ren(client).slice(0, 200), text: helTekst,
        scope: `If you allow it, the agent may use your screen for ${minutter} minutes: move the pointer, type into the app in front and bring windows forward. Before each step it waits if you are using the keyboard or mouse; a step already running finishes, or stops at once when you take the screen back. Password apps, deletions, and messages in the apps and web chats it recognises still ask. Take the screen back at any time with Take the screen back now, in the box in the corner of your screen or in this menu.`,
        target: 'your screen', kind: 'screen', minutes: minutter, expires: frist
      }) + '\n');
    });
    sock.on('data', (d) => {
      if (svaret) return;
      buf += d;
      const i = buf.indexOf('\n'); if (i < 0) return;
      let m = null; try { m = JSON.parse(buf.slice(0, i)); } catch {}
      if (!m || m.nonce !== nonce) { afgoer({ ok: false, grund: 'the answer did not match the question' }); return sock.destroy(); }
      if (Date.now() > frist) { afgoer({ ok: false, grund: 'the answer came after the question had expired' }); return sock.destroy(); }
      if (m.ok === true && m.verified === 'owner') {
        const vores = Date.now() + minutter * 60_000;
        const til = Math.min(vores, Number(m.until) > 0 ? Number(m.until) : vores);
        return afgoer({ ok: true, til, afslut: () => sock.destroy(), grund: 'the person gave this agent the screen and confirmed it was them' });
      }
      if (m.verified === 'optaget') { afgoer({ ok: false, grund: 'another agent has the screen right now' }); return sock.destroy(); }
      if (m.ok === false) pauseTil = Date.now() + PAUSE_MS;
      afgoer({ ok: false, grund: m.ok === false ? 'the person said no in the menu bar' : 'the answer was not confirmed by the person (Touch ID or password)' });
      sock.destroy();
    });
    const luk = () => {
      if (lukket) return; lukket = true;
      if (!svaret) return afgoer({ ok: false, grund: 'the menu bar icon closed without an answer' });
      slut?.();
    };
    sock.on('close', luk);
    sock.on('error', luk);
  });
}

/// ⛔ Runde 2 30/9 (Astra 6): loft, pause og et ventende spoergsmaal tjekkes FOER
///    det afgoeres om ikonet koerer - ellers blev et manglende ikon til en boks
///    med 4.001 tegn, eller en boks lige efter et nej.
function forhaandsNej(text) {
  const n = [...ren(text).trim()].length;
  if (n > TEKST_LOFT) return `the action is ${n} characters - more than the ${TEKST_LOFT} the menu bar shows in full, and a yes must cover everything the person saw`;
  if (venter) return 'this agent already has a question waiting in the menu bar';
  if (Date.now() < pauseTil) return 'the person just said no; this agent may not ask again for 30 seconds';
  return null;
}

export async function spoergIkonet(sp, timeoutSec) {
  const nej = forhaandsNej(sp.text);
  if (nej) return { ok: false, ikkeSpurgt: true, grund: nej };
  if (!(await ikonetKlar())) {
    return { ok: false, ikkeSpurgt: true, ikkeKoerer: true, grund: 'the menu bar icon is not running' };
  }
  return spoerg(sp, timeoutSec);
}

// Renses for ALT usynligt: linjeskift, men ogsaa U+2028/2029, U+0085,
// retningstegn (U+202E) og nul-bredde-tegn. Sikkerhedskonsulenten,
// runde 2: kun \r\n\t var fjernet, saa modellen kunne vende teksten
// eller skubbe maalet ud af Touch ID-arket.
const ren = (v) => String(v ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ');

function spoerg({ session, client, text, scope, target, kind = null, targetBundle = null }, timeoutSec) {
  return new Promise((resolve) => {
    // Loftet er afgjort i forhaandsNej() foer vi kom hertil (spoerg kaldes kun fra
    // spoergIkonet) - én vagt pr. regel. «venter» og pausen tjekkes IGEN her, fordi
    // der ligger et await (ikonetKlar) imellem: to samtidige kald kan begge have
    // passeret forhaandsNej (runde 3, Fable a).
    const helTekst = ren(text).trim();
    if (!existsSync(IKON_SOCKET)) return resolve({ ok: false, ikkeSpurgt: true, ikkeKoerer: true, grund: 'the menu bar icon is not running' });
    if (venter) return resolve({ ok: false, ikkeSpurgt: true, grund: 'this agent already has a question waiting in the menu bar' });
    if (Date.now() < pauseTil) return resolve({ ok: false, ikkeSpurgt: true, grund: 'the person just said no; this agent may not ask again for 30 seconds' });

    venter = true;
    senesteMaaling = null;
    const afslutMaaling = maalSpoergsmaal();
    const nonce = randomBytes(16).toString('hex');
    // ⛔ Astra, runde 2 (22/9): fristen blev kun haandhaevet af en timer. En
    //    timer kan komme for sent (maskinen sover, kaldet er forsinket), og saa
    //    ville et ja efter fristen blive accepteret. Nu sammenlignes uret ogsaa.
    const frist = Date.now() + timeoutSec * 1000;
    let buf = '';
    let faerdig = false;
    const slut = (svar) => {
      if (faerdig) return;
      faerdig = true;
      venter = false;
      clearTimeout(ur);
      try { sock.destroy(); } catch {}
      if (!svar.ok && svar.menneske) pauseTil = Date.now() + PAUSE_MS;
      // Maalingen aendrer aldrig svaret; den forsinker det hoejst 1,5 s (se laanSkaermen).
      afslutMaaling(svar.ok === true).then((x) => { senesteMaaling = x; }, () => {}).finally(() => resolve(svar));
    };
    const ur = setTimeout(() => slut({ ok: false, grund: 'nobody answered in the menu bar in time' }), timeoutSec * 1000);
    const sock = createConnection(IKON_SOCKET);
    sock.on('connect', () => {
      // De faste felter skrives af serveren og holdes korte; teksten sendes hel.
      const kort = (v) => ren(v).slice(0, 200);
      sock.write(JSON.stringify({
        nonce, session, client: kort(client), text: helTekst, scope: kort(scope), target: kort(target),
        kind, targetBundle: targetBundle ? kort(targetBundle) : null,
        expires: Date.now() + timeoutSec * 1000
      }) + '\n');
    });
    sock.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      let m = null;
      try { m = JSON.parse(buf.slice(0, i)); } catch {}
      if (!m || m.nonce !== nonce) return slut({ ok: false, grund: 'the answer did not match the question' });
      if (Date.now() > frist) return slut({ ok: false, grund: 'the answer came after the question had expired' });
      if (m.ok === true && m.verified === 'owner') return slut({ ok: true, grund: 'the person approved in the menu bar and confirmed it was them' });
      if (m.ok === true && m.verified === 'done' && kind === 'goer-selv') return slut({ ok: true, grund: 'the person says it is done' });
      // Kun et udtrykkeligt nej er et menneskes nej - og kun det giver pausen.
      // Et ja uden bekraeftelse er ikke et ja, men heller ikke et menneske der
      // har sagt fra; en pause ville straffe mennesket for en fejl i ikonet.
      if (m.ok === false) return slut({ ok: false, menneske: true, grund: 'the person said no in the menu bar' });
      return slut({ ok: false, grund: 'the answer was not confirmed by the person (Touch ID or password)' });
    });
    sock.on('error', () => slut({ ok: false, ikkeSpurgt: true, ikkeKoerer: true, grund: 'the menu bar icon could not be reached' }));
    sock.on('close', () => slut({ ok: false, grund: 'the menu bar icon closed without an answer' }));
  });
}
