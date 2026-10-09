#!/usr/bin/env node
/**
 * Computer MCP by Agent360
 *
 * En MCP-server der lader en agent styre en Mac - men kun gennem tre spaerrer:
 *
 *   1. Hemmeligheder sloeres i selve optagelsen, foer billedet findes som fil.
 *   2. Ingen skrivende handling sker foer et menneske har sagt ja, og
 *      adgangskode-bokse og terminaler spoerger hver eneste gang.
 *   3. Alt skrives i en revisionslog der ikke kan redigeres bagud.
 *
 * Der er ingen indre sprogmodel og ingen API-noegle. Den model brugeren
 * allerede betaler for, styrer; vi laegger kun haenderne til.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, unlinkSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { tmpdir, homedir } from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

import { TOOLS, TOOL_BY_NAME, describe } from './tools.js';
import { spoergOmGoerSelv, laanSkaermen } from './godkend.js';
import { BESKED_APPS, beskedSlags, WEBMAIL, WEBCHAT, SENDE_ORD, tastSender, saetLaan, laanAktivt, laanTilTid, baggrundLaast, laanOejeblik } from './policy.js';
import { TIER, ALWAYS_ASK_APPS, SPOERG_PR_SESSION, decide, currentMode, askHumanToDo, askTimeout, skaermVentetid, menuSerFarlig, tastSerFarlig, baggrund, TAGER_SKAERMEN, KAN_STILLES, MANGLER_FOR_STILLE, kaldErStille, tagerSkaermen } from './policy.js';
import { callHelper, HelperError, helperPath, frontmostBundleId, resolveBundleId, resolveApp, afbrydSkaermKald } from './helper.js';
import { record, scrubArgs, kendNoegler, fingerprint, AUDIT_PATH, noterVentende, ventende, KOE_PATH, kaedenHolder, SESSION, loggenKanSkrives, iKald } from './audit.js';
import { medProgramLaas } from './programlaas.js';
import { taelOgTael } from './sloejfe.js';
import { statusStart, statusHandling, statusFaerdig, statusKlient, startIkon, STATUS_IKON_ID } from './status.js';
import { startVagt } from './vagt.js';

/// ⛔ Den saetning der laerer modellen at bruge den stille vej.
///
///    Et vaerktoej der bare siger «Typed 10 characters» giver modellen ingen
///    grund til at navngive programmet. Svaret skal sige hvad der skete med
///    MENNESKETS skaerm, hver gang - saa vaelger den selv rigtigt naeste gang.
/// ⛔ FUNDET AF ANDET MODSTANDER-REVIEW 21/9: `stilleNote` siger «see
///    took_screen in the log» - og feltet blev aldrig skrevet i loggen.
///    MAALT: 0 af 3.824 linjer indeholdt det. Og `Skaerm.swift`s egen
///    begrundelse var at «daekningen kan goeres op pr. program» - hvilket
///    ikke kan lade sig goere fra en log der ikke har tallet.
/// ⛔ KONSULENTEN 22/9: loggen skrev `outcome: ok` om baade «vi sendte det»
///    og «det virkede». Om natten er det forskellen paa at vide og at tro.
///    Hjaelperen VED det i nogle tilfaelde (set_value laeser vaerdien tilbage,
///    press udfoerer elementets egen handling) og ved det ikke i andre (et
///    museklik baerer intet svar). Det staar nu i loggen som `effect`:
///      verified  - vi har laest efter, og det skete
///      performed - programmet udfoerte handlingen og svarede
///      sent      - vi afleverede den; om den virkede, ved vi ikke
function medEffekt(res, effekt) {
  Object.defineProperty(res, '__effekt', { value: effekt, enumerable: false });
  return res;
}

function medSkaerm(res, r) {
  if (r && typeof r === 'object' && r.took_screen !== undefined) {
    Object.defineProperty(res, '__tookScreen', { value: !!r.took_screen, enumerable: false });
  }
  return res;
}

/// Et vindue som tekst: én linje pr. element der siger noget, rolle foran.
///
/// Loft og afkortning er kopieret fra browser-mcp's `get_page_content`, fordi
/// det er dens AERLIGHEDS-politik der skal kopieres, ikke dens mekanik: et
/// svar der blev kappet, SIGER det - og hvor meget der var.
const TEKST_LOFT = 30000;
function somTekst(noder, r) {
  const linjer = [];
  for (const n of noder) {
    const t = n.title || n.value || n.desc;
    if (!t) continue;
    const rolle = String(n.role || '').replace(/^AX/, '');
    // Et felt der blev klippet, siger det - samme regel som loftet nedenfor.
    const klip = n.value_cut && n.value === t ? ` [cut: 200 of ${n.value_chars} characters]` : '';
    linjer.push(`${rolle}${n.secure ? ' [secure]' : ''}: ${String(t).replace(/\s+/g, ' ').trim()}${klip}`);
  }
  const hoved = `${noder[0]?.app || 'app'} - ${linjer.length} elements with text, out of ${noder.length} read.`;
  let krop = linjer.join('\n');
  const iAlt = krop.length;
  let hale = '';
  if (iAlt > TEKST_LOFT) {
    krop = krop.slice(0, TEKST_LOFT);
    hale = `\n\n[cut: ${TEKST_LOFT} of ${iAlt} characters. Narrow it with computer_find, or ask for format: 'json' with a lower limit.]`;
  }
  // ⛔ ASTRA, runde 1 (23/9): hjaelperen svarer `stopped_early`, `slow_lookups`
  //    og en note naar traeet kun blev LAEST DELVIST - og serveren tabte dem
  //    paa gulvet. Et afkortet svar der ikke siger det, er praecis den fejl
  //    vi lige har rettet tre andre steder.
  if (r?.stopped_early || r?.slow_lookups) {
    hale += `\n\n[INCOMPLETE: ${r.note || 'the walk did not finish'}]`;
  }
  if (noder.length >= (r?.count ?? noder.length) && linjer.length < 15) {
    hale += '\n\n[Little text came back. In an Electron app the tree can still be building after it is switched on - read it again in a second.]';
  }
  return `${hoved}\n\n${krop}${hale}`;
}

function stilleNote(app, r) {
  if (app) {
    // ⛔ FUNDET AF MODSTANDER-REVIEWET 21/9. `Args` i hjaelperen ignorerer
    //    ukendte flag i stilhed, saa en AELDRE hjaelper tager imod `--app`,
    //    sender i den globale stroem - og svarer uden `took_screen`.
    //    `undefined` er falsy, saa den her linje sagde «the pointer stayed
    //    where the person left it» om et tastetryk i menneskets eget vindue.
    //    Samme fejlklasse som vendor-binaeren kl. 14.20: en groen kilde og en
    //    gammel artefakt. Et manglende felt er IKKE et nej.
    if (r === null || typeof r !== 'object' || r.took_screen === undefined) {
      return ' The helper did not report whether it took the screen, which means it is too old to know about `app`'
           + ' - so this went to the global input stream. Rebuild it with scripts/build-release.sh.';
    }
    return r?.took_screen
      ? ` It still took the screen: ${r.why || 'see took_screen in the log.'}`
      : ' The pointer stayed where the person left it and nothing came to the front.';
  }
  return ' This went to the global input stream, so it landed in whatever window the person is using.'
       + ' Pass `app` next time to deliver it into that app\'s own queue instead.';
}

const PKG = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'));

/// Laeringsfilen ligger ved siden af revisionsloggen (samme mappe, samme ejer).
const LAERING_PATH = join(dirname(AUDIT_PATH), 'learnings.jsonl');
/// En laering beskriver et trin, ikke menneskets indhold: tal (telefon, kort,
/// CPR) og mailadresser fjernes, foer noget skrives. Loft paa laengden.
function rensLaering(t, loft = 600) {
  return String(t ?? '').replace(/\s+/g, ' ').trim()
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\+?\d[\d ,.\-]{4,}\d/g, '[number]')
    .slice(0, loft);
}

/// Taeller identiske skrivende kald. Se noten ved kaldstedet for hvorfor
/// graenserne ser ud som de goer.
const SLOEJFE_GRAENSE = 10;
const SLOEJFE_FRI = new Set(['computer_scroll', 'computer_key', 'computer_type']);

function sloejfeTjek(name, args, tier) {
  if (tier === TIER.READ) return null;
  // ⛔ `computer_key` er fri for sloejfe-vaernet fordi pil-ned tyve gange er
  //    legitimt. `cmd+delete` tyve gange er det ikke.
  if (SLOEJFE_FRI.has(name) && !(name === 'computer_key' && tastSerFarlig(args?.combo))) return null;
  // ⛔ FABLE (23/9): taelleren laa i ÉN proces' hukommelse, og der koerer 15
  //    servere paa maskinen - én pr. aaben chat. «Ti ens kald i minuttet» var
  //    i virkeligheden 150. Den taeller nu paa tvaers (se sloejfe.js).
  const antal = taelOgTael(name, args);
  return antal > SLOEJFE_GRAENSE ? antal : null;
}

/// ⛔ FABLE (23/9): browser-mcp sender ~60 linjers vejledning med til klienten;
///    vi sendte NUL. Modellen laerte derfor vores regler af afslag - én ad
///    gangen, midt i en opgave. Det er baade dyrt og daarligt: en model der
///    faar reglen paa forhaand, vaelger den stille vej fra foerste kald.
const VEJLEDNING = `Computer MCP drives this Mac through the accessibility layer, for someone who is
using the machine at the same time. Two rules decide almost everything:

1. NAME THE APP. \`computer_type\`, \`computer_key\`, \`computer_scroll\` and
   \`computer_click\` take an \`app\`. With it, the event goes into that app's own
   queue: the pointer stays where the person left it, nothing comes to the
   front, and it works on a window behind the one they are in. Without it, the
   event goes to the global input stream and lands in whatever they are typing
   in - so in background mode (the default) it is refused.

2. FIND, THEN PRESS. The proven quiet route is \`computer_find\` to locate the
   element and \`computer_press\` or \`computer_set_value\` to act on it. These
   fire the element's own accessibility action, which works while the window is
   behind another one. Measured 23 Sep: keystrokes do NOT land in a Chromium
   window that is not focused, so for anything Chromium-based, use this route.

When a step did nothing - the next route (measured 27-28 Sep):
- The text is in a search field, but nothing was searched (WhatsApp, App Store):
  \`computer_set_value\` sets the value without the app noticing. Press the field,
  then \`computer_type\` into it - that is real typing, and the app reacts.
- \`computer_press\` said ok and nothing changed (a sidebar in App Store or System
  Settings): the app ignores presses there from behind. Find the same action in
  its menus with \`computer_menus\` - System Settings has every page under View.
- A menu item is greyed out, code \`menu-needs-front\`: this may be because the
  app only enables it while it is in front - which cannot be done from behind.
  Tell the person and let them bring it forward; do not keep pressing it.
- The app runs but has no window: \`computer_launch\` with \`background: true\`
  asks it to show one; if the app pulls itself forward the front is handed back.
- Nothing is found in an app you just saw: check \`computer_windows\` - the
  window may have been closed.
- \`computer_find\` finds nothing anywhere in an app that draws its own controls
  on a canvas (some games, some plotting tools, some remote-desktop windows):
  take one \`computer_screenshot\` of that app only, describe what you see, and
  hand the step to the person with \`computer_ask_user\` - do not guess
  coordinates from the image yourself. A canvas is also where the accessibility
  layer cannot black out a password field, so the person - never you - decides
  if that screenshot is safe to take.
- Whichever it was, write it down with \`computer_learning\`: the route that
  failed and the one that worked. That is how this tool gets better.

What you will be refused, and why:
- anything that would take the screen while in background mode - the person is
  working; use the route above instead
- the app the person is using right now - wait, or target another app
- password managers and Keychain: refused in background mode (the default);
  with CMCP_BACKGROUND=0 they ask every single time
- an unredacted screenshot: that is the person's decision, never the model's
- the Computer MCP status icon itself: it is their control surface

When something needs a human, do not give up - ask. This tool drives what a person
can reach by hand, but some steps stay theirs to take: a login or password, the
go-ahead to send a message to a real person, or something macOS only lets a person
do. When you hit one, say plainly what you need and ask the person to take that
step - \`computer_ask_user\` puts the question to them and returns their answer. In
background mode it waits in the menu bar icon: name the \`app\` whose field you
prepared, and the person brings it forward themselves, does it, and chooses Done;
in the foreground it is a dialog. If the icon is not running it is refused - then
say in your reply what you need instead of trying to force it. You never type a
password yourself - the person types any secret, and \`computer_type\` refuses
password fields. If a step genuinely needs the screen - dragging, moving the
pointer, bringing a window forward - ask for it with \`computer_request_screen\`
and say why; the person lends it for a few minutes, and you hand it back with
action "release" as soon as you are done. Sensitive write
actions that go through the menu-bar consent icon are listed by \`computer_pending\`
and approved there. Handing back "I can't" before you have asked is the one wrong
move; never work around a refusal.

Reading: \`computer_inspect\` answers as text by default. If it says INCOMPLETE
or [cut: ...], the answer is PART of the tree - narrow it with \`computer_find\`
rather than trusting what came back. It does not see inside web pages; that is
what a browser tool is for.

Everything is written to an append-only audit log with a rolling chain.`;

const server = new Server(
  { name: 'computer-mcp', version: PKG.version },
  { capabilities: { tools: { listChanged: true } }, instructions: VEJLEDNING }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  // I readonly-tilstand vises de skrivende vaerktoejer slet ikke. En model der
  // kan se et vaerktoej, proever det - og et afslag pr. kald er stoej for
  // brugeren. Er tilstanden readonly, findes haenderne ikke.
  tools: TOOLS
    .filter(t => currentMode() !== 'readonly' || t.tier === TIER.READ)
    // ⛔ I baggrunds-tilstand skjules KUN dem der ikke kan goeres stille.
    //    Foer 21/9 blev alle tretten skjult, og saa var baggrund et produkt
    //    med halvdelen af haenderne skaaret af. De fire der kan tage et `app`,
    //    tilbydes nu - modellen faar besked om at navngive programmet, og saa
    //    virker de uden at nogen maerker det.
    .filter(t => !baggrund() || !TAGER_SKAERMEN.has(t.name) || KAN_STILLES.has(t.name))
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}));

function textResult(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}
function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/// Skaermoptagelsen der koerer lige nu (hoejst én pr. server).
///
/// Hjaelperen er en kortlivet proces for alt andet; en optagelse maa leve fra
/// «start» til «stop». Den holdes her, og hjaelperen standser selv hvis serveren
/// forsvinder (den ser sin foraelder blive pid 1).
let optagelse = null;

// De argumentnavne vaerktoejerne har. Alt andet er et navn modellen har fundet paa,
// og det logges som et fingeraftryk (Astra 25/9).
{
  const navne = new Set();
  const gaa = (sk) => {
    if (!sk || typeof sk !== 'object') return;
    for (const [k, v] of Object.entries(sk.properties || {})) { navne.add(k); gaa(v); }
    if (sk.items) gaa(sk.items);
  };
  for (const t of TOOLS) gaa(t.inputSchema);
  kendNoegler(navne);
}

// ⛔ FABLE 25/9 (runde 2): loggen lovede en linje naar serveren forsvinder - men den
//    linje skulle skrives af den server der var vaek. Nu skriver serveren selv, lige
//    foer den lukker, at den gaar, og beder hjaelperen afslutte filen. Resten (bytes,
//    sekunder) kan den ikke vente paa; det staar i linjen. En server der draebes med
//    SIGKILL kan intet skrive, og det siger docs.
process.on('exit', () => {
  const o = optagelse;
  if (!o || o.slut) return;
  try { o.barn.kill('SIGINT'); } catch { /* allerede vaek */ }
  try {
    record({ tool: 'computer_record', recording: 'stopping', file: o.sti, stopped_by: 'server-exit',
             note: 'the server is ending; the helper finishes the file on its own, and that last step is not in this log' });
  } catch { /* loggen kan ikke skrives - intet at goere i en exit-handler */ }
});
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => process.exit(0));

