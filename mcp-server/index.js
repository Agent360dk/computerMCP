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
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

import { TOOLS, TOOL_BY_NAME, describe } from './tools.js';
import { TIER, decide, currentMode, askHumanToDo, menuSerFarlig, baggrund, TAGER_SKAERMEN } from './policy.js';
import { callHelper, HelperError, helperPath, frontmostBundleId, resolveBundleId } from './helper.js';
import { record, scrubArgs, AUDIT_PATH, noterVentende, ventende, KOE_PATH } from './audit.js';

const PKG = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'));

/// Taeller identiske skrivende kald. Se noten ved kaldstedet for hvorfor
/// graenserne ser ud som de goer.
const SLOEJFE_GRAENSE = 10;
const SLOEJFE_VINDUE_MS = 60_000;
const SLOEJFE_FRI = new Set(['computer_scroll', 'computer_key', 'computer_type']);
const sloejfeSpor = new Map();

function sloejfeTjek(name, args, tier) {
  if (tier === TIER.READ) return null;
  if (SLOEJFE_FRI.has(name)) return null;
  const noegle = name + '|' + JSON.stringify(args ?? {});
  const nu = Date.now();
  const tider = (sloejfeSpor.get(noegle) || []).filter(t => nu - t < SLOEJFE_VINDUE_MS);
  tider.push(nu);
  sloejfeSpor.set(noegle, tider);
  // Ryd op, saa en lang koersel ikke samler paa noegler i det uendelige.
  if (sloejfeSpor.size > 200) {
    for (const [k, v] of sloejfeSpor) {
      if (!v.length || nu - v[v.length - 1] > SLOEJFE_VINDUE_MS) sloejfeSpor.delete(k);
    }
  }
  return tider.length > SLOEJFE_GRAENSE ? tider.length : null;
}

const server = new Server(
  { name: 'computer-mcp', version: PKG.version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  // I readonly-tilstand vises de skrivende vaerktoejer slet ikke. En model der
  // kan se et vaerktoej, proever det - og et afslag pr. kald er stoej for
  // brugeren. Er tilstanden readonly, findes haenderne ikke.
  tools: TOOLS
    .filter(t => currentMode() !== 'readonly' || t.tier === TIER.READ)
    // I baggrunds-tilstand tilbydes de slet ikke. En model der faar et
    // vaerktoej den altid vil faa nej til, bruger sine forsoeg paa det.
    .filter(t => !baggrund() || !TAGER_SKAERMEN.has(t.name))
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}));

