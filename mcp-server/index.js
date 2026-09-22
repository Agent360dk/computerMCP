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
import { TIER, decide, currentMode, askHumanToDo, menuSerFarlig, tastSerFarlig, baggrund, TAGER_SKAERMEN, KAN_STILLES, MANGLER_FOR_STILLE, kaldErStille, tagerSkaermen } from './policy.js';
import { callHelper, HelperError, helperPath, frontmostBundleId, resolveBundleId, resolveApp } from './helper.js';
import { record, scrubArgs, AUDIT_PATH, noterVentende, ventende, KOE_PATH, kaedenHolder, SESSION } from './audit.js';
import { statusStart, statusHandling, statusFaerdig, statusKlient, startIkon, STATUS_IKON_ID } from './status.js';

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
    linjer.push(`${rolle}${n.secure ? ' [secure]' : ''}: ${String(t).replace(/\s+/g, ' ').trim()}`);
  }
  const hoved = `${noder[0]?.app || 'app'} - ${linjer.length} elements with text, out of ${noder.length} read.`;
  let krop = linjer.join('\n');
  const iAlt = krop.length;
  let hale = '';
  if (iAlt > TEKST_LOFT) {
    krop = krop.slice(0, TEKST_LOFT);
    hale = `\n\n[cut: ${TEKST_LOFT} of ${iAlt} characters. Narrow it with computer_find, or ask for format: 'json' with a lower limit.]`;
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

/// Taeller identiske skrivende kald. Se noten ved kaldstedet for hvorfor
/// graenserne ser ud som de goer.
const SLOEJFE_GRAENSE = 10;
const SLOEJFE_VINDUE_MS = 60_000;
const SLOEJFE_FRI = new Set(['computer_scroll', 'computer_key', 'computer_type']);
const sloejfeSpor = new Map();

function sloejfeTjek(name, args, tier) {
  if (tier === TIER.READ) return null;
  // ⛔ `computer_key` er fri for sloejfe-vaernet fordi pil-ned tyve gange er
  //    legitimt. `cmd+delete` tyve gange er det ikke.
  if (SLOEJFE_FRI.has(name) && !(name === 'computer_key' && tastSerFarlig(args?.combo))) return null;
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
        note: 'This is a list, not a button. To allow any of it, the person changes CMCP_MODE or sets CMCP_BACKGROUND=0 - nothing here can be approved from here.'
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
        chain: k.aegte
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
      return medSkaerm(textResult(sendt + stilleNote(args.app, r)), r);
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
      return medSkaerm(textResult(`Typed ${String(args.text).length} characters.` + stilleNote(args.app, r)), r);
    case 'computer_key': {
      const r = await callHelper(['key', '--combo', String(args.combo),
        ...(args.app ? ['--app', String(args.app)] : [])]);
      return medSkaerm(textResult(`Pressed ${args.combo}.` + stilleNote(args.app, r)), r);
    }
    case 'computer_activate':
      await callHelper(['activate', '--app', String(args.app)]);
      return textResult(`Skiftede til ${args.app}.`);
    default:
      throw new HelperError(`unknown tool: ${name}`, 'unknown-tool');
  }
}