/// Den grund mennesket laeser, naar en handling spoerger hver gang. Én grund pr.
/// slags - «det ligner en sletning» er ikke grunden til at spoerge om en optagelse.
/// Hoejst 150 tegn: menulinje-ikonet viser 200, og «this one action only» skal med.
/// ⛔ B6 (29/9, panelet: «sikkerhedskontrol UDEN for agenten»). Porten vogter
///    denne servers egne kald - ikke et faengsel (godkend.js). En agent med en
///    shell under samme bruger kan klikke med osascript, og en browser-
///    automation kan sende fra webmail, helt uden om os. Den kontrol der LIGGER
///    uden for agenten, er klientens egne tilladelser. Vi kan ikke haandhaeve
///    dem - men vi kan sige praecis hvor hullerne staar, i stedet for at lade
///    porten ligne mere end den er. Kun laesning; kun de fundne regler naevnes.
const OMVEJE = [
  [/^Bash$|^Bash\((\*|:\*)\)$/, 'runs any shell command - including osascript, which can click and type in any app without this server'],
  [/^Bash\([^)]*osascript/i, 'runs AppleScript, which can click, type and send in any app without this server'],
  // ⛔ Runde 2 30/9 (Fable 1): hele browser-/computer-servere og deres skrivende
  //    vaerktoejer - ogsaa Claude in Chrome, computer-use og remote-devices, som
  //    klienterne selv skibes med. Vores egen server (computer-mcp) er ikke en omvej.
  [/^mcp__(?:(?!__)[\w-])*(browser|playwright|puppeteer|chrome|computer[-_]use|remote[-_]devices|desktop[-_]commander)(?:(?!__)[\w-])*__[\w-]*(click|fill|type|press|execute|evaluate|upload|navigate|select|drag|key|scroll|computer|form|input|javascript)/i,
   'drives a browser or the computer - webmail and web chats included - without this server'],
  [/^mcp__(?:(?!__)[\w-])*(browser|playwright|puppeteer|chrome|computer[-_]use|remote[-_]devices|desktop[-_]commander)(?:(?!__)[\w-])*(__\*)?$/i,
   'allows every tool of a browser or computer automation server - clicks and form fills included'],
  // Runde 1+2 (Fable P5, Fable 1): skaller og fortolkere, ogsaa med fuld sti, og
  // programmer der koerer andre programmer - root og browser-automation inklusive.
  [/^Bash\((\/[\w/.-]*\/)?(ba|z|k|c|da|fi|tc)?sh(\s|:|\)|$)/, 'runs a shell - and from there osascript, which can click and type in any app without this server'],
  [/^Bash\((\/[\w/.-]*\/)?(python\d*(\.\d+)?|node|ruby|perl|deno|bun|php|swift|open|shortcuts|automator|osacompile|cliclick)(\s|:|\)|$)/,
   'runs a script interpreter or an automation tool - enough to click, type and send without this server'],
  [/^Bash\((\/[\w/.-]*\/)?(sudo|doas)(\s*\*|:\*|\s+(\/\S*\/)?((ba|z|k|c|da|fi|tc)?sh|python\d*|node|ruby|perl|osascript|open)\b)/, 'runs commands as root - anything, including clicking and sending without this server'],
  [/^Bash\((\/[\w/.-]*\/)?(npx|bunx|pnpx|env|xargs|eval)(\s*\*|:\*|\s+(playwright|puppeteer|selenium)\b|\s+(\/\S*\/)?((ba|z|k|c|da|fi|tc)?sh|python\d*|node|ruby|perl|osascript)\b)/, 'runs any program it is given - browser automation included - without this server'],
];
function klientOmveje() {
  const hjem = homedir(), her = process.cwd();
  const filer = process.env.CMCP_KLIENT_INDSTILLINGER
    ? process.env.CMCP_KLIENT_INDSTILLINGER.split(':').filter(Boolean)
    : [join(hjem, '.claude', 'settings.json'), join(hjem, '.claude', 'settings.local.json'),
       join(her, '.claude', 'settings.json'), join(her, '.claude', 'settings.local.json')];
  const laest = [], fundet = [];
  for (const fil of filer) {
    let allow;
    try { allow = JSON.parse(readFileSync(fil, 'utf8'))?.permissions?.allow; } catch { continue; }
    laest.push(fil);
    for (const regel of Array.isArray(allow) ? allow : []) {
      // ⛔ Live-proeven 30/9: 128 «omveje» paa Gustavs maskine, de fleste praecise
      //    kommandoer (`Bash(node --check index.js)`) der kun tillader den ene ting.
      //    En Bash-regel er kun en omvej med et wildcard eller et script fra stdin.
      const r = String(regel);
      const arg = r.startsWith('Bash(') ? r.slice(5, -1) : null;
      if (arg !== null && r !== 'Bash' && !/\*/.test(arg) && !/(^|\s)-$/.test(arg.trim())) continue;
      const hvorfor = OMVEJE.find(([re]) => re.test(r))?.[1];
      if (hvorfor) fundet.push({ rule: String(regel).slice(0, 120), file: fil, why: hvorfor });
    }
  }
  return {
    bypasses: fundet,
    bypassesChecked: laest.length ? laest : 'no Claude Code settings found; other MCP clients are not checked',
    ...(fundet.length ? { bypassNote: `${fundet.length} rule(s) in your client let an agent act on this Mac without asking - this server's consent never sees those actions. Only the person can remove them.` } : {})
  };
}

/// ⛔ SKAERM-LAANET (29/9, panelet: B2 + B5). Mennesket laaner EN agent skaermen
///    i menulinje-ikonet, med Touch ID, i hoejst 15 minutter. Laanet ER den
///    aabne forbindelse til ikonet (godkend.js): lukkes den - tiden er gaaet,
///    mennesket tog skaermen tilbage, ikonet doede - er laanet slut, og
///    vaerktoejslisten meldes aendret. CMCP_BACKGROUND sat er et loft.
let laanHaandtag = null;
let laanNr = 0;
let laanAfgivet = false;
const POSTER_INPUT = new Set(['computer_click', 'computer_move', 'computer_drag', 'computer_scroll', 'computer_type', 'computer_key', 'computer_paste', 'computer_space']);     // agenten gav selv skaermen tilbage (en loglinje, ikke to)              // hvert laan sit nummer: et gammelt laans slut roerer ikke et nyt
let sidsteEgenHandling = 0;
const klientNavn = () => server.getClientVersion?.()?.name || process.env.CMCP_CLIENT || null;
async function meldListe() { try { await server.sendToolListChanged(); } catch { /* klienten lytter ikke */ } }

async function skaermLaan(args) {
  const handling = args.action || 'request';
  const log = (decision, reason, asked = false) => record({ tool: 'computer_request_screen', tier: TIER.WRITE,
    args: scrubArgs(args), mode: currentMode(), target: 'screen', decision, asked, ...(asked ? { asker: 'menubar' } : {}), reason });
  if (currentMode() === 'readonly') {
    log('denied', 'read-only mode');
    return errorResult('Refused: read-only mode - the screen cannot be lent to an agent that may not touch anything.');
  }
  if (handling === 'status') {
    return textResult({ screen: laanAktivt() ? 'lent to this agent' : baggrund() ? 'background - the person has it' : 'foreground (CMCP_BACKGROUND=0)',
                        until: laanAktivt() ? new Date(laanTilTid()).toISOString() : null });
  }
  if (handling === 'release') {
    const havde = laanAktivt();
    laanAfgivet = true;
    const h = laanHaandtag; h?.();              // lukker forbindelsen -> slut() rydder op, logger og melder listen
    saetLaan(0); laanHaandtag = null;
    return textResult({ released: havde, note: havde ? 'The screen is the person\'s again.' : 'This agent did not have the screen.' });
  }
  if (baggrundLaast()) {
    log('denied', 'the person has locked this server to background mode');
    return errorResult('Refused: the person has locked this server to background mode (CMCP_BACKGROUND is set), so the screen cannot be lent to an agent. ' +
      'Use the quiet tools, or tell the person in the chat what you need.');
  }
  if (laanAktivt()) return textResult({ granted: true, already: true, until: new Date(laanTilTid()).toISOString() });
  if (!baggrund()) return textResult({ granted: true, already: true, note: 'This server runs with CMCP_BACKGROUND=0: it already has the foreground.' });
  const grund = String(args.reason || '').trim();
  if (!grund) return errorResult('Refused: say in `reason` what you need the screen for - the person decides on that.');
  // Runde 1 (Fable F5): et laan der ikke kan skrives i loggen, gives ikke.
  if (!loggenKanSkrives()) return errorResult(`Refused: the audit log at ${AUDIT_PATH} cannot be written, and the screen is not lent without a record.`);
  // ⛔ Runde 2 (Astra 1): nummeret blev talt op FOER spoergsmaalet - en anden
  //    anmodning (afvist som «already waiting») gjorde saa det godkendte laans
  //    slut ugyldigt, og laanet sluttede aldrig. Nu faar kun et ja et nummer.
  let nr = null, lukketFoerStart = false;
  const min = Math.max(1, Math.min(15, Number.isInteger(args.minutes) ? args.minutes : 10));
  const svar = await laanSkaermen({ session: SESSION, client: klientNavn(), text: `Use your screen for ${min} minutes: ${grund}`, minutter: min },
    skaermVentetid(), async () => {
      // Forbindelsen er lukket: tiden gik, mennesket tog skaermen, ikonet doede,
      // eller agenten gav den tilbage. Kun DETTE laans slut taeller.
      if (nr === null) { lukketFoerStart = true; return; }
      if (nr !== laanNr) return;
      saetLaan(0); laanHaandtag = null;
      // ⛔ Runde 1 (Astra 4): et traek eller en skrivning der er i gang, stoppes.
      const stoppet = afbrydSkaermKald();
      record({ tool: 'computer_request_screen', outcome: 'ended',
               reason: laanAfgivet ? 'the agent handed the screen back' : 'the screen went back to the person', ...(stoppet ? { stopped: stoppet } : {}) });
      await meldListe();
    });
  log(svar.ok ? 'allowed' : 'denied', svar.grund, true);
  if (!svar.ok) {
    return errorResult(`Refused: ${svar.grund}. The screen stays with the person - use the quiet tools, and do not ask again with the same request.`);
  }
  if (lukketFoerStart) return errorResult('Refused: the screen was taken back the moment it was given. Ask again only if the person wants it.');
  // Runde 2 (Astra F5): kan laanet ikke skrives i loggen efter ja'et, gives det ikke.
  if (!loggenKanSkrives()) { svar.afslut?.(); return errorResult(`Refused: the audit log at ${AUDIT_PATH} cannot be written, and the screen is not lent without a record.`); }
  nr = ++laanNr; laanAfgivet = false;
  saetLaan(svar.til); laanHaandtag = svar.afslut;
  record({ tool: 'computer_request_screen', outcome: 'lent', until: new Date(svar.til).toISOString() });
  // Vores eget ur ogsaa: udloeber laanet, lukkes forbindelsen, og listen meldes.
  const t = setTimeout(() => { if (nr === laanNr && !laanAktivt()) laanHaandtag?.(); }, Math.max(0, svar.til - Date.now()) + 50);
  t.unref?.();
  await meldListe();
  return textResult({ granted: true, until: new Date(svar.til).toISOString(), minutes: min,
    note: 'The tools that take the screen are offered to you until then. Each step waits while the person is using the keyboard or mouse. ' +
          'Call computer_request_screen with action "release" as soon as you are done.' });
}

/// ⛔ Runde 4 (Astra 3 + Fable 1): hvordan blev teksten leveret? Baeres som et
///    ikke-talt felt paa svaret. Runde 3 ledte efter «"method":"accessibility"» i
///    svarets PROSA, hvor den aldrig stod - linjen kunne aldrig fyre.
function medInput(r, res) {
  Object.defineProperty(res, '__postedeInput', { value: r?.method !== 'accessibility', enumerable: false });
  return res;
}

/// Samme soegning for trykket og for sende-portens --dry: ellers kunne porten
/// doemme ét element og trykket ramme et andet.
function trykArgv(args) {
  const a = ['press', '--match-stdin', '--app', String(args.app)];
  if (args.role) a.push('--role', String(args.role));
  if (args.subrole) a.push('--subrole', String(args.subrole));
  if (Number.isInteger(args.index)) a.push('--index', String(args.index));
  if (args.first) a.push('--first');
  const soeg = {};
  if (args.title) soeg.title = String(args.title);
  if (args.contains) soeg.contains = String(args.contains);
  return { a, soeg };
}

/// ⛔ SENDE-PORTEN (29/9, dommen 28/9 D4 + trin 7). Er DETTE kald i en
///    beskedapp en afsendelse? Returnerer null (nej), { afvis } eller
///    { describe } - hvor teksten er skrevet af SERVEREN fra skaermen: hvem
///    samtalen er med, og hvad der staar i feltet. Modellens egne ord kommer
///    aldrig ind i den. Kan det ikke afgoeres, er svaret ja: hellere et
///    spoergsmaal for meget end en besked ingen godkendte.
/// Er menupunktets TASTATURGENVEJ en af dem der lukker eller sletter (Cmd+Q, Cmd+W …)?
/// ⛔ 1/10 (konsulent-panelet): ord baerer ikke paa tvaers af sprog - «Slut Skak» slap
///    igennem. Genvejen staar i programmets egen menu og er ens paa alle sprog.
///    Kan punktet ikke slaas op, spoerges der (lukket, ikke aabent).
async function menuGenvejErFarlig(app, path) {
  try {
    const dybde = Math.max(1, String(path).split('>').length);
    const r = await callHelper(['menus', '--app', String(app), '--depth', String(dybde)]);
    const p = (r?.items || []).find(x => x.path === path);
    if (!p) return true;
    return !!p.shortcut && tastSerFarlig(p.shortcut);
  } catch { return true; }
}

/// Hedder knappen et tryk eller klik rammer, noget der sletter, rydder eller lukker?
/// ⛔ 1/10 (konsulent-panelet, skaerm-koeen): README lover «Anything that deletes or
///    clears asks every time, recognised from the words in the action itself» - men
///    ordene blev kun laest paa menupunkter og genveje. En KNAP der hed «Slet» eller
///    «Erase», trykket med computer_press eller ramt af et klik, spurgte aldrig.
///    Samme ord som menuen. Kendes elementets navn ikke, kan det ikke doemmes herfra:
///    et tryk der ikke kan slaas op, finder heller ikke noget at trykke paa.
/// ⛔ 2/10 (Opus-panelet, canvas-spørgsmålet): den sætning gælder KUN press - et
///    tryk der ikke kan slås op, rammer intet, så at fejle åbent er harmløst der.
///    Et KOORDINAT-KLIK rammer skærmen uanset om opslaget her lykkes. Før stod
///    "intet fundet"/"intet navn"/en fejl alle som `false` (ikke farligt) - netop
///    de tre tilstande hvor serveren IKKE ved hvad der klikkes på (en canvas-tegnet
///    dialog, et fjernskrivebord, et navnløst element). README's løfte holdt ikke
///    på den vej: et "Delete" kunne rammes blindt uden at nogen blev spurgt. Et
///    punkt vi ikke kan identificere, er nu farligt - spørg, fail CLOSED.
/// ⛔ RETTET samme dag (CI, test/sende-port.mjs q9): den første udgave spurgte
///    ved ETHVERT navnløst element, inklusiv en navnløs AXGroup - et helt
///    almindeligt, harmløst layout-lag i Electron-apps. Sende-portens EGEN
///    `navnSender` har allerede løst præcis dette (runde 2, Fable 2 - se
///    kommentaren der): kun en rolle der plausibelt ER en knap (ukendt, eller
///    Button/Image/Unknown) kan overhovedet VÆRE et "Slet", så kun DEN
///    rolle-klasse spørger når navnet mangler. En gruppe kan ikke hedde "Delete".
/// ⛔ RETTET samme dag igen (CI, test/e2e-forloeb.mjs "click --app tager ikke
///    skaermen"): `at`-opslaget svarede `found:false` PAA EN HELT ALMINDELIG,
///    navngivet NSButton ("klik-maal") - maalt fejl -25200. Forsøgte da at lade
///    "punktet tilhører den app kaldet selv navngav" (targetBundleId === under)
///    tælle som harmløst.
/// ⛔ RETTET EN TREDJE GANG (review-security, 2/10, Critical, confidence 90):
///    den rettelse genåbnede PRÆCIS det Opus-panelet fandt. Et fjernskrivebord
///    eller en VM ejer sit eget vindue legitimt - "under" matcher ALTID "app"
///    derinde, for hele pointen med en RDP-klient er at AX-laget aldrig kan se
///    ind i den. At kende APPEN er ikke det samme som at kende ELEMENTET.
///    Prøvede derefter et genforsøg 150ms senere (en ægte AX-kvirk burde være
///    forbigående, et opaque fjernskrivebord ville fejle igen) - MÅLT at
///    svigte: samme -25200 to gange i træk på den samme knap. Kvirken er ikke
///    timing. Der er ingen billig måde at skelne "en helt almindelig knap AX
///    tilfældigvis ikke kan slå op" fra "et fjernskrivebord der aldrig kan
///    slås op" med kun ÉT punkt-opslag - så der gættes ikke mere. `found:false`
///    spørger nu ALTID, uden undtagelse. computer_click bliver dyrere på en
///    kendt AX-kvirk (test/e2e-forloeb.mjs's egen "klik-maal"-knap rammes af
///    den) - det er prisen for at lukke hullet, og den er betalt med vilje.
function kanVaereKnap(rolle) {
  return !rolle || /^AX(Button|Image|Unknown)$/.test(String(rolle));
}
async function knapErFarlig(name, args) {
  if (name === 'computer_press') {
    // ⛔ review-security F5 (2/10), Gustav ja: samme fejlklasse som klikkets F1 i dag -
    //    et mislykket opslag blev laest som "ufarligt", ikke som "ved ikke". Et
    //    tidsudloeb paa toerkoerslen fortaeller intet om hvad et AEGTE tryk ville
    //    ramme - fail-closed, som klikket allerede goer, ingen undtagelse.
    try {
      const { a, soeg } = trykArgv(args);
      const d = await callHelper([...a, '--dry'], { stdin: JSON.stringify(soeg), timeout: 15000 });
      const el = d?.would_press;
      if (!el) return true;
      return [el.name, ...(el.names || []), el.title].filter(Boolean).some(n => menuSerFarlig(n));
    } catch { return true; }
  }
  if (name === 'computer_click' && Number.isFinite(args.x) && Number.isFinite(args.y)) {
    try {
      const d = await callHelper(['at', '--x', String(args.x), '--y', String(args.y)], { timeout: 8000 });
      if (!d?.found) return true;
      const navne = [d.title, d.description].filter(Boolean);
      if (!navne.length) return kanVaereKnap(d.role);
      return navne.some(n => menuSerFarlig(n));
    } catch { return true; }
  }
  return false;
}

async function sendeDom(name, args, bid) {
  let slags = beskedSlags(bid);
  if (!slags) return null;
  let s = null;
  const laes = async () => s ??= await callHelper(['samtale', '--app', bid], { timeout: 15000 }).catch(() => ({}));
  // Den kontrol et tryk eller klik rammer - slaaet op ÉN gang. `fejl` = opslaget
  // mislykkedes; saa kan intet bindes, og en afsendelse afvises (runde 4, Astra 2).
  let kontrolSvar;
  const kontrol = async () => {
    if (kontrolSvar !== undefined) return kontrolSvar;
    try {
      if (name === 'computer_press') {
        const { a, soeg } = trykArgv(args);
        const d = await callHelper([...a, '--dry'], { stdin: JSON.stringify(soeg), timeout: 15000 });
        const el = d.would_press;
        kontrolSvar = el ? { navne: [el.name, ...(el.names || []), el.title], rolle: el.role, vindue: el.window || null, ramme: el.frame || null, fundet: true }
                         : { fejl: true };
      } else if (name === 'computer_click') {
        const d = await callHelper(['at', '--x', String(args.x), '--y', String(args.y)], { timeout: 8000 });
        kontrolSvar = { navne: [d.title, d.description], rolle: d.role, vindue: d.window || null, ramme: d.frame || null,
                        fundet: !!d.found, andetProgram: d.bundleId !== bid };
      } else kontrolSvar = null;
    } catch { kontrolSvar = { fejl: true }; }
    return kontrolSvar;
  };
  // En browser er kun en beskedapp naar vinduet ER en webchat eller webmail. Runde 4
  // (Astra 2): et tryk kan ramme en knap i et ANDET vindue end det fokuserede, saa
  // baade det fokuserede vindues titel og kontrollens vindues titel doemmes.
  if (slags === 'browser') {
    const t = await callHelper(['samtale', '--app', bid, '--title-only'], { timeout: 8000 }).catch(() => ({}));
    const k = await kontrol();
    // Runde 5 (Astra 2, Fable 1): en kontrol hvis vindue ikke kan laeses, er et ukendt
    // vindue - det doemmes som den fokuserede titel doemmes: fejl-lukket, som en chat.
    const titler = [String(t.window || '').trim(), ...(k ? [k.fejl ? '' : String(k.vindue || '').trim()] : [])];
    // Kan en titel ikke laeses, ved vi ikke hvad siden er: behandl den som en chat (fejl lukket).
    slags = titler.some(x => !x || WEBCHAT.test(x)) ? 'chat' : titler.some(x => WEBMAIL.test(x)) ? 'mail' : null;
    if (!slags) return null;
  }
  // I en chat er et linjeskift - og ethvert andet styretegn end tab - en usynlig afsendelse.
  if (name === 'computer_type' && slags === 'chat' && /[\p{Cc}\p{Zl}\p{Zp}]/u.test(String(args.text ?? '').replace(/\t/g, ''))) {
    return { afvis: 'in a chat app a line break sends the message. Type the text without it, then send with ' +
      'computer_key return - that asks the person first and shows them who it goes to and what it says.' };
  }
  // Et element UDEN navn er kun en mulig send-knap hvis det ER en knap (eller vi
  // ikke ved hvad det er) - ikke et navnloest menupunkt i menulinjen (claim 35, 30/9).
  // Ved et KLIK er et navnloest element kun en mulig send-knap hvis det er en knap eller
  // et billede - i Electron-apps rammer et klik ofte en navnloes gruppe (Fable R2 2).
  const navnSender = (navne, rolle = '', klik = false) => {
    const n = navne.filter(Boolean).join(' ').trim();
    if (n) return SENDE_ORD.test(n);
    // Runde 3 (Astra 3): en UKENDT rolle er ogsaa ved et klik en mulig send - kun
    // en KENDT ufarlig rolle (fx AXGroup) er undtaget.
    // ⛔ 2/10: klik-grenen her var en ORD-FOR-ORD kopi af knapErFarlig's
    // kanVaereKnap() (samme mønster genbrugt bevidst). To kopier af samme
    // logik betyder at en mutation i den ene maskeres af den anden - MÅLT:
    // mutant R3-ukendt-rolle-ufarlig overlevede, fordi knapErFarlig stadig
    // spurgte af sin EGEN grund. Kalder nu den delte funktion direkte -
    // én kilde, én mutation rammer begge gates' prøver.
    return klik ? kanVaereKnap(rolle) : (!rolle || /^AX(Button|Image|Group|Unknown|Link)$/.test(String(rolle)));
  };
  let knapVindue = null, knapRamme = null, erKontrol = false;
  let sender = false;
  if (name === 'computer_key') {
    sender = tastSender(args.combo, slags);
    // Mellemrum trykker paa en knap der har fokus (runde 1, Astra 1).
    if (!sender && /(^|\+)space$/i.test(String(args.combo || ''))) {
      const rolle = String((await laes()).field?.role || '');
      sender = !/^AX(TextArea|TextField|ComboBox|SearchField)$/.test(rolle);
    }
  }
  if (name === 'computer_menu') sender = SENDE_ORD.test(String(args.path || '').split('>').pop() || '');
  if (name === 'computer_press' || name === 'computer_click') {
    // erKontrol FOER opslaget: et opslag der fejler, maa ikke springe bindingen over.
    erKontrol = true;
    const k = await kontrol();
    if (!k || k.fejl) sender = true;
    else {
      // Intet element, et andet program foran, eller et element UDEN navn: vi ved ikke hvad det er - saa er det en mulig send.
      sender = (name === 'computer_click' && (!k.fundet || k.andetProgram)) || navnSender(k.navne, k.rolle, name === 'computer_click');
      knapVindue = k.vindue; knapRamme = k.ramme;
    }
  }
  if (!sender) return null;
  const sam = await laes();
  // 1/10: en modtager laest fra samtalens top (og set i chatlisten) vinder over overskrifter.
  const hvem = [...(sam.recipient ? [sam.recipient] : (sam.headings || []))].map(x => String(x || '').trim()).filter(Boolean);
  const felt = sam.field || {};
  // ⛔ Runde 2 (Astra 3): et soegefelt er ikke en besked, og uden kolonnen (feltets
  //    ramme) er navnene ikke bundet til feltet. Og Send-knappen skal ligge i det
  //    vindue hvis samtale mennesket faar vist.
  const erBeskedfelt = /^AX(TextArea|TextField)$/.test(String(felt.role || '')) && felt.subrole !== 'AXSearchField';
  const tekst = felt.secure || !erBeskedfelt ? null : (typeof felt.value === 'string' && felt.value.trim() ? felt.value : null);
  // ⛔ Runde 3 (Astra 2): vinduet SKAL kunne laeses, og Send-kontrollen skal ligge
  //    paa beskedfeltets raekke - saadan ligger den i chat-apps. Ellers kan knappen
  //    hoere til et andet felt end det hvis tekst mennesket godkendte.
  if (erKontrol) {
    const f = felt.frame, k = knapRamme;
    // Runde 4 (Astra 2): VED SIDEN AF feltet - samme raekke OG vandret lige ved det
    // (inde i feltet eller hoejst 160 pt til hoejre). Kun lodret lod en knap langt
    // til hoejre, i et andet felt eller vindue paa samme hoejde, passere.
    const sammeRaekke = f && k && k.y < f.y + f.h + 16 && k.y + k.h > f.y - 16
                        && k.x >= f.x - 16 && k.x <= f.x + f.w + 160;
    if (!knapVindue || !sam.window || !sammeRaekke) {
      return { afvis: 'the Send control could not be tied to the text field whose message would be sent (its window or position could not be read, or it is not next to that field). Nothing was sent. Ask the person to send it themselves.' };
    }
  }
  if (knapVindue && sam.window && knapVindue !== sam.window) {
    return { afvis: `the Send control is in the window "${String(knapVindue).slice(0, 60)}", not in the conversation shown ("${String(sam.window).slice(0, 60)}"), so a yes could not be tied to it. Nothing was sent.` };
  }
  if (hvem.length && sam.column !== true) {
    return { afvis: 'the name of the conversation could not be tied to the text field (the field\'s position could not be read), so a yes could not be tied to who it goes to. Nothing was sent. Ask the person to send it themselves.' };
  }
  // ⛔ Runde 1 (Astra 3, Fable P4): kan modtager ELLER tekst ikke laeses, kan et ja
  //    ikke bindes til det der sendes - og en genkontrol af to «ulaeselige» er
  //    ingen kontrol. Saa sendes intet herfra; mennesket kan selv sende.
  if (!hvem.length || !tekst) {
    return { afvis: `${!hvem.length ? 'who this message goes to' : 'the text of this message'} could not be read from the screen, ` +
      'so a yes could not be tied to what would actually be sent. Nothing was sent. Ask the person to send it themselves, ' +
      'or open the conversation so its name is shown above the text field.' };
  }
  const fp = JSON.stringify({ w: sam.window || '', h: sam.headings || [], r: sam.recipient || '', v: felt.value, c: !!sam.column });
  return { fp, describe: [
    `Send a ${slags === 'mail' ? 'mail' : 'message'} in ${bid}.`,
    `To (read from the screen, above the text field): ${hvem[0]}`,
    `Message (read back from the field): “${tekst}”`
  ].join(' ') };
}

export function hvorforSpoerg(name, args, { usloeretBillede, optagStart }) {
  if (optagStart) return 'Password managers are left out, but one opened mid-recording can show for a moment. Password fields elsewhere are NOT blacked out.';
  if (usloeretBillede) return 'Password fields will NOT be blacked out in this image, and the image goes to the agent.';
  if (name === 'computer_space') return 'This changes which desktop you are looking at.';
  if (name === 'computer_quit' || (name === 'computer_window' && args.button === 'close')) return 'Unsaved work in it can be lost.';
  if (name === 'computer_key') return 'This key combination can close, quit, delete or interrupt something, depending on the app it lands in.';
  if (name === 'computer_menu') return 'This looks like it deletes or clears something - a guess from the words in the name. The path above is the part that is certain.';
  return null;
}

async function optag(args) {
  const nu = () => Math.round((Date.now() - optagelse.start) / 1000);
  if (args.action === 'status') {
    return textResult(optagelse && !optagelse.slut
      ? { recording: true, path: optagelse.sti, seconds: nu(), maxSeconds: optagelse.max }
      : { recording: false });
  }
  if (args.action === 'stop') {
    if (!optagelse) throw new HelperError('nothing is being recorded', 'not-recording');
    const o = optagelse;
    // ⛔ FABLE 25/9 (runde 2): et stop MENS optagelsen startede, ramte hjaelperen foer
    //    den kunne haandtere signalet - filen blev aldrig afsluttet. Vent paa starten.
    await Promise.race([o.startLinje, new Promise(res => setTimeout(res, 40_000))]);
    if (!o.slut) { try { o.barn.kill('SIGINT'); } catch { /* allerede vaek */ } }
    const TIDEN = Symbol('tiden');
    const r = await Promise.race([o.faerdig, new Promise(res => setTimeout(() => res(TIDEN), 40_000))]);
    // ⛔ Astra 25/9: `optagelse = null` uden at se efter - en NY optagelse startet
    //    mens dette stop ventede, mistede sin reference og kunne ikke stoppes.
    if (optagelse === o) optagelse = null;
    if (r === TIDEN) { try { o.barn.kill('SIGKILL'); } catch {} if (optagelse === o) optagelse = null; throw new HelperError('the recording did not finish within 40 seconds', 'record-timeout'); }
    // ⛔ FABLE 25/9: en hjaelper der doede uden et ord, blev meldt som «did not finish
    //    within 40 seconds» - efter 0 sekunder. Det er to forskellige ting.
    if (!r) throw new HelperError(`the recording ended without a result; check ${o.sti}`, 'record-failed');
    if (!r.ok) throw new HelperError(`${r.error || 'the recording failed'}${r.path && r.bytes ? ` - the file up to that point: ${r.path}` : ''}`, r.code || 'record-failed');
    const res = textResult({ ...r, note: 'The file is for a person to watch. This server never reads it back.' });
    // Stop er et LAESE-kald, saa den faelles advarsel om en uskrevet udfaldslinje naar
    // det ikke (Astra 25/9). Slutningen blev skrevet lige foer - kunne den ikke, siges det.
    if (!loggenKanSkrives()) res.content.push({ type: 'text', text: `Note: the end of this recording could not be written to the audit log at ${AUDIT_PATH}.` });
    return res;
  }
  if (optagelse && !optagelse.slut) {
    throw new HelperError(`a recording is already running (${optagelse.sti}); stop it first`, 'already-recording');
  }
  const max = Math.min(3600, Math.max(1, Math.round(args.maxSeconds ?? 600)));
  const mappe = process.env.CMCP_RECORD_DIR || join(homedir(), 'Movies', 'Computer MCP');
  mkdirSync(mappe, { recursive: true });
  // To servere kan optage samtidig (én ad gangen gaelder pr. server), saa samme
  // sekund maa ikke give samme fil.
  const stempel = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let sti = join(mappe, `computer-mcp-${stempel}.mov`);
  for (let i = 2; existsSync(sti); i++) sti = join(mappe, `computer-mcp-${stempel}-${i}.mov`);
  const hj = helperPath();
  if (!hj) throw new HelperError('the helper binary was not found', 'helper-missing');
  const a = ['record', '--out', sti, '--seconds', String(max)];
  if (Number.isInteger(args.displayId)) a.push('--display-id', String(args.displayId));
  const barn = spawn(hj, a, { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '', sidste = null, startet, erStartet = false;
  const startLinje = new Promise(res => { startet = res; });
  const faerdig = new Promise(res => {
    barn.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i); buf = buf.slice(i + 1);
        let j = null; try { j = JSON.parse(l); } catch { continue; }
        if (j.recording === true) { erStartet = true; startet(j); } else sidste = j;
      }
    });
    // ⛔ FABLE 25/9, MAALT: en optagelse der stoppede af sig selv (loft, serveren
    //    vaek, fejl midtvejs) efterlod NUL linjer i loggen, og stop-linjen bar
    //    hverken fil, varighed eller aarsag. Loggen kunne ikke svare paa «hvilken
    //    fil, hvor laenge, hvorfor stoppede den». Slutningen skrives nu HER, det
    //    ene sted alle veje ud af en optagelse passerer - ogsaa stop-kaldet.
    // ⛔ ASTRA 25/9: 'exit' kan komme FOER stdout er toemt - saa manglede slutlinjen
    //    (og med den, loglinjen). 'close' kommer efter.
    barn.on('error', (e) => { sidste = sidste || { ok: false, code: 'spawn-failed', error: String(e.message).slice(0, 200) }; });
    barn.on('close', () => {
      if (optagelse && optagelse.barn === barn) optagelse.slut = true;
      startet(null);
      if (erStartet) {
        const ok = sidste?.ok === true;
        record({ tool: 'computer_record', recording: 'stopped', file: sti,
                 outcome: ok && !sidste.error ? 'ok' : 'error',
                 stopped_by: ok ? (sidste.stopped_by || 'unknown') : (sidste?.stopped_by || 'error'),
                 ...(ok ? { seconds: sidste.seconds, bytes: sidste.bytes, excluded_apps: sidste.excluded_apps || [] }
                        : { error: sidste?.code || 'no-result',
                            ...(sidste?.error ? { message: String(sidste.error).slice(0, 300) } : {}),
                            ...(Number.isInteger(sidste?.bytes) ? { bytes: sidste.bytes } : {}),
                            ...(Array.isArray(sidste?.excluded_apps) ? { excluded_apps: sidste.excluded_apps } : {}) }) });
      }
      res(sidste);
    });
  });
  optagelse = { barn, sti, max, start: Date.now(), faerdig, startLinje, slut: false };
  const f = await Promise.race([startLinje, new Promise(res => setTimeout(() => res(null), 40_000))]);
  if (!f) {
    try { barn.kill('SIGINT'); } catch {}
    const r = await Promise.race([faerdig, new Promise(res => setTimeout(() => res(null), 5_000))]);
    // ⛔ Astra 25/9: et barn der ignorerede signalet, blev efterladt uden at nogen
    //    kunne stoppe det. Nu draebes det.
    if (!r) { try { barn.kill('SIGKILL'); } catch {} }
    if (optagelse && optagelse.barn === barn) optagelse = null;
    throw new HelperError(r?.error || 'the recording did not start', r?.code || 'record-failed');
  }
  record({ tool: 'computer_record', recording: 'started', file: sti, max_seconds: max,
           ...(Number.isInteger(f.displayId) ? { displayId: f.displayId } : {}), excluded_apps: f.excluded_apps || [] });
  return textResult({ recording: true, path: sti, maxSeconds: max, excluded_apps: f.excluded_apps || [],
    note: 'Recording. Call computer_record with action "stop" to finish the file.' });
}

