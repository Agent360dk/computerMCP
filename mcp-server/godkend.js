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
//   - Nonce paa 128 bit, bruges én gang, har en frist. (Bannerets id er ikke noncen - R39.)
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
import { randomBytes, createHash } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
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
/// ⛔ S3 (15/10, R38 Astra + Opus): et kald maa ikke hænge til klienten skærer det af (Codex og MCP-SDK'et:
///    60 s). Kaldet svarer derfor senest efter VINDUET med «venter stadig - sig det i chatten», mens
///    spoergsmaalet bliver i boksen i LEVETIDEN. Et svar, der kommer bagefter, gemmes - bundet til PRÆCIS
///    samme spoergsmaal (session, tekst, omfang, maal, slags) - og hentes ved at kalde igen med de samme
///    argumenter. Et ja bruges én gang. Korte frister (proeverne) opfoerer sig som foer.
const vindueSek = () => { const v = Number(process.env.CMCP_ASK_WINDOW); return Number.isFinite(v) && v > 0 ? v : 45; };
const gemtSek = () => { const v = Number(process.env.CMCP_ASK_KEEP); return Number.isFinite(v) && v > 0 ? v : 120; };
const levetidSek = () => { const v = Number(process.env.CMCP_ASK_LIFE); return Number.isFinite(v) && v > 0 ? v : 600; };
let udestaaende = null;      // det spoergsmaal der VENTER i boksen: { noegle, status, svar, frist, venteliste }
/// ⛔ R40 (Astra, MAALT): et senere svar blev overskrevet, saa snart agenten spurgte om noget andet. Svar
///    der kom efter kaldet, gemmes nu PR. HANDLING, til de hentes eller spoergsmaalets frist udloeber.
const gemte = new Map();     // noegle -> u (status 'ja' | 'nej')

/// ⛔ R39 (Astra + Opus, MAALT): noeglen var den VISTE tekst - og den er tabsgivende (to knapper med
///    forskelligt indeks; to forskellige tekster som begge vises «Type 8 characters»). Et senere ja er nu
///    ogsaa bundet til et fingeraftryk af vaerktoejet og ALLE dets argumenter, sat af serveren om hvert kald.
const HANDLING = new AsyncLocalStorage();
const kanonisk = (v) => Array.isArray(v) ? v.map(kanonisk)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, kanonisk(v[k])])) : v;
export function iHandling(navn, args, fn) {
  const id = createHash('sha256').update(JSON.stringify([navn, kanonisk(args ?? {})])).digest('hex');
  return HANDLING.run({ id, venterStadig: false }, fn);
}
/// Svarede porten «venter stadig» i dette kald? (Saa er det ikke et afslag, ikke koe og ikke «denied».)
export function handlingVenterStadig() { return HANDLING.getStore()?.venterStadig === true; }
const venterStadig = (svar) => { const st = HANDLING.getStore(); if (st) st.venterStadig = true; return svar; };

const noegleFor = ({ session, client, text, scope, target, kind = null, targetBundle = null }) => {
  const h = HANDLING.getStore()?.id ?? null;
  // «Done» (goer-selv): ikke vinduestitlen - den skifter netop fordi mennesket har logget ind (R39, Opus E).
  return kind === 'goer-selv'
    ? JSON.stringify([session ?? null, ren(client), kind, targetBundle ?? null, h ?? ren(text).trim()])
    : JSON.stringify([session ?? null, ren(client), ren(text).trim(), ren(scope), ren(target), kind, targetBundle ?? null, h]);
};
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
function forhaandsNej(text, noegle = null) {
  const n = [...ren(text).trim()].length;
  if (n > TEKST_LOFT) return `the action is ${n} characters - more than the ${TEKST_LOFT} the menu bar shows in full, and a yes must cover everything the person saw`;
  // S3: det SAMME spoergsmaal, der stadig staar i boksen (eller er besvaret siden), maa hentes.
  if (venter && !(udestaaende && udestaaende.noegle === noegle)) return 'this agent already has a question waiting in the menu bar';
  if (Date.now() < pauseTil) return 'the person just said no; this agent may not ask again for 30 seconds';
  return null;
}

export async function spoergIkonet(sp, timeoutSec) {
  const noegle = noegleFor(sp);
  // S3: et svar paa et spoergsmaal der blev stillet foer - hent det, eller vent videre paa det.
  // Et gemt svar gaelder kun i spoergsmaalets levetid: bagefter stilles det paa ny.
  for (const [k, g] of gemte) if (Date.now() > g.frist) gemte.delete(k);
  if (gemte.has(noegle)) return Promise.resolve(afgjortSvar(gemte.get(noegle)));
  if (udestaaende && udestaaende.noegle === noegle) return hentUdestaaende(timeoutSec);
  const nej = forhaandsNej(sp.text, noegle);
  if (nej) return { ok: false, ikkeSpurgt: true, grund: nej };
  if (!(await ikonetKlar())) {
    return { ok: false, ikkeSpurgt: true, ikkeKoerer: true, grund: 'the menu bar icon is not running' };
  }
  return spoerg(sp, timeoutSec);
}

const VENTER_STADIG = (min) => `the person has not answered yet. The question stays in the box in the corner of their screen (and under the menu bar icon) for about ${min} more minute${min === 1 ? '' : 's'}. Tell them in the chat to look at it, then call this again with exactly the same arguments - nothing else will be asked until it is answered or expires.`;