function textResult(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}
function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function runTool(name, args) {
  switch (name) {
    case 'computer_permissions': {
      const r = await callHelper(['permissions']);
      return textResult({
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
      const a = ['inspect'];
      if (args.app) a.push('--app', String(args.app));
      a.push('--depth', String(args.depth ?? 12), '--limit', String(args.limit ?? 400));
      return textResult(await callHelper(a));
    }
    case 'computer_pending': {
      const liste = ventende(args.limit ?? 20);
      if (!liste.length) return textResult('Nothing is waiting for a human.');
      return textResult({
        path: KOE_PATH, waiting: liste.length, entries: liste,
        note: 'This is a list, not a button. To allow any of it, the person changes CMCP_MODE or sets CMCP_BACKGROUND=0 - nothing here can be approved from here.'
      });
    }
    case 'computer_audit': {
      const limit = args.limit ?? 40;
      if (!existsSync(AUDIT_PATH)) return textResult('The audit log is empty - nothing has been done yet.');
      const lines = readFileSync(AUDIT_PATH, 'utf8').trim().split('\n').filter(Boolean);
      return textResult({ path: AUDIT_PATH, total: lines.length, entries: lines.slice(-limit).map(l => JSON.parse(l)) });
    }
    case 'computer_launch':
      return textResult(await callHelper(['launch', '--app', String(args.app)]));
    case 'computer_quit':
      return textResult(await callHelper(['quit', '--app', String(args.app)]));
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
        return textResult(await callHelper(['window-button', ...base, '--button', String(args.button)]));
      }
      const a = ['window-set', ...base];
      for (const [k, f] of [['x','--x'],['y','--y'],['width','--width'],['height','--height']]) {
        if (Number.isInteger(args[k])) a.push(f, String(args[k]));
      }
      return textResult(await callHelper(a));
    }
    case 'computer_menus': {
      const a = ['menus', '--app', String(args.app)];
      if (Number.isInteger(args.depth)) a.push('--depth', String(args.depth));
      return textResult(await callHelper(a));
    }
    case 'computer_menu':
      return textResult(await callHelper(
        ['menu-click', '--app', String(args.app), '--path', String(args.path)]));
    case 'computer_displays':
      return textResult(await callHelper(['displays']));
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
      if (args.first) a.push('--first');
      // Teksten OG soegningen i én blok: de kan ikke hver laese stdin.
      const soeg = {};
      if (args.title) soeg.title = String(args.title);
      if (args.contains) soeg.contains = String(args.contains);
      soeg.text = String(args.text);
      const r = await callHelper(a, { stdin: JSON.stringify(soeg) });
      return textResult(r);
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
      const a = ['press', '--match-stdin', '--app', String(args.app)];
      if (args.role) a.push('--role', String(args.role));
      if (args.first) a.push('--first');
      const soeg = {};
      if (args.title) soeg.title = String(args.title);
      if (args.contains) soeg.contains = String(args.contains);
      const r = await callHelper(a, { stdin: JSON.stringify(soeg) });
      return textResult(r);
    }
    case 'computer_ask_user': {
      // ⛔ SERVEREN skriver hvor det lander, ikke modellen. En
      //    prompt-indsproejtning kan formulere `message` - den kan ikke
      //    formulere denne linje.
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
    case 'computer_click':
      await callHelper(['click', '--x', String(args.x), '--y', String(args.y),
        '--button', String(args.button || 'left'), '--count', String(args.count || 1)]);
      return textResult(`Clicked at ${Math.round(args.x)}, ${Math.round(args.y)}.`);
    case 'computer_move':
      await callHelper(['move', '--x', String(args.x), '--y', String(args.y)]);
      return textResult('The pointer moved.');
    case 'computer_scroll':
      await callHelper(['scroll', '--dx', String(args.dx || 0), '--dy', String(args.dy || 0)]);
      return textResult('Rullede.');
    case 'computer_type':
      // ⛔ Teksten gaar paa STDIN, aldrig som argument. Vi lovede det paa
      //    tools-siden ("never as a command-line argument, because ps is
      //    readable by every process on the machine") - og gjorde det ikke.
      //    Hjaelperen har haft --stdin siden 18/9; JS-siden brugte den aldrig.
      //    Det var altsaa et udgivet loefte der var usandt i den udgivne kode.
      await callHelper(['type', '--stdin', '--cps', String(args.cps || 240)],
        { timeout: Math.max(30000, String(args.text).length * 60), stdin: String(args.text) });
      return textResult(`Typed ${String(args.text).length} characters.`);
    case 'computer_key':
      await callHelper(['key', '--combo', String(args.combo)]);
      return textResult(`Pressed ${args.combo}.`);
    case 'computer_activate':
      await callHelper(['activate', '--app', String(args.app)]);
      return textResult(`Skiftede til ${args.app}.`);
    default:
      throw new HelperError(`unknown tool: ${name}`, 'unknown-tool');
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return errorResult(`Unknown tool: ${name}`);

  // Hvilket program rammer handlingen? For computer_activate er det det
  // program der skiftes TIL, og for computer_press det program elementet
  // ligger i - ellers det der er forrest og altsaa modtager
  // klikket eller tastetrykket.
  let targetBundleId = null;
  if (tool.tier !== TIER.READ || (name === 'computer_screenshot' && args.redact === false)) {
    targetBundleId = (name === 'computer_activate' || name === 'computer_press'
                      || name === 'computer_menu' || name === 'computer_window'
                      || name === 'computer_launch' || name === 'computer_quit')
      ? await resolveBundleId(args.app)
      : await frontmostBundleId();
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
  const effektivTier = usloeretBillede ? TIER.WRITE : tool.tier;

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
  if (baggrund() && TAGER_SKAERMEN.has(name)) {
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
             decision: 'denied', reason: 'background mode: this tool takes the screen' });
    noterVentende({ tool: name, describe: describe(name, args), mode: currentMode(),
                    reason: 'background mode: this tool takes the screen' });
    return errorResult(
      `Refused: this server runs in the background by default, and ${name} would take over the screen.\n\n` +
      `The action was: ${describe(name, args)}\n` +
      `In background mode the server never moves the pointer, sends a key press, ` +
      `brings an app forward, switches desktop, or raises a dialog of its own.\n` +
      `If the person genuinely needs this tool, they can set CMCP_BACKGROUND=0 - ` +
      `but ask them first, and say why.\n` +
      `Otherwise use the quiet route: computer_find to locate the element, then ` +
      `computer_press or computer_set_value - they act on a window behind another ` +
      `one and leave the pointer where the person put it.`
    );
  }

  const sloejfe = sloejfeTjek(name, args, tool.tier);
  if (sloejfe) {
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
             decision: 'denied', reason: 'loop', repeats: sloejfe });
    return errorResult(
      `Refused: the same action has now been tried ${sloejfe} times in under a minute.\n\n` +
      `The action was: ${describe(name, args)}\n` +
      `That usually means something else is in the way - a cookie banner, a dialog, ` +
      `a window that does not have focus - not that the click needs repeating.\n` +
      `Take a screenshot and look, or locate the element with computer_find, ` +
      `before trying again.`
    );
  }

  const verdict = name === 'computer_ask_user'
    ? (currentMode() === 'readonly'
        ? { allow: false, asked: false,
            reason: 'read-only mode: computer_ask_user is a write tool' }
        : { allow: true, asked: true, reason: 'the tool does the asking itself' })
    : await decide({
        tier: effektivTier, targetBundleId, describe: describe(name, args),
        // Et menupunkt der ser ud til at slette noget, spoerger hver gang -
        // ogsaa i allow, som et farligt program.
        // At lukke et vindue kan tabe ugemt arbejde. Flytte og aendre kan ikke.
        // At starte et program kan intet tabe. At afslutte det kan. De to deler
        // derfor ikke port, selv om de ligner hinanden.
        alwaysAsk: (name === 'computer_menu' && menuSerFarlig(args.path))
               || (name === 'computer_window' && args.button === 'close')
               || name === 'computer_quit'
               // Et Space-skift flytter det mennesket KIGGER paa. Det er ikke
               // en handling i et program; det er en handling paa personen.
               // Samme regel som at afslutte et program: spoerg hver gang.
               || name === 'computer_space'
               || usloeretBillede
      });

  record({
    tool: name, tier: tool.tier, args: scrubArgs(args),
    target: targetBundleId, mode: currentMode(),
    decision: verdict.allow ? 'allowed' : 'denied', asked: verdict.asked, reason: verdict.reason
  });

  if (!verdict.allow) {
    // ⛔ Er den afvist fordi den ville KRAEVE et menneske - og ikke fordi den
    //    er forbudt - hoerer den i koeen. Ellers ved mennesket kun besked hvis
    //    det tilfaeldigvis laeser den rigtige chat.
    if (/would need a dialog|takes the screen/.test(String(verdict.reason || ''))) {
      noterVentende({ tool: name, describe: describe(name, args), mode: currentMode(),
                      reason: verdict.reason });
    }
    return errorResult(
      `Refused: ${verdict.reason}\n\n` +
      `The action was: ${describe(name, args)}\n` +
      `Ask the person to approve it, or suggest another way. Do not simply try the same thing again.`
    );
  }

  try {
    const result = await runTool(name, args);
    record({ tool: name, outcome: 'ok' });
    return result;
  } catch (err) {
    record({ tool: name, outcome: 'error', error: err.code || 'unknown', message: String(err.message).slice(0, 300) });
    if (err instanceof HelperError && err.code === 'missing-accessibility') {
      return errorResult('Accessibility access is missing. System Settings > Privacy & Security > Accessibility - tick the app that runs the MCP server, then restart it. The permission belongs to that app, not to this tool.');
    }
    if (err instanceof HelperError && err.code === 'missing-screen-recording') {
      return errorResult('Screen Recording access is missing. System Settings > Privacy & Security > Screen & System Audio Recording - tick the app that runs the MCP server, then restart it. The permission belongs to that app, not to this tool.');
    }
    return errorResult(`Fejl (${err.code || 'ukendt'}): ${err.message}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(
  `[computer-mcp ${PKG.version}] mode=${currentMode()} background=${baggrund() ? 'on' : 'OFF - this server may take the screen'} helper=${helperPath() || 'MISSING'} log=${AUDIT_PATH}\n`
);