async function runTool(name, args) {
  switch (name) {
    case 'computer_permissions': {
      const r = await callHelper(['permissions']);
      const omveje = klientOmveje();
      return textResult({
        ...omveje,
        accessibility: r.accessibility,
        screenRecording: r.screenRecording,
        macos: r.macos,
        mode: currentMode(),
        auditLog: AUDIT_PATH,
        background: baggrund(),
        hint: (r.accessibility && r.screenRecording)
          ? 'Both permissions are granted.'
          : 'Missing access: System Settings > Privacy & Security > Accessibility and Screen & System Audio Recording. Grant it to the app that runs the MCP server - the permission belongs to that app, not to this tool.'
      });
    }
    case 'computer_apps': return textResult(await callHelper(['apps']));
    case 'computer_windows': {
      const a = ['windows']; if (args.app) a.push('--app', String(args.app));
      return textResult(await callHelper(a));
    }
    case 'computer_inspect': {
      // ⛔ OMBYGGET 22/9, fundet af to raadgivere og maalt paa Gustavs IDE:
      //
      //    Standard-dybden 12 stoppede OVER indholdet. I en Electron-app ligger
      //    teksten paa dybde 22-26. Maalt: dybde 12 saa 9 stykker tekst; dybde
      //    40 med loft 1500 saa 770. Agenten saa ni ting, konkluderede «tomt»
      //    og tog et skaermbillede - den dyreste vej der findes.
      //
      //    Og formen var forkert. Samme indhold som indrykket JSON: 1.485.390
      //    tegn. Som ren tekst: 102.450. Fjorten gange. browser-mcp's
      //    `get_page_content` giver siden som tekst; det er det der kopieres.
      //
      //    `format: 'json'` findes stadig for den der vil have rammer og dybde.
      const a = ['inspect'];
      if (args.app) a.push('--app', String(args.app));
      a.push('--depth', String(args.depth ?? 40), '--limit', String(args.limit ?? 1500));
      const r = await callHelper(a);
      const noder = r?.nodes || [];
      if ((args.format ?? 'text') === 'json') {
        // Slankere: app og bundleId staar én gang, ikke paa hver node, og en
        // node uden tekst og uden noget at trykke paa, faar ingen ramme.
        const app0 = noder[0]?.app, bid0 = noder[0]?.bundleId;
        const slanke = noder.map(({ app, bundleId, frame, ...rest }) => {
          const harTekst = rest.title || rest.value || rest.desc;
          return (harTekst || rest.pressable) && frame ? { ...rest, frame } : rest;
        });
        return textResult({ app: app0, bundleId: bid0, count: slanke.length, nodes: slanke });
      }
      return textResult(somTekst(noder, r));
    }
    case 'computer_pending': {
      const liste = ventende(args.limit ?? 20);
      if (!liste.length) return textResult('Nothing is waiting for a human.');
      return textResult({
        path: KOE_PATH, waiting: liste.length, entries: liste,
        note: 'These were already refused - this is a list, not a button, and nothing here can be approved from here. While the Computer MCP menu bar icon is running, a new attempt waits there for the person to allow it with Touch ID instead of being refused at once. Password apps and unknown targets can never be approved that way.'
      });
    }
    case 'computer_learning': {
      // ⛔ 28/9 (Gustav): «lav en learningsfil som alles computermcp kan opdatere,
      //    saa vi ser den og kan forbedre computermcp». I dag gav agenten op tre
      //    steder, hvor der fandtes en vej videre - og intet sted blev det skrevet
      //    ned. Filen ligger LOKALT ved siden af revisionsloggen og sendes aldrig
      //    af sig selv; linket lader mennesket dele den med os.
      const what = rensLaering(args.what);
      if (!what) throw new HelperError('what is required: what you tried and what actually happened', 'bad-args');
      const kinds = ['nothing-happened', 'workaround', 'refused', 'missing', 'wish'];
      const linje = {
        ts: new Date().toISOString(), version: PKG.version,
        kind: kinds.includes(args.kind) ? args.kind : 'nothing-happened',
        app: rensLaering(args.app, 120) || undefined, tool: rensLaering(args.tool, 60) || undefined,
        what, worked: rensLaering(args.worked) || undefined
      };
      mkdirSync(dirname(LAERING_PATH), { recursive: true });
      appendFileSync(LAERING_PATH, JSON.stringify(linje) + '\n', { mode: 0o600 });
      const antal = readFileSync(LAERING_PATH, 'utf8').split('\n').filter(Boolean).length;
      const titel = `[${linje.kind}] ${what.slice(0, 80)}`;
      const krop = [`**What happened:** ${what}`, linje.worked && `**What worked:** ${linje.worked}`,
        `**App:** ${linje.app || '-'} · **Tool:** ${linje.tool || '-'} · Computer MCP ${PKG.version}`].filter(Boolean).join('\n\n');
      return textResult({
        saved: LAERING_PATH, entries: antal, entry: linje,
        share: `https://github.com/Agent360dk/computerMCP/issues/new?title=${encodeURIComponent(titel)}&body=${encodeURIComponent(krop)}`,
        note: 'Written to a local file only - nothing was sent anywhere. The person can share it with the maintainers through the link.'
      });
    }
    case 'computer_audit': {
      const limit = args.limit ?? 40;
      if (!existsSync(AUDIT_PATH)) return textResult('The audit log is empty - nothing has been done yet.');
      const lines = readFileSync(AUDIT_PATH, 'utf8').trim().split('\n').filter(Boolean);
      // ⛔ "Append-only" var en hensigt indtil 20/9. Nu baerer hver linje et
      //    fingeraftryk af sig selv og af den foregaaende, saa en fjernet
      //    eller aendret linje bryder kaeden - og det siges HER, hvor nogen
      //    faktisk laeser loggen.
      const k = kaedenHolder();
      return textResult({
        path: AUDIT_PATH, total: lines.length,
        chain: k.ukendt
          ? `UNKNOWN - the log could not be read (${k.grund}). This is not "intact"; it is "we do not know".`
          : k.tail_removed
          ? 'BROKEN at the END - the newest lines are gone. Every line still links to the one before it, but the last line we wrote is no longer in the file.'
          : k.aegte
          ? `BROKEN at line ${k.brudtVedLinje} - a line was removed or edited`
          : `intact across ${k.checked} linked lines`
            + (k.gamle
                ? ` (${k.gamle} older break${k.gamle > 1 ? 's' : ''} from two servers writing at once, before the write lock existed on 21 Sep - not tampering)`
                : ''),
        entries: lines.slice(-limit).map(l => JSON.parse(l))
      });
    }
    case 'computer_launch': {
      const r = await callHelper(['launch', '--app', String(args.app),
        ...(args.background ? ['--background'] : [])]);
      return medSkaerm(textResult(r), r);
    }
    case 'computer_open': {
      // Doeren. Modellen giver et intent + EN parameter, aldrig en URL. Serveren
      // bygger URL'en af en fast skabelon og validerer parameteren strengt, saa
      // KUN cifre/bogstaver kan passere - ingen injektion, ingen fri scheme.
      const intent = String(args.intent || '');
      if (intent === 'open_app') {
        const bid = String(args.bundleId || '');
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(bid)) return errorResult('Refused: open_app needs a valid bundle id like com.spotify.client. Nothing was done.');
        const r = await callHelper(['launch', '--app', bid, '--background']);
        return medSkaerm(textResult(r), r);
      }
      let url;
      if (intent === 'play_track') {
        const id = String(args.spotifyId || '');
        if (!/^[0-9A-Za-z]{22}$/.test(id)) return errorResult('Refused: play_track needs a 22-character Spotify track id (letters and digits only). Nothing was done.');
        url = `spotify:track:${id}`;
      } else if (intent === 'open_chat') {
        const phone = String(args.phone || '').replace(/[\s()-]/g, '');
        if (!/^\+?\d{4,15}$/.test(phone)) return errorResult('Refused: open_chat needs a phone number in international form, e.g. +4560174569. Nothing was done.');
        url = `whatsapp://send?phone=${encodeURIComponent(phone.replace(/^\+/, ''))}`;
      } else {
        return errorResult(`Refused: unknown intent '${intent}'. Use open_app, play_track or open_chat. Nothing was done.`);
      }
      const r = await callHelper(['open-url', '--url', url]);
      return medSkaerm(textResult(r), r);
    }
    case 'computer_quit': {
      // ⛔ 23/9: svaret baar intet `took_screen`, saa loggen kunne ikke goere
      //    det op for den her vej. Et program der rejser et «vil du gemme?»-ark
      //    kan hive sig selv frem - og det skal staa der, ogsaa naar det ikke
      //    var os der gjorde det.
      const r = await callHelper(['quit', '--app', String(args.app)]);
      return medSkaerm(textResult(r), r);
    }
    case 'computer_drag':
      return textResult(await callHelper([
        'drag',
        '--from-x', String(args.fromX), '--from-y', String(args.fromY),
        '--to-x', String(args.toX), '--to-y', String(args.toY),
        ...(args.steps != null ? ['--steps', String(args.steps)] : []),
        ...(args.holdMs != null ? ['--hold-ms', String(args.holdMs)] : [])
      ]));
    case 'computer_space':
      return textResult(await callHelper(['space', '--direction', String(args.direction)]));
    case 'computer_paste': {
      // Teksten gaar paa stdin, aldrig som argument: et argument staar i
      // procestabellen, hvor enhver bruger paa maskinen kan laese det med `ps`.
      const a = ['paste'];
      if (args.restore === false) a.push('--no-restore');
      return textResult(await callHelper(a, { stdin: String(args.text) }));
    }
    case 'computer_window': {
      const base = ['--app', String(args.app)];
      if (args.title) base.push('--title', String(args.title));
      if (Number.isInteger(args.index)) base.push('--index', String(args.index));
      if (args.button) {
        const rb = await callHelper(['window-button', ...base, '--button', String(args.button)]);
        return medSkaerm(textResult(rb), rb);
      }
      // ⛔ MAALT 23/9, fundet af en raadgiver: her stod kun `if (Number.isInteger)`.
      //    Et kald med `x: 100.5` sendte derfor INGEN geometri, hjaelperen sprang
      //    hele flytte-blokken over, og svaret var:
      //      {"did":[],"ok":true,"result":"sat","took_screen":false}
      //    Modellen bad om et flyt, intet skete, og svaret sagde «sat».
      //    READMEen lover ordret «It does not pretend». Det her var at lade som om.
      const a = ['window-set', ...base];
      const skaeve = [];
      for (const [k, f] of [['x','--x'],['y','--y'],['width','--width'],['height','--height']]) {
        if (args[k] === undefined || args[k] === null) continue;
        if (!Number.isInteger(args[k])) { skaeve.push(`${k}: ${JSON.stringify(args[k])}`); continue; }
        a.push(f, String(args[k]));
      }
      if (skaeve.length) return errorResult(
        `Refused: window coordinates must be whole numbers of points, and these are not - ${skaeve.join(', ')}. ` +
        `Round them and call again. Nothing was moved.`);
      if (a.length === base.length + 1) return errorResult(
        'Refused: nothing to change. Give x, y, width or height to move or resize the window, ' +
        'or button: "close" / "minimize" to press its own button.');
      const rw = await callHelper(a);
      return medSkaerm(textResult(rw), rw);
    }
    case 'computer_menus': {
      const a = ['menus', '--app', String(args.app)];
      if (Number.isInteger(args.depth)) a.push('--depth', String(args.depth));
      return textResult(await callHelper(a));
    }
    case 'computer_menu': {
      // took_screen: et menupunkt kan faa programmet til at hente sig selv frem (27/9).
      const r = await callHelper(['menu-click', '--app', String(args.app), '--path', String(args.path)]);
      return medSkaerm(textResult(r), r);
    }
    case 'computer_displays':
      return textResult(await callHelper(['displays']));
    case 'computer_record': return optag(args);
    case 'computer_screenshot': {
      const out = join(tmpdir(), `cmcp-${randomUUID()}.png`);
      const a = ['screenshot', '--out', out, '--max-width', String(args.maxWidth ?? 1400)];
      if (args.app) a.push('--app', String(args.app));
      if (args.redact === false) a.push('--no-redact');
      if (Number.isInteger(args.displayId)) a.push('--display-id', String(args.displayId));
      else if (Number.isInteger(args.display)) a.push('--display', String(args.display));
      const r = await callHelper(a, { timeout: 45000 });
      try {
        const data = readFileSync(out).toString('base64');
        return {
          content: [
            { type: 'text', text:
              `${r.width}x${r.height} px. The screen is ${r.screenWidthPoints}x${r.screenHeightPoints} points, ` +
              `so ${r.pixelsPerPoint} pixels per point. ` +
              `computer_click works in POINTS: divide a coordinate taken from this image by ${r.pixelsPerPoint}` +
              // ⛔ MAALT 19/9: skaermene laa paa (-3840,27), (-1920,27) og (0,0).
              //    Et klik regnet uden origo fra skaerm 0's billede rammer 1920 punkter
              //    ved siden af - paa en anden monitor. Hintet skal baere origo, ellers
              //    er det et raad der sender agenten det forkerte sted hen.
              ((r.displayOriginX || r.displayOriginY)
                ? ` and then add (${r.displayOriginX}, ${r.displayOriginY}) - that is where this screen starts on the desktop. `
                : ' before you click. ') +
              `${r.redacted ? `Redacted (${r.redactedRegions} regions)` : 'NOT redacted'}. Scope: ${r.scope}.` +
              // Kun naar der ER flere. En maskine med een skaerm skal ikke laese om et problem
              // den ikke har - men paa en maskine med tre var to af dem usynlige uden et ord.
              (r.displays > 1
                ? ` This machine has ${r.displays} screens; this is id ${r.displayId}.`
                  + ` If you are looking for a window you cannot see, it is probably on another one:`
                  + ` call computer_displays and pass displayId.`
                : '') },
            { type: 'image', data, mimeType: 'image/png' }
          ]
        };
      } finally {
        // Filen slettes altid. Et sloeret billede er stadig et billede af
        // brugerens skaerm, og det skal ikke ligge i /tmp bagefter.
        try { unlinkSync(out); } catch { /* ligegyldigt */ }
      }
    }
    case 'computer_find': {
      // ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9: `contains` og `title` gik som
      //    ARGUMENTER, og `ps` viser hele kommandolinjen for enhver proces med
      //    samme bruger. MAALT: en hemmelighed i --contains stod ordret i
      //    procestabellen. Vores EGEN revisionslog fingeraftrykker netop de to
      //    felter, fordi de baerer hemmeligheder - loggen behandlede dem som
      //    hemmelige, kaldet gjorde ikke. De gaar nu paa stdin, som den skrevne
      //    tekst har gjort siden 18/9.
      const a = ['find', '--match-stdin'];
      if (args.app) a.push('--app', String(args.app));
      if (args.role) a.push('--role', String(args.role));
      if (args.subrole) a.push('--subrole', String(args.subrole));
      a.push('--depth', String(args.depth ?? 24), '--limit', String(args.limit ?? 25));
      const soeg = {};
      if (args.title) soeg.title = String(args.title);
      if (args.contains) soeg.contains = String(args.contains);
      return textResult(await callHelper(a, { stdin: JSON.stringify(soeg) }));
    }
    case 'computer_focused':
      return textResult(await callHelper(['focused']));
    case 'computer_set_value': {
      // ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9: `contains` og `title` gik som
      //    ARGUMENTER, og `ps` viser hele kommandolinjen for enhver proces med
      //    samme bruger. MAALT: en hemmelighed i --contains stod ordret i
      //    procestabellen. Vores EGEN revisionslog fingeraftrykker netop de to
      //    felter, fordi de baerer hemmeligheder - loggen behandlede dem som
      //    hemmelige, kaldet gjorde ikke. De gaar nu paa stdin, som den skrevne
      //    tekst har gjort siden 18/9.
      const a = ['set-value', '--match-stdin'];
      if (args.app) a.push('--app', String(args.app));
      if (args.role) a.push('--role', String(args.role));
      if (args.subrole) a.push('--subrole', String(args.subrole));
      if (Number.isInteger(args.index)) a.push('--index', String(args.index));
      if (args.first) a.push('--first');
      // Teksten OG soegningen i én blok: de kan ikke hver laese stdin.
      const soeg = {};
      if (args.title) soeg.title = String(args.title);
      if (args.contains) soeg.contains = String(args.contains);
      soeg.text = String(args.text);
      const r = await callHelper(a, { stdin: JSON.stringify(soeg) });
      // Hjaelperen laeser vaerdien TILBAGE bagefter. Kun derfor kan vi sige
      // «verified» om noget som helst.
      return medEffekt(textResult(r), r?.verified === true ? 'verified' : 'sent');
    }
    case 'computer_wait_for': {
      // ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9: `contains` og `title` gik som
      //    ARGUMENTER, og `ps` viser hele kommandolinjen for enhver proces med
      //    samme bruger. MAALT: en hemmelighed i --contains stod ordret i
      //    procestabellen. Vores EGEN revisionslog fingeraftrykker netop de to
      //    felter, fordi de baerer hemmeligheder - loggen behandlede dem som
      //    hemmelige, kaldet gjorde ikke. De gaar nu paa stdin, som den skrevne
      //    tekst har gjort siden 18/9.
      const a = ['wait-for', '--match-stdin'];
      if (args.app) a.push('--app', String(args.app));
      if (args.role) a.push('--role', String(args.role));
      if (args.subrole) a.push('--subrole', String(args.subrole));
      const soeg = {};
      if (args.title) soeg.title = String(args.title);
      if (args.contains) soeg.contains = String(args.contains);
      const secs = Number(args.timeout) > 0 ? Number(args.timeout) : 15;
      a.push('--timeout', String(secs));
      if (args.poll) a.push('--poll', String(args.poll));
      // Hjaelperen skal have lov at vente hele tiden ud plus luft til ét opslag.
      return textResult(await callHelper(a, { timeout: (secs + 20) * 1000, stdin: JSON.stringify(soeg) }));
    }
    case 'computer_press': {
      // ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9: `contains` og `title` gik som
      //    ARGUMENTER, og `ps` viser hele kommandolinjen for enhver proces med
      //    samme bruger. MAALT: en hemmelighed i --contains stod ordret i
      //    procestabellen. Vores EGEN revisionslog fingeraftrykker netop de to
      //    felter, fordi de baerer hemmeligheder - loggen behandlede dem som
      //    hemmelige, kaldet gjorde ikke. De gaar nu paa stdin, som den skrevne
      //    tekst har gjort siden 18/9.
      const { a, soeg } = trykArgv(args);
      const r = await callHelper(a, { stdin: JSON.stringify(soeg) });
      // press udfoerer elementets EGEN handling og faar svar fra programmet.
      return medSkaerm(medEffekt(textResult(r), 'performed'), r);
    }
    case 'computer_ask_user': {
      // ⛔ 29/9 (panelet): i baggrund tager en dialog skaermen, saa spoergsmaalet
      //    gaar til menulinje-ikonet. Mennesket henter selv programmet frem
      //    («Take me there» er DERES klik), taster og vaelger «Done». Et Done er
      //    et signal, ikke et samtykke - det kan aldrig give lov til en handling.
      if (baggrund()) {
        if (!args.app) {
          return errorResult('Refused: in background mode, name the `app` whose field the person should use - the field you put the cursor in with computer_press. ' +
            'The question then waits in the menu bar icon, and nothing is brought to the front.');
        }
        const bid = await resolveBundleId(String(args.app));
        if (!bid) return errorResult(`Refused: '${args.app}' is not running, so there is no field to type in. Use computer_apps for the exact name.`);
        let titel = null;
        try {
          const w = await callHelper(['windows', '--app', bid], { timeout: 8000 });
          titel = ((w && w.windows) || [])[0]?.title || null;
        } catch { titel = null; }
        // SERVEREN skriver hvor, ikke modellen.
        const hvorIkon = titel ? `${bid} - the window "${String(titel).slice(0, 70)}"` : bid;
        const svar = await spoergOmGoerSelv({
          session: SESSION, client: server.getClientVersion?.()?.name || process.env.CMCP_CLIENT || null,
          text: String(args.message),
          scope: 'You do this yourself. Computer MCP does not see what you type, and it is not written to the log.',
          target: hvorIkon, targetBundle: bid
        }, askTimeout());
        if (svar.ikkeSpurgt) {
          return errorResult(`Refused: ${svar.grund}. Nothing was asked and nothing was brought to the front. ` +
            'Tell the person in the chat what you need them to do.');
        }
        return textResult(svar.ok
          ? { done: true, hvor: hvorIkon, via: 'menu bar', note: 'The person says it is done. We did not see what was typed, and it is not in the log.' }
          : { done: false, cancelled: true, hvor: hvorIkon, via: 'menu bar', note: `${svar.grund}. Do not ask again with the same request.` });
      }
      // Forgrund: dialogen. SERVEREN skriver hvor det lander, ikke modellen. En
      // prompt-indsproejtning kan formulere `message` - den kan ikke formulere
      // denne linje.
      let hvor = null;
      try {
        const bid = await frontmostBundleId();
        const w = bid ? await callHelper(['windows', '--app', String(bid)], { timeout: 8000 }) : null;
        const titel = ((w && w.windows) || [])[0]?.title;
        hvor = bid ? (titel ? `${bid} - the window "${String(titel).slice(0, 70)}"` : bid) : null;
      } catch { hvor = null; }
      const gjort = await askHumanToDo(String(args.message), hvor);
      // Kun en boolean. Aldrig tekst.
      return textResult(gjort
        ? { done: true, hvor, note: 'The person says it is done. We did not see what was typed, and it is not in the log.' }
        : { done: false, cancelled: true, hvor, note: 'The person cancelled, or did not answer. Do not ask again with the same request.' });
    }
    case 'computer_click': {
      const r = await callHelper(['click', '--x', String(args.x), '--y', String(args.y),
        '--button', String(args.button || 'left'), '--count', String(args.count || 1),
        ...(args.app ? ['--app', String(args.app)] : [])]);
      // ⛔ MAALT 22/9 i e2e-forloebet: et klik leveret til en proces-koe
      //    LANDEDE IKKE - knappen skiftede ikke titel. Og svaret sagde
      //    «Clicked at 395, 245. The pointer stayed where the person left it»,
      //    som om det var lykkedes. Samme fejlklasse som set_value samme dag:
      //    «It does not pretend».
      //    Et museklik baerer intet vinduesnummer, saa om et program tager
      //    imod et klik i et vindue det ikke ser markoeren naa, er UMAALT for
      //    et vindue paa skaermen og maalt NEJ for et uden for den.
      //    Svaret siger derfor at det er SENDT, ikke at det lykkedes - og
      //    peger paa den vej der er bevist.
      const sendt = args.app
        ? `Click sent to ${args.app}'s own queue at ${Math.round(args.x)}, ${Math.round(args.y)}. `
          + `Whether an app accepts a mouse click in a window the pointer never reached is NOT verified - `
          + `measured, it did not land on a window off-screen. For a button, computer_press is the proven route: `
          + `find it with computer_find, then press it.`
        : `Clicked at ${Math.round(args.x)}, ${Math.round(args.y)}.`;
      // Et museklik baerer intet vindue-nummer og faar intet svar.
      return medEffekt(medSkaerm(textResult(sendt + stilleNote(args.app, r)), r), 'sent');
    }
    case 'computer_move':
      await callHelper(['move', '--x', String(args.x), '--y', String(args.y)]);
      return textResult('The pointer moved.');
    case 'computer_scroll': {
      const r = await callHelper(['scroll', '--dx', String(args.dx || 0), '--dy', String(args.dy || 0),
        ...(args.app ? ['--app', String(args.app)] : [])]);
      return medSkaerm(textResult('Scrolled.' + stilleNote(args.app, r)), r);
    }
    case 'computer_type':
      // ⛔ Teksten gaar paa STDIN, aldrig som argument. Vi lovede det paa
      //    tools-siden ("never as a command-line argument, because ps is
      //    readable by every process on the machine") - og gjorde det ikke.
      //    Hjaelperen har haft --stdin siden 18/9; JS-siden brugte den aldrig.
      //    Det var altsaa et udgivet loefte der var usandt i den udgivne kode.
      const r = await callHelper(['type', '--stdin', '--cps', String(args.cps || 240),
        ...(args.app ? ['--app', String(args.app)] : [])],
        { timeout: Math.max(30000, String(args.text).length * 60), stdin: String(args.text) });
      // Med et navngivet program skriver hjaelperen i programmets fokuserede felt og
      // laeser det tilbage (27/9). Kun det kan kaldes «verified»; tastetryk kvitteres ikke.
      if (r?.method === 'accessibility' && r?.verified === true) {
        return medInput(r, medEffekt(medSkaerm(textResult(`Typed ${String(args.text).length} characters into the field ${args.app} has focus in, and read them back.` + stilleNote(args.app, r)), r), 'verified'));
      }
      return medInput(r, medEffekt(medSkaerm(textResult(`Typed ${String(args.text).length} characters.` + (args.app ? ' Sent as keystrokes to the app\'s own queue; the app does not confirm them, so read the field back if it matters.' : '') + stilleNote(args.app, r)), r), 'sent'));
    case 'computer_key': {
      const r = await callHelper(['key', '--combo', String(args.combo),
        ...(args.app ? ['--app', String(args.app)] : [])]);
      return medEffekt(medSkaerm(textResult(`Pressed ${args.combo}.` + stilleNote(args.app, r)), r), 'sent');
    }
    case 'computer_activate':
      await callHelper(['activate', '--app', String(args.app)]);
      return textResult(`Switched to ${args.app}.`);
    default:
      throw new HelperError(`unknown tool: ${name}`, 'unknown-tool');
  }
}