/// S3: vent hoejst VINDUET paa det udestaaende spoergsmaal. ⛔ R39 (Astra, MAALT): to ventende kald fik
///    begge ja fra ét svar. Et ja udleveres nu ATOMISK til ét kald; de andre faar at vide, at det gik til et andet.
function afgjortSvar(u) {
  switch (u.status) {
    case 'venter': return null;
    case 'ja':
      u.status = 'brugt';
      if (udestaaende === u) udestaaende = null;
      if (gemte.get(u.noegle) === u) gemte.delete(u.noegle);
      return { ...u.svar, senere: true };
    case 'brugt':
      // R40 (Opus): heller ikke et afslag - ingen koe, intet «do not try again», intet «cancelled».
      return venterStadig({ ok: false, andetKald: true, grund: 'that answer went to another call of the same action - nothing was done here; call again to ask anew' });
    default:   // 'nej' eller 'slut'
      if (udestaaende === u) udestaaende = null;
      if (gemte.get(u.noegle) === u) gemte.delete(u.noegle);
      return u.svar || { ok: false, grund: 'the question ended without an answer' };
  }
}

function hentUdestaaende(timeoutSec) {
  const u = udestaaende;
  const nu = afgjortSvar(u);
  if (nu) return Promise.resolve(nu);
  const vindue = Math.min(timeoutSec, vindueSek()) * 1000;
  return new Promise((resolve) => {
    let ude = false;
    const lyt = () => { if (ude) return; ude = true; clearTimeout(ur); u.venteliste.delete(lyt); resolve(afgjortSvar(u) || { ok: false, grund: 'the question ended without an answer' }); };
    const ur = setTimeout(() => { if (ude) return; ude = true; u.venteliste.delete(lyt);
      resolve(venterStadig({ ok: false, venterStadig: true, grund: VENTER_STADIG(Math.max(1, Math.round((u.frist - Date.now()) / 60_000))) })); }, vindue);
    u.venteliste.add(lyt);
  });
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
    // S3: lange frister deles i et VINDUE (kaldet svarer) og en LEVETID (spoergsmaalet staar i boksen).
    const levetid = timeoutSec > vindueSek() ? Math.max(timeoutSec, levetidSek()) : timeoutSec;
    const vindue = Math.min(timeoutSec, vindueSek());
    // ⛔ Astra, runde 2 (22/9): fristen blev kun haandhaevet af en timer. En
    //    timer kan komme for sent (maskinen sover, kaldet er forsinket), og saa
    //    ville et ja efter fristen blive accepteret. Nu sammenlignes uret ogsaa.
    const frist = Date.now() + levetid * 1000;
    const u = { noegle: noegleFor({ session, client, text, scope, target, kind, targetBundle }), status: 'venter', svar: null, frist, venteliste: new Set() };
    udestaaende = u;
    let buf = '';
    let faerdig = false, kaldetSvaret = false;
    const svarKaldet = (svar) => {
      if (kaldetSvaret) return;
      kaldetSvaret = true;
      clearTimeout(vindueUr);
      afslutMaaling(svar.ok === true).then((x) => { senesteMaaling = x; }, () => {}).finally(() => resolve(svar));
    };
    const slut = (svar) => {
      if (faerdig) return;
      faerdig = true;
      venter = false;
      clearTimeout(ur); clearTimeout(vindueUr);
      try { sock.destroy(); } catch {}
      if (!svar.ok && svar.menneske) pauseTil = Date.now() + PAUSE_MS;
      // ⛔ R39: udloeb og et ikon der lukkede/ikke kunne naas er IKKE et svar - de gemmes ikke.
      u.status = (svar.udloeb || svar.ikkeKoerer || svar.ikonLukket) ? 'slut' : (svar.ok ? 'ja' : 'nej');
      u.svar = svar;
      if (u.status === 'slut' && udestaaende === u) udestaaende = null;
      // Kom svaret EFTER at kaldet havde svaret «venter stadig», gemmes det pr. handling (R40).
      // R40 (Opus): et gemt svar gaelder hoejst GEMT_SEK efter at det blev givet - ikke resten af spoergsmaalets levetid.
      if (kaldetSvaret && (u.status === 'ja' || u.status === 'nej')) { if (udestaaende === u) udestaaende = null; u.frist = Math.min(u.frist, Date.now() + gemtSek() * 1000); gemte.set(u.noegle, u); }
      if (!kaldetSvaret) {
        // Svaret kom mens det oprindelige kald ventede: DET kald faar det (et ja bruges hermed).
        if (u.status === 'ja') u.status = 'brugt';
        if (udestaaende === u) udestaaende = null;
        svarKaldet(svar);
      }
      // ⛔ R39 (Astra 3): ventende genkald faar ALTID besked - ogsaa naar det oprindelige kald tog svaret.
      for (const l of [...u.venteliste]) l();
    };
    const ur = setTimeout(() => slut({ ok: false, udloeb: true, grund: 'nobody answered in the menu bar in time' }), levetid * 1000);
    const vindueUr = levetid > vindue
      ? setTimeout(() => svarKaldet(venterStadig({ ok: false, venterStadig: true, grund: VENTER_STADIG(Math.max(1, Math.round((levetid - vindue) / 60))) })), vindue * 1000)
      : null;
    const sock = createConnection(IKON_SOCKET);
    sock.on('connect', () => {
      // De faste felter skrives af serveren og holdes korte; teksten sendes hel.
      const kort = (v) => ren(v).slice(0, 200);
      sock.write(JSON.stringify({
        nonce, session, client: kort(client), text: helTekst, scope: kort(scope), target: kort(target),
        kind, targetBundle: targetBundle ? kort(targetBundle) : null,
        expires: frist
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
    sock.on('close', () => slut({ ok: false, ikonLukket: true, grund: 'the menu bar icon closed without an answer' }));
  });
}
