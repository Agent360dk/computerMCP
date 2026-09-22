// «Kraever menneske» uden at tage skaermen: spoerg menulinje-ikonet.
//
// Tilfoejet 22/9 efter Gustavs oenske og et konsulentpanel (Fable + sikkerhed).
// I baggrundstilstand afviste porten alt der kraevede et ja, fordi en dialog
// tager skaermen. Nu kan den i stedet lade ikonet blive orange og VENTE paa
// at mennesket svarer - naar det passer ham.
//
// Panelets krav, alle bygget her eller i ikonet:
//   - Svaret gaar tilbage ad SAMME forbindelse som spoergsmaalet. En agent med
//     kun et fil-vaerktoej kan skrive en fil, men ikke svare paa en andens
//     forbindelse. (Fable foreslog en fil; sikkerheden fandt at netop det er
//     vejen for en agent uden shell. Vi fulgte sikkerheden.)
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

const DIR = process.env.CMCP_STATE_DIR || join(homedir(), '.local', 'state', 'computer-mcp');
export const IKON_SOCKET = join(DIR, 'ikon.sock');

let venter = false;          // hoejst ét aabent spoergsmaal pr. agent
let pauseTil = 0;            // efter et nej: ingen nye spoergsmaal i et stykke tid
const PAUSE_MS = 30_000;

/// Spoerg ikonet. Returnerer { ok, grund }. Kaster aldrig.
export function spoergIkonet({ session, client, text, scope, target }, timeoutSec) {
  return new Promise((resolve) => {
    if (!existsSync(IKON_SOCKET)) return resolve({ ok: false, ikkeSpurgt: true, grund: 'the menu bar icon is not running' });
    if (venter) return resolve({ ok: false, ikkeSpurgt: true, grund: 'this agent already has a question waiting in the menu bar' });
    if (Date.now() < pauseTil) return resolve({ ok: false, ikkeSpurgt: true, grund: 'the person just said no; this agent may not ask again for 30 seconds' });

    venter = true;
    const nonce = randomBytes(16).toString('hex');
    let buf = '';
    let faerdig = false;
    const slut = (svar) => {
      if (faerdig) return;
      faerdig = true;
      venter = false;
      clearTimeout(ur);
      try { sock.destroy(); } catch {}
      if (!svar.ok && svar.menneske) pauseTil = Date.now() + PAUSE_MS;
      resolve(svar);
    };
    const ur = setTimeout(() => slut({ ok: false, grund: 'nobody answered in the menu bar in time' }), timeoutSec * 1000);
    const sock = createConnection(IKON_SOCKET);
    sock.on('connect', () => {
      // Linjeskift renses: ikonet viser teksten, og modellen maa ikke kunne
      // tegne sin egen «Allow»-linje ind i menuen.
      const ren = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 200);
      sock.write(JSON.stringify({
        nonce, session, client: ren(client), text: ren(text), scope: ren(scope), target: ren(target),
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
      if (m.ok === true && m.verified === 'owner') return slut({ ok: true, grund: 'the person approved in the menu bar and confirmed it was them' });
      // Kun et udtrykkeligt nej er et menneskes nej - og kun det giver pausen.
      // Et ja uden bekraeftelse er ikke et ja, men heller ikke et menneske der
      // har sagt fra; en pause ville straffe mennesket for en fejl i ikonet.
      if (m.ok === false) return slut({ ok: false, menneske: true, grund: 'the person said no in the menu bar' });
      return slut({ ok: false, grund: 'the answer was not confirmed by the person (Touch ID or password)' });
    });
    sock.on('error', () => slut({ ok: false, ikkeSpurgt: true, grund: 'the menu bar icon could not be reached' }));
    sock.on('close', () => slut({ ok: false, grund: 'the menu bar icon closed without an answer' }));
  });
}