/// Holder argumenterne op mod vaerktoejets eget skema. Skemaerne bruger kun
/// type, properties, required og enum, saa det er hele den understoettede del.
/// ⛔ Ukendte felter AFVISES (24/9, sikkerhedsgennemgangen runde 2). Her stod
///    «ignoreres - de sendes heller ikke videre». Men PORTEN laeste dem:
///    `computer_drag {..., app: "Google Chrome"}` blev vurderet paa Chrome,
///    som var forrest og almindelig, mens traekket landede i Passwords-vinduet
///    bag det. Et felt vaerktoejet ikke bruger, maa ikke kunne styre porten.
///    Maalt foer rettelsen: ingen haandtering laeser et felt uden for sit skema.
function tjekSkema(skema, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return 'the arguments must be an object';
  const kendte = skema?.properties || {};
  for (const k of Object.keys(args)) {
    if (!Object.prototype.hasOwnProperty.call(kendte, k)) return `\`${k}\` is not a parameter of this tool`;
  }
  for (const k of (skema?.required || [])) {
    if (args[k] === undefined || args[k] === null) return `\`${k}\` is required`;
  }
  for (const [k, def] of Object.entries(skema?.properties || {})) {
    if (!(k in args) || args[k] === undefined) continue;
    const v = args[k];
    const typer = [].concat(def.type || []);
    const passer = typer.length === 0 || typer.some(t =>
      (t === 'string' && typeof v === 'string') ||
      (t === 'number' && typeof v === 'number' && Number.isFinite(v)) ||
      (t === 'integer' && Number.isInteger(v)) ||
      (t === 'boolean' && typeof v === 'boolean') ||
      (t === 'array' && Array.isArray(v)) ||
      (t === 'object' && v !== null && typeof v === 'object' && !Array.isArray(v)));
    if (!passer) return `\`${k}\` must be ${typer.join(' or ')}, got ${Array.isArray(v) ? 'array' : typeof v}`;
    if (Array.isArray(def.enum) && !def.enum.includes(v)) return `\`${k}\` must be one of ${def.enum.join(', ')}`;
  }
  return null;
}

