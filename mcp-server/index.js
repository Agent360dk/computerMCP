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
import { TIER, decide, currentMode, askHumanToDo, menuSerFarlig } from './policy.js';
import { callHelper, HelperError, helperPath, frontmostBundleId, resolveBundleId } from './helper.js';
import { record, scrubArgs, AUDIT_PATH } from './audit.js';

const PKG = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'));

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
        hint: (r.accessibility && r.screenRecording)
          ? 'Alt er givet.'
          : 'Mangler adgang: Systemindstillinger > Anonymitet og sikkerhed > Tilgaengelighed og Skaermoptagelse. Giv adgang til det program der koerer MCP-serveren.'
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
    case 'computer_audit': {
      const limit = args.limit ?? 40;
      if (!existsSync(AUDIT_PATH)) return textResult('Revisionsloggen er tom - der er ikke udfoert noget endnu.');
      const lines = readFileSync(AUDIT_PATH, 'utf8').trim().split('\n').filter(Boolean);
      return textResult({ path: AUDIT_PATH, total: lines.length, entries: lines.slice(-limit).map(l => JSON.parse(l)) });
    }
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
              `${r.width}x${r.height} px. Skaermen er ${r.screenWidthPoints}x${r.screenHeightPoints} punkter, ` +
              `dvs. ${r.pixelsPerPoint} pixel pr. punkt. ` +
              `computer_click regner i PUNKTER: del en koordinat fra dette billede med ${r.pixelsPerPoint}` +
              // ⛔ MAALT 19/9: skaermene laa paa (-3840,27), (-1920,27) og (0,0).
              //    Et klik regnet uden origo fra skaerm 0's billede rammer 1920 punkter
              //    ved siden af - paa en anden monitor. Hintet skal baere origo, ellers
              //    er det et raad der sender agenten det forkerte sted hen.
              ((r.displayOriginX || r.displayOriginY)
                ? ` og laeg saa (${r.displayOriginX}, ${r.displayOriginY}) til - denne skaerm begynder der paa skrivebordet. `
                : ' foer du klikker. ') +
              `${r.redacted ? `Sloeret (${r.redactedRegions} omraader)` : 'IKKE sloeret'}. Omfang: ${r.scope}.` +
              // Kun naar der ER flere. En maskine med een skaerm skal ikke laese om et problem
              // den ikke har - men paa en maskine med tre var to af dem usynlige uden et ord.
              (r.displays > 1
                ? ` Maskinen har ${r.displays} skaerme; dette er id ${r.displayId}.`
                  + ` Leder du efter et vindue du ikke kan se, ligger det sandsynligvis paa en anden:`
                  + ` kald computer_displays og giv displayId med.`
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
      const a = ['find'];
      if (args.app) a.push('--app', String(args.app));
      if (args.role) a.push('--role', String(args.role));
      if (args.title) a.push('--title', String(args.title));
      if (args.contains) a.push('--contains', String(args.contains));
      a.push('--depth', String(args.depth ?? 24), '--limit', String(args.limit ?? 25));
      return textResult(await callHelper(a));
    }
    case 'computer_focused':
      return textResult(await callHelper(['focused']));
    case 'computer_set_value': {
      const a = ['set-value', '--stdin'];
      if (args.app) a.push('--app', String(args.app));
      if (args.role) a.push('--role', String(args.role));
      if (args.title) a.push('--title', String(args.title));
      if (args.contains) a.push('--contains', String(args.contains));
      if (args.first) a.push('--first');
      // Teksten paa stdin, aldrig som argument - samme grund som computer_type.
      const r = await callHelper(a, { stdin: String(args.text) });
      return textResult(r);
    }
    case 'computer_wait_for': {
      const a = ['wait-for'];
      if (args.app) a.push('--app', String(args.app));
      if (args.role) a.push('--role', String(args.role));
      if (args.title) a.push('--title', String(args.title));
      if (args.contains) a.push('--contains', String(args.contains));
      const secs = Number(args.timeout) > 0 ? Number(args.timeout) : 15;
      a.push('--timeout', String(secs));
      if (args.poll) a.push('--poll', String(args.poll));
      // Hjaelperen skal have lov at vente hele tiden ud plus luft til ét opslag.
      return textResult(await callHelper(a, { timeout: (secs + 20) * 1000 }));
    }
    case 'computer_press': {
      const a = ['press', '--app', String(args.app)];
      if (args.role) a.push('--role', String(args.role));
      if (args.title) a.push('--title', String(args.title));
      if (args.contains) a.push('--contains', String(args.contains));
      if (args.first) a.push('--first');
      const r = await callHelper(a);
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
        hvor = bid ? (titel ? `${bid} - vinduet "${String(titel).slice(0, 70)}"` : bid) : null;
      } catch { hvor = null; }
      const gjort = await askHumanToDo(String(args.message), hvor);
      // Kun en boolean. Aldrig tekst.
      return textResult(gjort
        ? { done: true, hvor, note: 'Mennesket siger det er gjort. Vi har ikke set hvad der blev tastet, og det staar ikke i loggen.' }
        : { done: false, cancelled: true, hvor, note: 'Mennesket annullerede eller svarede ikke. Proev ikke igen med den samme bon.' });
    }
    case 'computer_click':
      await callHelper(['click', '--x', String(args.x), '--y', String(args.y),
        '--button', String(args.button || 'left'), '--count', String(args.count || 1)]);
      return textResult(`Klikkede i ${Math.round(args.x)}, ${Math.round(args.y)}.`);
    case 'computer_move':
      await callHelper(['move', '--x', String(args.x), '--y', String(args.y)]);
      return textResult('Musen er flyttet.');
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
      return textResult(`Skrev ${String(args.text).length} tegn.`);
    case 'computer_key':
      await callHelper(['key', '--combo', String(args.combo)]);
      return textResult(`Trykkede ${args.combo}.`);
    case 'computer_activate':
      await callHelper(['activate', '--app', String(args.app)]);
      return textResult(`Skiftede til ${args.app}.`);
    default:
      throw new HelperError(`ukendt vaerktoej: ${name}`, 'unknown-tool');
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) return errorResult(`Ukendt vaerktoej: ${name}`);

  // Hvilket program rammer handlingen? For computer_activate er det det
  // program der skiftes TIL, og for computer_press det program elementet
  // ligger i - ellers det der er forrest og altsaa modtager
  // klikket eller tastetrykket.
  let targetBundleId = null;
  if (tool.tier !== TIER.READ) {
    targetBundleId = (name === 'computer_activate' || name === 'computer_press'
                      || name === 'computer_menu' || name === 'computer_window')
      ? await resolveBundleId(args.app)
      : await frontmostBundleId();
  }

  // `computer_ask_user` viser selv en dialog til mennesket - den ER
  // samtykke-oejeblikket. Spurgte porten foerst, ville mennesket faa to
  // dialoger for ét spoergsmaal. Den er stadig WRITE-niveau, saa den er skjult
  // i readonly: en agent der ikke maa roere noget, skal heller ikke kunne
  // banke paa ruden.
  const verdict = name === 'computer_ask_user'
    ? { allow: true, asked: true, reason: 'vaerktoejet spoerger selv' }
    : await decide({
        tier: tool.tier, targetBundleId, describe: describe(name, args),
        // Et menupunkt der ser ud til at slette noget, spoerger hver gang -
        // ogsaa i allow, som et farligt program.
        // At lukke et vindue kan tabe ugemt arbejde. Flytte og aendre kan ikke.
        alwaysAsk: (name === 'computer_menu' && menuSerFarlig(args.path))
               || (name === 'computer_window' && args.button === 'close')
      });

  record({
    tool: name, tier: tool.tier, args: scrubArgs(args),
    target: targetBundleId, mode: currentMode(),
    decision: verdict.allow ? 'allowed' : 'denied', asked: verdict.asked, reason: verdict.reason
  });

  if (!verdict.allow) {
    return errorResult(
      `Afvist: ${verdict.reason}\n\n` +
      `Handlingen var: ${describe(name, args)}\n` +
      `Bed mennesket om at godkende, eller foreslaa en anden vej. Proev ikke det samme igen.`
    );
  }

  try {
    const result = await runTool(name, args);
    record({ tool: name, outcome: 'ok' });
    return result;
  } catch (err) {
    record({ tool: name, outcome: 'error', error: err.code || 'unknown', message: String(err.message).slice(0, 300) });
    if (err instanceof HelperError && err.code === 'missing-accessibility') {
      return errorResult('Tilgaengeligheds-adgang mangler. Systemindstillinger > Anonymitet og sikkerhed > Tilgaengelighed - saet flueben ved det program der koerer MCP-serveren, og start den igen.');
    }
    if (err instanceof HelperError && err.code === 'missing-screen-recording') {
      return errorResult('Skaermoptagelses-adgang mangler. Systemindstillinger > Anonymitet og sikkerhed > Skaermoptagelse - saet flueben ved det program der koerer MCP-serveren, og start den igen.');
    }
    return errorResult(`Fejl (${err.code || 'ukendt'}): ${err.message}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(
  `[computer-mcp ${PKG.version}] tilstand=${currentMode()} hjaelper=${helperPath() || 'MANGLER'} log=${AUDIT_PATH}\n`
);