async function haandterKald(request) {
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
    // ⛔ RETTET 21/9. Hvis kaldet NAVNGIVER et program, er det programmet
    //    der rammes - ikke det der tilfaeldigvis er forrest. Foer i dag
    //    spurgte porten «hvad er forrest?» ogsaa for de fire nye stille kald,
    //    saa `computer_type --app "Keychain Access"` ville blive vurderet paa
    //    menneskets forreste vindue. Adgangskode-porten er hele produktets
    //    kerne; den maa ikke kigge det forkerte sted.
    targetBundleId = args.app
      ? await resolveBundleId(args.app)
      : await frontmostBundleId();
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
  const erIkonet = (v) => !!v && (String(v) === STATUS_IKON_ID || String(v).toLowerCase() === 'computer mcp');
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
      noterVentende({ tool: name, describe: describe(name, args), mode: currentMode(), reason: grund0 });
      return errorResult(
        `Refused: ${maal.name || args.app} is the window the person is working in right now, ` +
        `so delivering into its queue would put this straight under their hands.\n\n` +
        `Wait, or target a different app. computer_apps shows which one is active.`
      );
    }
  }

  if (baggrund() && KAN_STILLES.has(name) && !kaldErStille(name, args)) {
    const t = TOOL_BY_NAME.get(name);
    const grund = 'background mode: no app named, so it would go to the global input stream';
    record({ tool: name, tier: t?.tier, args: scrubArgs(args), mode: currentMode(),
             decision: 'denied', reason: grund });
    // ⛔ FANGET AF HUSETS EGEN VAGT (paastand 33), samme time som porten blev
    //    skrevet: afvisningen stod i loggen men IKKE i koeen. `computer_pending`
    //    er den ene vej en afvisning naar et menneske der ikke laeser
    //    samtalen. En afvisning der kun findes i loggen, er en afvisning
    //    ingen opdager.
    noterVentende({ tool: name, describe: describe(name, args), mode: currentMode(), reason: grund });
    return errorResult(
      `Refused: ${name} without \`${MANGLER_FOR_STILLE[name]}\` takes the screen, ` +
      `so the person would see it happen.\n\n` +
      `Set \`${MANGLER_FOR_STILLE[name]}\` and call it again. ` +
      `The event then goes into that app's own queue: the pointer stays where ` +
      `the person left it, nothing comes to the front, and it works on a window ` +
      `behind the one they are in.\n` +
      `Use computer_apps or computer_windows if you are unsure of the name.`
    );
  }

  if (baggrund() && tagerSkaermen(name, args)) {
    record({ tool: name, tier: tool.tier, args: scrubArgs(args), mode: currentMode(),
             decision: 'denied', reason: 'background mode: this tool takes the screen' });
    noterVentende({ tool: name, describe: describe(name, args), mode: currentMode(),
                    reason: 'background mode: this tool takes the screen' });
    return errorResult(
      `Refused: this server is running in background mode (CMCP_BACKGROUND), and ${name} would take over the screen.\n\n` +
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
                || (name === 'computer_key' && tastSerFarlig(args.combo))
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
    // ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9. CMCP_OSASCRIPT giver ingen ny magt -
    //    den der kan saette den, kan ogsaa saette CMCP_MODE=allow - men de to
    //    LYVER ikke ens. `allow` skriver aerligt reason=CMCP_MODE=allow,
    //    asked=false. En omdirigeret spoerger der printer "button returned:Yes"
    //    giver asked=true, reason="the person said yes" i en fil hvis hele
    //    formaal er at kunne besvare hvad der skete. Ingen hemmelighed slipper
    //    ud; beviset bliver falsk. Saa staar det i linjen.
    ...(process.env.CMCP_OSASCRIPT ? { asker: 'custom' } : {}),
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
    record({ tool: name, outcome: 'ok',
             ...(result?.__tookScreen === undefined ? {} : { took_screen: result.__tookScreen }) });
    return result;
  } catch (err) {
    record({ tool: name, outcome: 'error', error: err.code || 'unknown', message: String(err.message).slice(0, 300) });
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
  statusHandling(liveTekst(navn, a), 'running');
  let svar;
  try {
    svar = await haandterKald(request);
  } catch (err) {
    statusFaerdig('error');
    throw err;
  }
  const foerste = String(svar?.content?.[0]?.text || '');
  statusFaerdig(!svar?.isError ? 'ok' : /^Refused/.test(foerste) ? 'refused' : 'error');
  return svar;
});

/// Den linje ikonet viser. Skrivende handlinger bruger describe(), som aldrig
/// indeholder indhold. Laesninger navngiver kun programmet - aldrig soegeteksten,
/// som kan vaere praecis det agenten leder efter i et felt.
function liveTekst(navn, a) {
  const t = TOOL_BY_NAME.get(navn);
  // ⛔ Sikkerhedskonsulenten 22/9: describe() viser modellens SOEGETEKST for
  //    tryk og menuer ordret. Revisionsloggen fingeraftrykker den; statusen
  //    maa ikke vise mere end loggen.
  if (navn === 'computer_press') return `Press an element${a.app ? ' in ' + a.app : ''}`;
  if (navn === 'computer_menu') return `Choose a menu item${a.app ? ' in ' + a.app : ''}`;
  if (t && t.tier !== TIER.READ) return describe(navn, a);
  const kort = navn.replace(/^computer_/, '');
  return a.app ? `${kort} in ${a.app}` : kort;
}

const transport = new StdioServerTransport();
await server.connect(transport);
statusStart({ session: SESSION, client: process.env.CMCP_CLIENT, version: PKG.version });
const ikon = startIkon(join(dirname(fileURLToPath(import.meta.url)), 'vendor'));
process.stderr.write(
  `[computer-mcp ${PKG.version}]${process.env.CMCP_OSASCRIPT ? ' asker=CUSTOM' : ''} mode=${currentMode()} background=${baggrund() ? 'on' : 'OFF - this server may take the screen'} helper=${helperPath() || 'MISSING'} log=${AUDIT_PATH} status-icon=${ikon}\n`
);