async function haandterKald(request) {
  const name = request.params.name;
  const args = request.params.arguments || {};
  const tool = TOOL_BY_NAME.get(name);
  // README lover «every call». Et ukendt vaerktoej er ogsaa et kald (Fable 25/9).
  if (!tool) {
    // ⛔ Astra 25/9: navnet stod ordret i loggen - det er modellens tekst.
    record({ tool: 'unknown', name: fingerprint(String(name)), decision: 'denied', reason: 'unknown tool' });
    return errorResult(`Unknown tool: ${name}`);
  }

  // ⛔ SIKKERHEDSGENNEMGANG 24/9 (B1, kritisk) - MAALT mod en attrap-hjaelper:
  //    serveren tjekkede INTET mod vaerktoejets eget skema. `maxWidth` blev sendt
  //    som `String(args.maxWidth)`, og `{maxWidth: "--no-redact"}` gav argv
  //    `... --max-width --no-redact`. Hjaelperens parser laeser en vaerdi der
  //    begynder med `--` som et NYT flag - saa sloeringen blev slaaet fra, og
  //    fordi `redact` aldrig var sat til false, spurgte porten ingen. Et usloeret
  //    skaermbillede uden samtykke, med én streng. Samme rod gav `x: "100"` forbi
  //    ikon-vagten, som kun tjekkede tal.
  //    Nu: hvert kald holdes op mod skemaet FOER porten og foer hjaelperen.
  //    Én central vagt, ingen navneliste - et nyt felt er daekket den dag det
  //    faar en type i tools.js.
  const skemaFejl = tjekSkema(tool.inputSchema, args);
  if (skemaFejl) {
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
             decision: 'denied', reason: 'arguments do not match the tool schema' });
    return errorResult(`Refused: ${skemaFejl}. Nothing was sent to the Mac.`);
  }

  // ⛔ Runde 4 (Astra 1): laanets tilstand tages ved KALDETS START - foer den
  //    foerste vagt hvis udfald afhaenger af laanet (aktiv-program-vagten laeser
  //    baggrund()). Lige foer handlingen skal tilstanden vaere den samme; er et laan
  //    sluttet, begyndt eller skiftet undervejs, sker handlingen ikke.
  const laanVedDom = laanOejeblik();

  // Skaerm-laanet spoerger selv (i ikonet) og roerer intet program.
  if (name === 'computer_request_screen') return skaermLaan(args);

  // Hvilket program rammer handlingen? For computer_activate er det det
  // program der skiftes TIL, og for computer_press det program elementet
  // ligger i - ellers det der er forrest og altsaa modtager
  // klikket eller tastetrykket.
  let targetBundleId = null;
  if (tool.tier !== TIER.READ || (name === 'computer_screenshot' && args.redact === false)) {
    // ⛔ RETTET 21/9. Hvis kaldet NAVNGIVER et program, er det programmet
    //    der rammes - ikke det der tilfaeldigvis er forrest. Foer i dag
    //    spurgte porten «hvad er forrest?» ogsaa for de fire nye stille kald,
    //    saa `computer_type --app "Keychain Access"` ville blive vurderet paa
    //    menneskets forreste vindue. Adgangskode-porten er hele produktets
    //    kerne; den maa ikke kigge det forkerte sted.
    targetBundleId = args.app
      ? await resolveBundleId(args.app)
      : await frontmostBundleId();
    // Doeren navngiver sit maal via intent'et (ikke via args.app), saa porten
    // ser den rigtige app - ikke det der tilfaeldigvis er forrest - og ikke
    // kalder den "ukendt maal" og spoerger. Et ugyldigt intent giver null, som
    // saa afvises af porten, praecis som det skal.
    if (name === 'computer_open') {
      targetBundleId = args.intent === 'open_app' ? (args.bundleId ? String(args.bundleId) : null)
        : args.intent === 'play_track' ? 'com.spotify.client'
        : args.intent === 'open_chat' ? 'net.whatsapp.WhatsApp'
        : null;
      // ⛔ 9/10 (R19 Opus, MAALT): «bundleId: "Passwords"» blev doemt som id'et «Passwords» - ikke paa
      //    adgangskode-listen - mens hjaelperen startede Adgangskoder ved NAVN. Ogsaa «com.apple.passwords»
      //    (listen sammenligner praecist; Launch Services er ufoelsom for store/smaa). Nu: det program
      //    hjaelperen ville starte, skal have PRAECIS den streng agenten skrev som id - ellers afvises
      //    kaldet, i alle tilstande.
      if (args.intent === 'open_app' && targetBundleId) {
        // Samme formkrav som leveringen - FOER opslaget, saa ingen spoerges om noget der afvises (R20, Opus).
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(targetBundleId)) {
          record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
                   decision: 'denied', asked: false, reason: 'open_app needs a valid bundle id' });
          return errorResult('Refused: open_app needs a valid bundle id like com.spotify.client. Nothing was done.');
        }
        let r = null;
        try { r = await callHelper(['resolve-app', '--app', targetBundleId], { timeout: 15000 }); } catch {}
        if (r?.bundleId !== targetBundleId) {
          const grund = `open_app needs the exact bundle id - '${targetBundleId}' ${r?.bundleId ? `resolves to ${r.bundleId}` : 'is not an installed app'}`;
          // Loggen faar en fast grund - aldrig modellens streng (Astra 25/9).
          record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
                   target: r?.bundleId || null, decision: 'denied', asked: false, reason: 'open_app needs the exact bundle id' });
          return errorResult(`Refused: ${grund}. Pass the bundle id itself. Nothing was done.`);
        }
      }
    }
    // ⛔ FABLE 24/9: et LUKKET program findes ikke blandt de koerende, saa
    //    `computer_launch` blev altid «ukendt maal» og afvist - vaerktoejet
    //    kunne ikke det ene det er til. Hjaelperen svarer nu med det bundle-id
    //    starten ville ramme, ad samme opslag, uden at starte noget. En aeldre
    //    hjaelper kender ikke kommandoen, fejler, og vi forbliver lukket.
    if (!targetBundleId && name === 'computer_launch' && args.app) {
      try {
        const r = await callHelper(['resolve-app', '--app', String(args.app)], { timeout: 15000 });
        targetBundleId = r.bundleId || null;
      } catch { targetBundleId = null; }
    }
  }

  // ⛔ FUNDET AF SIKKERHEDSKONSULENTEN 22/9, Critical: menulinje-ikonet er et
  //    rigtigt program med et rigtigt bundle-id, og `find`/`press` naar ned i
  //    statusikoner. En agent kunne altsaa trykke i ikonets EGEN menu med
  //    vores eget vaerktoej - aabne live-vinduet (en forstyrrelse), lukke
  //    ikonet, og naar ikonet engang kan godkende: trykke «Tillad» paa sit
  //    eget spoergsmaal. Ingen skrivende handling maa ramme ikonet, i nogen
  //    tilstand, og det afgoeres FOER porten kan spoerge nogen.
  //    Tjekket foer OG efter opslaget: ikonet er ikke altid startet, og et
  //    ukendt navn ender ellers som «ukendt maal», som et menneske kan sige ja til.
  // Normaliseret som opslaget selv (trim + smaa bogstaver), og alle ikonets navne.
  const IKON_NAVNE = new Set([STATUS_IKON_ID, 'computer mcp', 'cmcp-status', 'computermcpstatus']);
  const erIkonet = (v) => !!v && IKON_NAVNE.has(String(v).trim().toLowerCase());

  // ⛔ FABLE (23/9): vagten nedenfor ser paa `args.app` eller det FORRESTE
  //    program. Et koordinatklik navngiver intet, og et statusikon er aldrig
  //    forrest - saa et klik paa ikonets egen menu gik udenom, og der kunne
  //    trykkes «Deny» eller «Hide this icon» paa et andet menneskes vegne.
  //    Nu spoerger vi macOS hvem der ejer punktet, foer vi klikker paa det.
  // Tastatur-input der uden app gaar i den globale stroem - til det forreste program.
  // set_value uden app skriver i det felt der har fokus NAAR hjaelperen koerer (Fable 25/9).
  const GLOBALT_INPUT = new Set(['computer_type', 'computer_key', 'computer_paste', 'computer_set_value']);
  // Hvad laa under punkterne da porten vurderede? Genmaales inde i laasen.
  let koordinatPunkter = null, koordinatEjereFoer = null;
  // ⛔ Runde 2: `computer_double_click` og `computer_right_click` stod her, men
  //    findes ikke - dobbelt- og hoejreklik er `computer_click` med count/button.
  //    `computer_scroll` uden app lander under markoeren; den vurderes ved markoeren.
  const KOORDINAT_VAERKTOEJ = new Set(['computer_click', 'computer_move', 'computer_drag', 'computer_scroll']);
  if (KOORDINAT_VAERKTOEJ.has(name) && !args.app && currentMode() !== 'readonly') {
    const punkter = name === 'computer_drag'
      ? [[args.fromX, args.fromY], [args.toX, args.toY]]
      : name === 'computer_scroll' ? [['markoer', 'markoer']]
      : [[args.x, args.y]];
    const ejere = []; let ejerUkendt = false;
    koordinatPunkter = punkter;
    for (const [x, y] of punkter) {
      const vedMarkoer = x === 'markoer';
      if (!vedMarkoer && (typeof x !== 'number' || typeof y !== 'number')) continue;
      let ejer = null;
      try { ejer = await callHelper(vedMarkoer ? ['at', '--pointer'] : ['at', '--x', String(x), '--y', String(y)], { timeout: 8000 }); } catch {}
      if (ejer?.found && ejer.bundleId) ejere.push(ejer.bundleId); else ejerUkendt = true;
      // Vindues-stakken over punktet: klikket rammes af vindues-serveren, ikke af
      // tilgaengeligheds-laget. Alle kandidater vurderes (Fable, runde 2).
      for (const u of (Array.isArray(ejer?.under) ? ejer.under : [])) if (typeof u === 'string' && u && !ejere.includes(u)) ejere.push(u);
      if (ejere.some(erIkonet)) {
        const grund = 'that point belongs to the Computer MCP status icon';
        record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
                 target: STATUS_IKON_ID, decision: 'denied', asked: false, reason: grund });
        return errorResult(`Refused: ${grund}. It is where the person watches the agents and answers them; an agent may not click in it.`);
      }
    }
    // ⛔ Sikkerhedsgennemgangen 24/9: porten vurderede et koordinatklik paa det
    //    FORRESTE program - men klikket lander i det vindue der ligger under
    //    punktet. Et 1Password-vindue bag Chrome blev klikket i uden at spoerge.
    //    Nu er maalet punktets ejer; rammer et traek to programmer, vurderes
    //    det farligste. Kan ejeren ikke opsloas, er maalet ukendt - og et
    //    ukendt maal spoerger, som alle andre steder i porten.
    koordinatEjereFoer = ejerUkendt ? null : ejere.slice();
    if (ejerUkendt) targetBundleId = null;
    else if (ejere.length) {
      targetBundleId = ejere.find(b => ALWAYS_ASK_APPS.has(b))
                    || ejere.find(b => SPOERG_PR_SESSION.has(b))
                    || ejere[0];
    }
  }

  // ⛔ 25/9: `set_value` uden app men MED soegekriterier soeger i ALLE programmer -
  //    et soegefelt i Passwords kan vaere det der rammes - mens porten vurderede
  //    det forreste program. Uden app ved porten ikke hvor det lander, saa det sker ikke.
  // En optagelse ad gangen - og det afgoeres FOER mennesket spoerges. At bede om
  // et ja til noget der alligevel ikke kan ske, er et spildt og forvirrende samtykke.
  if (name === 'computer_record' && args.action === 'start' && optagelse && !optagelse.slut) {
    const grund = `a recording is already running (${optagelse.sti})`;
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(), decision: 'denied', reason: grund });
    return errorResult(`Refused: ${grund}. Stop it first with action "stop".`);
  }
  // Et skaerm-id er et 32-bit tal fra computer_displays. -1 naaede hjaelperen og
  // crashede den - EFTER mennesket havde sagt ja (Fable 25/9).
  if (name === 'computer_record' && args.action === 'start' && args.displayId !== undefined
      && !(args.displayId >= 0 && args.displayId <= 0xFFFFFFFF)) {
    const grund = 'displayId is not a display id - take it from computer_displays';
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(), decision: 'denied', reason: grund });
    return errorResult(`Refused: ${grund}. Nothing was recorded.`);
  }

  if (name === 'computer_set_value' && !args.app && (args.role || args.title || args.contains)) {
    const grund = 'set_value with role/title/contains but no app searches every app, so the gate cannot know which app it would write in';
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(), decision: 'denied', reason: grund });
    return errorResult(`Refused: ${grund}. Name the app with \`app\` and call it again.`);
  }

  if (tool.tier !== TIER.READ && (erIkonet(args.app) || erIkonet(targetBundleId))) {
    const grund = 'the Computer MCP status icon can never be the target of an action';
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
             target: STATUS_IKON_ID, decision: 'denied', asked: false, reason: grund });
    return errorResult(`Refused: ${grund}. It is where the person watches the agents and answers them; an agent may not press anything in it.`);
  }

  // `computer_ask_user` viser selv en dialog til mennesket - den ER
  // samtykke-oejeblikket. Spurgte porten foerst, ville mennesket faa to
  // dialoger for ét spoergsmaal. Den er stadig WRITE-niveau, saa den er skjult
  // i readonly: en agent der ikke maa roere noget, skal heller ikke kunne
  // banke paa ruden.
  // ⛔ FUNDET AF PANELET 19/9: `computer_screenshot` er LAESENDE, og porten
  //    siger straks ja til laesning. Men `redact: false` er ikke en laesning af
  //    samme slags - det er en anmodning om et UFILTRERET billede af menneskets
  //    skaerm, og den beslutning er menneskets. Et produktloefte der beskytter
  //    brugeren MOD modellen, maa ikke kunne slaas fra AF modellen.
  //
  //    Den er stadig mulig - der findes legitime tilfaelde, og sitet beskriver
  //    dem - men den spoerger nu hver gang, i enhver tilstand.
  const usloeretBillede = name === 'computer_screenshot' && args.redact === false;
  // En optagelse er skaermen i minutter, til en fil (25/9). Start er skrivende og
  // spoerger hver gang; stop og status er laesende - at standse maa aldrig kraeve ja.
  const optagStart = name === 'computer_record' && args.action === 'start';
  const effektivTier = (usloeretBillede || optagStart) ? TIER.WRITE : tool.tier;
  // ⛔ M54 (25/9) viste det: optagelsen har intet program som maal, saa porten saa
  //    «ukendt maal» - og i baggrundstilstand (standard) kan et ukendt maal ALDRIG
  //    godkendes fra menulinjen. Optageren kunne altsaa ikke startes i standard-
  //    tilstanden, og det var «ukendt maal», ikke «spoerg hver gang», der spurgte.
  //    Maalet er skaermen; det navngives, saa reglen der baerer er den rigtige.
  if (optagStart) targetBundleId = 'computer-mcp.screen-recording';

  // ⛔ FUNDET AF RAADGIVEREN 19/9, og det var hullet der kunne faa bokse frem
  //    paa en maskine der koerer readonly. Kommentaren ovenfor sagde at
  //    vaerktoejet er "skjult i readonly" - men skjult er ikke afvist. Listen i
  //    linje 41 filtrerer, og kald-haandteringen slaar op paa NAVN. En klient
  //    med en cachet liste, en anden klient, eller en model der bare husker
  //    navnet, kunne kalde det og faa en dialog op paa menneskets skaerm i den
  //    ene tilstand hvor produktet lover at det ikke roerer noget.
  //
  //    Samme fejlklasse som produktets eget princip advarer imod: hovedspaerren
  //    maa ikke fejle aabent. Dommen falder nu paa TILSTAND, ikke paa synlighed,
  //    og den gaar gennem den samme afvisnings- og revisionsvej som alt andet.
  // ⛔ SLOEJFE-VAERNET. En agent der ikke kan se at den ikke kommer videre,
  //    goer det samme igen. Dokumenteret i vores eget hus: en agent klikkede
  //    det samme cookie-banner fire gange i traek. Paa en computer-server er
  //    prisen hoejere end spildt tid - hvert forsoeg er et RIGTIGT klik paa et
  //    rigtigt menneskes maskine.
  //
  //    ⚠️ Et vaern der fyrer paa lovlig gentagelse er VAERRE end intet vaern:
  //    saa laerer den der bygger ovenpaa at slaa det fra. Derfor:
  //      - kun skrivende handlinger taeller. En laesning gentaget er gratis.
  //      - rulning, tastetryk og skrivning er UNDTAGET. At rulle ti gange det
  //        samme stykke, eller trykke pil-ned tyve gange, er praecis hvad et
  //        menneske goer.
  //      - graensen er ti identiske kald inden for et minut. Ni er stadig en
  //        aabning; elleve er ikke laengere et forsoeg, det er en sloejfe.
  //    Den afviser ikke for evigt: den fortaeller hvad den saa, og beder om et
  //    skaermbillede - for det en fastlaast agent mangler, er at SE.
  // ⛔ BAGGRUNDS-TILSTANDEN. Foerste port, foer alt andet: kan handlingen tage
  //    skaermen, findes den ikke i denne tilstand. Den spoerger heller ikke -
  //    en dialog er ogsaa noget der tager skaermen, saa en skrivende handling
  //    afvises i ask og udfoeres kun i allow. At lade den gaa igennem tavst
  //    ville vaere et samtykke ingen har givet.
  // ⛔ RETTET 21/9: porten spurgte om vaerktoejets NAVN. Nu spoerger den om
  //    KALDET. `computer_type --app Slack` gaar i Slacks egen koe og roerer
  //    hverken markoer eller forgrund - den hoerer ikke til her.
  // ⛔ FUNDET AF ANDET MODSTANDER-REVIEW 21/9: den stille vej er kun stille
  //    hvis modtageren ikke er det program mennesket SIDDER i. Ellers lander
  //    teksten i hans felt, og han ser indholdet flytte sig. `took_screen`
  //    sagde det bagefter - men en etiket efter handlingen er ikke en port.
  //    README lover «Nothing ... types into the window you are using».
  // ⛔ UDVIDET 22/9, fundet af to rådgivere uafhængigt: porten gjaldt kun de
  //    fem i KAN_STILLES. `press`, `set_value` og `menu` er altid stille -
  //    tilgaengeligheds-handlinger, ingen markoer - saa de stod der ikke og
  //    gik derfor UDENOM. Men et `set_value` ind i det felt mennesket skriver
  //    i, overskriver det han skriver. Et `press` paa en knap i hans vindue
  //    trykker den under hans haender. At handlingen er stille for SKAERMEN
  //    goer den ikke stille for ham.
  //    `launch` er med vilje ikke her: at starte det aktive program er et
  //    no-op, ikke noget der lander under hans haender.
  const ROERER_I_PROGRAMMET = new Set(['computer_type', 'computer_key', 'computer_scroll',
    'computer_click', 'computer_press', 'computer_set_value', 'computer_menu']);
  if (baggrund() && ROERER_I_PROGRAMMET.has(name) && args.app
      && (!KAN_STILLES.has(name) || kaldErStille(name, args))) {
    const maal = await resolveApp(args.app);
    if (maal?.active) {
      const t0 = TOOL_BY_NAME.get(name);
      const grund0 = 'background mode: the named app is the one the person is using right now';
      record({ tool: name, tier: t0?.tier, args: scrubArgs(args), mode: currentMode(),
               target: maal.bundleId, decision: 'denied', reason: grund0 });
      noterVentende({ tool: name, describe: liveTekst(name, args), mode: currentMode(), reason: grund0 });
      return errorResult(
        `Refused: ${maal.name || args.app} is the window the person is working in right now, ` +
        `so delivering into its queue would put this straight under their hands.\n\n` +
        `Wait, or target a different app. computer_apps shows which one is active.`
      );
    }
  }

  // ⛔ SIKKERHEDSKONSULENTEN, runde 2 (22/9), Important: `set_value`, `press`
  //    og `menu` UDEN `app` rammer det forreste program - og i baggrunds-
  //    tilstand er det forreste program det mennesket bruger. Porten ovenfor
  //    kraevede `app`, saa de gik udenom; og et ja givet i menulinjen kunne
  //    lande i et andet program end det der blev vist, hvis han skiftede
  //    imens. Uden et navngivet program ved vi ikke hvor det lander FOER det
  //    lander. Saa det sker ikke.
  if (baggrund() && ROERER_I_PROGRAMMET.has(name) && !KAN_STILLES.has(name) && !args.app) {
    const grund0 = 'background mode: no app named, so it would land in the app the person is using';
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
             decision: 'denied', reason: grund0 });
    noterVentende({ tool: name, describe: liveTekst(name, args), mode: currentMode(), reason: grund0 });
    return errorResult(`Refused: ${name} without \`app\` acts on the app the person is using right now. Name the app, and it acts on that app's window behind theirs instead.`);
  }

  if (baggrund() && KAN_STILLES.has(name) && !kaldErStille(name, args)) {
    const t = TOOL_BY_NAME.get(name);
    // 1/10 (Astra): de tre launch-afvisninger i loggen sagde «no app named», men alle
    // havde et program - de manglede `background: true`. Grunden siger nu det rigtige.
    const grund = name === 'computer_launch'
      ? 'background mode: started without background: true, so it would bring the app to the front'
      : 'background mode: no app named, so it would go to the global input stream';
    record({ tool: name, tier: t?.tier, args: scrubArgs(args), mode: currentMode(),
             decision: 'denied', reason: grund });
    // ⛔ FANGET AF HUSETS EGEN VAGT (paastand 33), samme time som porten blev
    //    skrevet: afvisningen stod i loggen men IKKE i koeen. `computer_pending`
    //    er den ene vej en afvisning naar et menneske der ikke laeser
    //    samtalen. En afvisning der kun findes i loggen, er en afvisning
    //    ingen opdager.
    noterVentende({ tool: name, describe: liveTekst(name, args), mode: currentMode(), reason: grund });
    return errorResult(
      `Refused: ${name} without \`${MANGLER_FOR_STILLE[name]}\` takes the screen, ` +
      `so the person would see it happen.\n\n` +
      `Set \`${MANGLER_FOR_STILLE[name]}\` and call it again. ` +
      `The event then goes into that app's own queue: the pointer stays where ` +
      `the person left it, this call pulls nothing to the front, and it works on a window ` +
      `behind the one they are in.\n` +
      `Use computer_apps or computer_windows if you are unsure of the name.`
    );
  }

  if (baggrund() && tagerSkaermen(name, args)) {
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
             decision: 'denied', reason: 'background mode: this tool takes the screen' });
    noterVentende({ tool: name, describe: liveTekst(name, args), mode: currentMode(),
                    reason: 'background mode: this tool takes the screen' });
    return errorResult(
      `Refused: this server is running in background mode (CMCP_BACKGROUND), and ${name} would take over the screen.\n\n` +
      `The action was: ${describe(name, args)}\n` +
      `In background mode the server never moves the pointer, sends a key press, ` +
      `brings an app forward, switches desktop, or raises a dialog of its own.\n` +
      `If this step genuinely needs the screen, ask the person to lend it to you with ` +
      `computer_request_screen - they approve it in the menu bar, for a few minutes.\n` +
      `Otherwise use the quiet route: computer_find to locate the element, then ` +
      `computer_press or computer_set_value - they act on a window behind another ` +
      `one and leave the pointer where the person put it.`
    );
  }

  // ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9: her stod `tool.tier`, ikke
  //    `effektivTier`. Et usloeret skaermbillede er loeftet til skrivende
  //    netop fordi det er en anden slags handling - men sloejfe-vaernet saa
  //    stadig en laesning og taalte ikke med. Femti usloerede billeder i traek
  //    var dermed gratis.
  const sloejfe = sloejfeTjek(name, args, effektivTier);
  if (sloejfe) {
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
             decision: 'denied', reason: 'loop', repeats: sloejfe });
    return errorResult(
      `Refused: the same action has now been tried ${sloejfe} times in under a minute - counted across every agent on this machine, not just this chat.\n\n` +
      `The action was: ${describe(name, args)}\n` +
      `That usually means something else is in the way - a cookie banner, a dialog, ` +
      `a window that does not have focus - not that the click needs repeating.\n` +
      `Take a screenshot and look, or locate the element with computer_find, ` +
      `before trying again.`
    );
  }

  // ⛔ SENDE-PORTEN (29/9): en afsendelse i en beskedapp spoerger HVER gang,
  //    med modtager og tekst laest fra skaermen af serveren.
  const sende = effektivTier === TIER.READ ? null : await sendeDom(name, args, targetBundleId);
  if (sende?.afvis) {
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(), target: targetBundleId,
             decision: 'denied', asked: false, reason: `send port: ${sende.afvis}` });
    return errorResult(`Refused: ${sende.afvis}\n\nNothing was typed.`);
  }

  const menuFarlig = name === 'computer_menu' && effektivTier !== TIER.READ
    && (menuSerFarlig(args.path) || await menuGenvejErFarlig(args.app, args.path));
  const knapFarlig = (name === 'computer_press' || name === 'computer_click') && effektivTier !== TIER.READ
    && await knapErFarlig(name, args);

  const verdict = name === 'computer_ask_user'
    ? (currentMode() === 'readonly'
        ? { allow: false, asked: false,
            reason: 'read-only mode: computer_ask_user is a write tool' }
        : { allow: true, asked: true, reason: 'the tool does the asking itself' })
    : await decide({
        // ⛔ B5 (sikkerhedsgennemgang 24/9): her stod `liveTekst`, der skaerer
        //    menustien og knappens navn vaek - med vilje, for STATUSBOKSEN og KOEEN
        //    maa ikke vise mere end loggen. Men samtykket er en anden flade: det er
        //    den ene tekst mennesket skal LAESE for at sige ja. Dialogen for et farligt
        //    menupunkt sagde «read the path above, that is the part that is certain» -
        //    og der stod ingen sti. Man godkendte i blinde.
        //    `describe` viser stien og knappen, og laekker IKKE skrevet tekst
        //    («Type 11 characters»). Status og koe beholder den korte tekst.
        tier: effektivTier, targetBundleId, describe: sende?.describe || describe(name, args),
        ikon: { session: SESSION, client: server.getClientVersion?.()?.name || process.env.CMCP_CLIENT || null },
        aldrigViaIkonet: usloeretBillede,
        // Et menupunkt der ser ud til at slette noget, spoerger hver gang -
        // ogsaa i allow, som et farligt program.
        // At lukke et vindue kan tabe ugemt arbejde. Flytte og aendre kan ikke.
        // At starte et program kan intet tabe. At afslutte det kan. De to deler
        // derfor ikke port, selv om de ligner hinanden.
        alwaysAsk: menuFarlig || knapFarlig
                || (name === 'computer_key' && tastSerFarlig(args.combo))
               || (name === 'computer_window' && args.button === 'close')
               || name === 'computer_quit'
               // Et Space-skift flytter det mennesket KIGGER paa. Det er ikke
               // en handling i et program; det er en handling paa personen.
               // Samme regel som at afslutte et program: spoerg hver gang.
               || name === 'computer_space'
               || usloeretBillede
               || optagStart
               || !!sende,
        hvorfor: sende ? 'A message to a real person cannot be taken back. This yes covers this one message only.'
                       : hvorforSpoerg(name, args, { usloeretBillede, optagStart })
      });

  record({
    tool: name, tier: tool.tier, args: scrubArgs(args),
    target: targetBundleId, mode: currentMode(),
    // ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9. CMCP_OSASCRIPT giver ingen ny magt -
    //    den der kan saette den, kan ogsaa saette CMCP_MODE=allow - men de to
    //    LYVER ikke ens. `allow` skriver aerligt reason=CMCP_MODE=allow,
    //    asked=false. En omdirigeret spoerger der printer "button returned:Yes"
    //    giver asked=true, reason="the person said yes" i en fil hvis hele
    //    formaal er at kunne besvare hvad der skete. Ingen hemmelighed slipper
    //    ud; beviset bliver falsk. Saa staar det i linjen.
    ...(process.env.CMCP_OSASCRIPT && verdict.asker !== 'menubar' ? { asker: 'custom' } : {}),
    ...(verdict.asker === 'menubar' ? { asker: 'menubar' } : {}),
    decision: verdict.allow ? 'allowed' : 'denied', asked: verdict.asked, reason: verdict.reason
  });

  // ⛔ 24/9 (sikkerhedsgennemgangen): kunne linjen der TILLOD handlingen ikke
  //    skrives, udfoeres den ikke. Laesning koerer videre - den aendrer intet.
  if (verdict.allow && effektivTier !== TIER.READ && !loggenKanSkrives()) {
    return errorResult(`Refused: the audit log at ${AUDIT_PATH} cannot be written, and a write action that is not recorded does not happen. Nothing was sent to the Mac.`);
  }

  // ⛔ Sikkerhedskonsulenten 22/9, runde 2: mens serveren ventede paa mennesket,
  //    kan han have skiftet ind i netop det program. Et ja givet til «et vindue
  //    bag ved» maa ikke lande under hans haender.
  //    ⛔ RETTET samme aften af konsulenten: tjekket laa FOER programlaasen, og
  //    laasen kan vente op til et minut paa en anden agent. I det minut kunne
  //    mennesket naa at skifte ind i programmet, og tjekket var allerede koert.
  //    Nu koeres det INDE i laasen, umiddelbart foer handlingen udfoeres.
  const maalErStadigForsvarligt = async () => {
    // (Runde 1, Astra 4: «laanet sluttede mens kaldet ventede» haandhaeves nu af
    //  laanVedDom lige foer handlingen - én vagt for alle skrivende kald.)
    // ⛔ Sikkerhedsgennemgangen runde 2 (24/9): punktets ejer blev slaaet op
    //    FOER porten, foer spoergsmaalet og foer programlaasen - som kan vente
    //    et minut. Kom et andet vindue frem imens, landede klikket dér uden ny
    //    vurdering. Nu maales det igen, lige foer handlingen. Svarer opslaget
    //    ikke, eller ligger noget andet der, sker intet.
    // ⛔ Runde 3 (begge konsulenter): genmaalingen sprang over naar ejeren var
    //    UKENDT ved vurderingen - saa et ja til «vi ved ikke hvor det lander»
    //    klikkede uden at nogen bekraeftede hvad der nu laa under punktet.
    //    Nu maales der altid; var foer-maengden ukendt, skal nu-maengden vaere
    //    kendt og fri for adgangskode-programmer og terminaler.
    if (koordinatPunkter) {
      const nu = [];
      for (const [x, y] of koordinatPunkter) {
        const vedMarkoer = x === 'markoer';
        if (!vedMarkoer && (typeof x !== 'number' || typeof y !== 'number')) continue;
        let e = null;
        try { e = await callHelper(vedMarkoer ? ['at', '--pointer'] : ['at', '--x', String(x), '--y', String(y)], { timeout: 8000 }); } catch {}
        if (!(e?.found && e.bundleId)) return 'the window under that point could not be confirmed just before acting';
        for (const b of [e.bundleId, ...(Array.isArray(e.under) ? e.under : [])]) if (typeof b === 'string' && b && !nu.includes(b)) nu.push(b);
      }
      const somMaengde = (a) => [...new Set(a)].sort().join('|');
      if (!koordinatEjereFoer) {
        const farlig = nu.find(b => ALWAYS_ASK_APPS.has(b) || SPOERG_PR_SESSION.has(b));
        if (farlig) return `the window under that point was unknown when it was approved, and it is now ${farlig}`;
      } else if (somMaengde(nu) !== somMaengde(koordinatEjereFoer)) {
        return `the window under that point changed while the agent waited (was ${koordinatEjereFoer.join(', ')}, now ${nu.join(', ')})`;
      }
    }
    // ⛔ ASTRA 25/9 (Critical): tastatur-input UDEN app lander i det program
    //    der er forrest NAAR det sendes - men blev vurderet paa det der var
    //    forrest ved vurderingen. Skiftede mennesket til Passwords eller en
    //    terminal mens kaldet ventede (dialog, programlaas), fik den nye
    //    modtager input uden godkendelse, og loggen navngav det gamle program.
    if (!args.app && GLOBALT_INPUT.has(name)) {
      const nu = await frontmostBundleId();
      if (!nu || nu !== targetBundleId) {
        return `the app in front changed while the agent waited (was ${targetBundleId || 'unknown'}, now ${nu || 'unknown'}), so the keystrokes would land somewhere that was not approved`;
      }
    }
    // ⛔ Genkontrol under laasen (dommen 28/9, Astras krav): mellem ja'et og
    //    handlingen kan feltet eller samtalen have skiftet. Det mennesket
    //    godkendte skal vaere det der sendes - ellers sendes intet.
    // ⛔ Runde 1 (Astra 2): genkontrollen koerte kun naar den foerste dom var «send»
    //    - et klik der pegede paa Attach ved dommen og paa Send under laasen, gik
    //    igennem. Nu doemmes der ALTID igen hvor noget kan sende, og dommen skal
    //    vaere den samme: hvem, hvad og om det sender.
    if (beskedSlags(targetBundleId)) {
      const igen = await sendeDom(name, args, targetBundleId);
      if (JSON.stringify(igen ?? null) !== JSON.stringify(sende ?? null)) {
        return 'what would be sent changed after the person approved it - who it goes to or what it says - so it was not sent';
      }
    }
    // ⛔ B5 (29/9, panelet): med laant skaerm TAGER agenten ikke skaermen fra et
    //    menneske der bruger den. Input efter vores egen sidste handling er et
    //    menneske (vores egne tastetryk taeller ikke) - saa venter agenten.
    // ⛔ Runde 1 (Astra 5, Fable F2): gaelder ALLE skrivende kald under laanet -
    //    ogsaa de stille med `app`, der ellers kunne skrive i det felt mennesket
    //    sidder i. Og: vores egen sidste haendelse ligger FOER sidsteEgenHandling
    //    (hjaelperen maaler 120 ms efter), saa alt input nyere end den er ikke vores.
    if (laanAktivt()) {
      let m = null;
      try { m = await callHelper(['idle'], { timeout: 5000 }); } catch { m = null; }
      const idle = Number(m?.idle);
      if (!(idle >= 0)) return 'whether the person is using the machine could not be read just before acting';
      const sidenEgen = (Date.now() - sidsteEgenHandling) / 1000;
      // Hvor nyligt input taeller som «mennesket er her» (standard 1,5 s).
      // Kan kun HAEVES (runde 5, Fable 2): en knap der kan slaa menneske-vagten fra, er ingen vagt.
      const graense = Math.max(1.5, Number(process.env.CMCP_MENNESKE_SEK) || 0);
      if (idle < Math.min(graense, sidenEgen)) {
        return 'the person is using the keyboard or mouse right now, and the screen is theirs while they do. Wait a few seconds';
      }
    }
    if (!(verdict.allow && verdict.asker === 'menubar' && baggrund() && args.app
          && ROERER_I_PROGRAMMET.has(name))) return null;
    const nu = await resolveApp(args.app);
    if (nu && !nu.active && nu.bundleId === targetBundleId) return null;
    return nu?.active
      ? 'the person approved, but the app became the one they are using while they answered'
      : 'the person approved, but the target changed while they answered';
  };

  if (!verdict.allow) {
    // ⛔ Er den afvist fordi den ville KRAEVE et menneske - og ikke fordi den
    //    er forbudt - hoerer den i koeen. Ellers ved mennesket kun besked hvis
    //    det tilfaeldigvis laeser den rigtige chat.
    // ⛔ Rettet 22/9 (sikkerhedskonsulenten): afgjort af et FELT fra porten,
    //    ikke af et moenster paa grundens ordlyd. Et navn kan ikke baere en regel.
    if (verdict.koe) {
      noterVentende({ tool: name, describe: liveTekst(name, args), mode: currentMode(),
                      reason: verdict.reason });
    }
    return errorResult(
      `Refused: ${verdict.reason}\n\n` +
      `The action was: ${describe(name, args)}\n` +
      `Ask the person to approve it, or suggest another way. Do not simply try the same thing again.`
    );
  }

  try {
    // ⛔ Én agent ad gangen i hvert program (se programlaas.js): to servere
    //    der skrev samtidig i samme program, flettede teksten og tabte tegn.
    let result;
    // ⛔ ASTRA runde 2 (25/9): grenen spurgte `tool.tier` - et usloeret skaermbillede
    //    er et LAESENDE vaerktoej loeftet til skrivende, og det sprang derfor baade
    //    programlaasen og linjen foer handlingen over. Det er den effektive vaegt der taeller.
    if (effektivTier === TIER.READ) {
      result = await runTool(name, args);
    } else {
      let stopgrund = null;
      const laast = await medProgramLaas(targetBundleId || '_global', async () => {
        // ⛔ ASTRA 25/9: logvagten tjekkede FOER laasen, som kan vente et minut.
        //    Blev loggen uskrivbar imens, skete handlingen alligevel. Nu skrives
        //    en linje lige foer handlingen; kan den ikke skrives, sker intet.
        record({ tool: name, tier: effektivTier, target: targetBundleId, phase: 'executing' });
        if (!loggenKanSkrives()) {
          stopgrund = `the audit log at ${AUDIT_PATH} could not be written just before acting, and an action that is not recorded does not happen`;
          return null;
        }
        // ⛔ ASTRA runde 2: genmaalingen stod FOER loglinjen, og loglinjen kan vente
        //    op til tre sekunder paa sin laas. Nu er genmaalingen det sidste der sker
        //    foer handlingen - intet der kan vente, ligger imellem.
        stopgrund = await maalErStadigForsvarligt();
        if (stopgrund) return null;
        if (laanOejeblik() !== laanVedDom) {
          stopgrund = 'the screen loan changed while this waited (it began, ended or was taken back), so it was not done - call it again';
          return null;
        }
        // Runde 2 (Astra 5): kun handlinger der POSTER input flytter stemplet - efter et
        // tryk eller en menu (rene tilgaengeligheds-handlinger) er intet input vores.
        // Runde 3 (Astra 5): en skrivning via tilgaengeligheds-laget poster intet input.
        // Stemplet flyttes kun efter en handling der LYKKEDES og faktisk postede input.
        let res;
        try { res = await runTool(name, args); return res; }
        finally { if (res && !res.isError && POSTER_INPUT.has(name) && res.__postedeInput !== false) sidsteEgenHandling = Date.now(); }
      });
      if (stopgrund) {
        record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
                 target: targetBundleId, decision: 'denied', asked: verdict.asked,
                 ...(verdict.asker === 'menubar' ? { asker: 'menubar' } : {}), reason: stopgrund });
        return errorResult(`Refused: ${stopgrund}. Nothing was done. Call it again.`);
      }
      if (!laast.ok) {
        // laast.grund er sat naar laasen fejlede LUKKET paa en infra-fejl (M1);
        // ellers er det ventetiden der udloeb (en anden agent holdt laasen).
        const grund = laast.grund || `another agent is working in ${targetBundleId || 'the foreground app'} right now, and it did not finish within a minute`;
        record({ tool: name, outcome: 'refused', reason: grund });
        return errorResult(`Refused: ${grund}. Nothing was done. Try again shortly.`);
      }
      result = laast.vaerdi;
    }
    record({ tool: name, outcome: 'ok',
             ...(result?.__effekt ? { effect: result.__effekt } : {}),
             ...(result?.__tookScreen === undefined ? {} : { took_screen: result.__tookScreen }) });
    // Kunne UDFALDET ikke skrives, er handlingen sket og sporet mangler en linje.
    // Det kan ikke goeres om - men det maa ikke vaere tavst.
    if (effektivTier !== TIER.READ && !loggenKanSkrives() && Array.isArray(result?.content)) {
      result.content.push({ type: 'text', text: `Note: this action happened, but its outcome could not be written to the audit log at ${AUDIT_PATH}. Further write actions are refused until the log can be written.` });
    }
    return result;
  } catch (err) {
    // ⛔ MAALT 23/9: en `computer_window`-fejl skrev {outcome:"error"} i loggen
    //    mens vinduet MAALT var flyttet. Fejlede halvdelen, skal den anden
    //    halvdel staa der - ellers lover vi et helt spor og foerer et halvt.
    const halvt = (err instanceof HelperError && Array.isArray(err.extra?.did) && err.extra.did.length)
      ? { partial: err.extra.did } : {};
    // ⛔ Og feltet der siger om skaermen blev taget, maa ikke forsvinde paa
    //    fejl-vejen. Et halvt udfoert kald der TOG skaermen, ville ellers
    //    staa i loggen uden et ord om det - og det er den ene af de to ting
    //    loggen findes for at kunne svare paa.
    const skaerm = (err instanceof HelperError && typeof err.extra?.took_screen === 'boolean')
      ? { took_screen: err.extra.took_screen } : {};
    // ⛔ MAALT 26/9: hjaelperens fejl gentager det modellen skrev («the app '<x>' is
    //    not running»), og beskeden stod ordret i loggen - mens selve `app`-feltet
    //    var sloeret. Gentager beskeden modellens tekst, logges den som fingeraftryk;
    //    fejlkoden staar stadig i klartekst, saa loggen kan laeses.
    const besked = String(err.message);
    const modelTekst = [];
    const saml = (v, d = 0) => { if (d > 6) return; if (typeof v === 'string') { if (v.length >= 3) modelTekst.push(v); }
                                 else if (v && typeof v === 'object') for (const x of Object.values(v)) saml(x, d + 1); };
    saml(args);
    const ekko = modelTekst.some(v => besked.includes(v));
    record({ tool: name, outcome: 'error', error: err.code || 'unknown',
             message: ekko ? fingerprint(besked) : besked.slice(0, 300), ...halvt, ...skaerm });
    if (err instanceof HelperError && err.code === 'missing-accessibility') {
      return errorResult('Accessibility access is missing. System Settings > Privacy & Security > Accessibility - tick the app that runs the MCP server, then restart it. The permission belongs to that app, not to this tool.');
    }
    if (err instanceof HelperError && err.code === 'missing-screen-recording') {
      return errorResult('Screen Recording access is missing. System Settings > Privacy & Security > Screen & System Audio Recording - tick the app that runs the MCP server, then restart it. The permission belongs to that app, not to this tool.');
    }
    // ⛔ Og kandidaterne skal MED. Vaerktoejs-beskrivelsen lover at flere
    //    traeffere er "a refusal, not a guess: narrow the search" - men uden
    //    dem kan modellen ikke praecisere, kun gaette igen. Samme gaelder
    //    det element der blev afvist som sikkert felt: at vide HVILKET, er
    //    forskellen paa at kunne bede mennesket taste og at proeve forfra.
    const ekstra = (err instanceof HelperError && err.extra)
      ? '\n\n' + JSON.stringify(err.extra, null, 2).slice(0, 1200)
      : '';
    return errorResult(`Error (${err.code || 'unknown'}): ${err.message}${ekstra}`);
  }
}

// ⛔ Live-status til menulinje-ikonet, lagt RUNDT om hele haandteringen.
//    Kaldet har over tyve udgange (afvisninger, fejl, resultater); en status
//    skrevet ved hver af dem ville glemme en. Her kan ingen udgang slippe forbi.
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const navn = request.params.name;
  const a = request.params.arguments || {};
  const klient = server.getClientVersion?.()?.name;
  if (klient) statusKlient(klient);
  // D3 (2/10): raa app-streng videre til foelg-panelets "Show me where"-knap -
  // se status.js' statusHandling for hvorfor den IKKE sloeges op her.
  statusHandling(liveTekst(navn, a), 'running', typeof a.app === 'string' ? a.app : null);
  let svar;
  try {
    svar = await iKald(() => haandterKald(request));
  } catch (err) {
    statusFaerdig('error');
    throw err;
  }
  const foerste = String(svar?.content?.[0]?.text || '');
  statusFaerdig(!svar?.isError ? 'ok' : /^Refused/.test(foerste) ? 'refused' : 'error');
  return svar;
});

/// Den linje ikonet OG koeen viser.
///
/// ⛔ Konsulenten 22/9: `describe()` skriver modellens soegetekst ordret for
///    tryk og menuer - og `pending.jsonl` gemte den paa disken, mens
///    revisionsloggen fingeraftrykker netop de felter fordi de kan baere en
///    hemmelighed. To filer om samme handling, to forskellige regler.
///    Koeen bruger nu den samme sikre linje som boksen: hvad der skete, og i
///    hvilket program - aldrig hvad modellen ledte efter.
function liveTekst(navn, a) {
  const t = TOOL_BY_NAME.get(navn);
  // Et ukendt vaerktoejsnavn er modellens tekst (Astra 25/9).
  if (!t) return 'unknown tool';
  // ⛔ Sikkerhedskonsulenten 22/9: describe() viser modellens SOEGETEKST for
  //    tryk og menuer ordret. Revisionsloggen fingeraftrykker den; statusen
  //    maa ikke vise mere end loggen.
  if (navn === 'computer_press') return `Press an element${a.app ? ' in ' + a.app : ''}`;
  if (navn === 'computer_menu') return `Choose a menu item${a.app ? ' in ' + a.app : ''}`;
  // Optageren er et LAESE-vaerktoej paa papiret, men dens start er skaermen i minutter.
  // ⛔ Astra 25/9: `record ${a.action}` skrev modellens tekst ordret i statusfilen.
  if (navn === 'computer_record') return a.action === 'start' ? describe(navn, a)
    : (a.action === 'stop' || a.action === 'status') ? `record ${a.action}` : 'record';
  if (t && t.tier !== TIER.READ) return describe(navn, a);
  const kort = navn.replace(/^computer_/, '');
  return a.app ? `${kort} in ${a.app}` : kort;
}

const transport = new StdioServerTransport();
await server.connect(transport);
statusStart({ session: SESSION, client: process.env.CMCP_CLIENT, version: PKG.version });
// Doer chatten, doer serveren med. Stdin lukker normalt foerst - men en klient
// der bliver draebt, lukker ingenting, og serveren staar tilbage med
// tilgaengeligheds-rettigheder og taeller med i «hvor mange agenter koerer».
startVagt();
const ikon = startIkon(join(dirname(fileURLToPath(import.meta.url)), 'vendor'));
process.stderr.write(
  `[computer-mcp ${PKG.version}]${process.env.CMCP_OSASCRIPT ? ' asker=CUSTOM' : ''} mode=${currentMode()} background=${baggrund() ? 'on' : 'OFF - this server may take the screen'} helper=${helperPath() || 'MISSING'} log=${AUDIT_PATH} status-icon=${ikon}\n`
);
