// Chrome-sider gennem MCP-SERVEREN - den vej en chat gaar, ikke hjaelperen alene.
//
// ⛔ MAALT 5/11 kl. 06.44: alle chats' computer-mcp koerer index.js herfra, men CMCP_HELPER i
//    ~/.claude.json peger paa hovedmappens hjaelper (bygget 23/10, uden Chromes kontakt). Nattens
//    «bevis gennem MCP-vaerktoejet» var den gamle hjaelper, der laeste en side som mine direkte kald
//    med den nye havde taendt. Et bevis gennem vaerktoejet skal derfor starte sin EGEN server med
//    netop den hjaelper der skal udrulles - og maale paa et Chrome-vindue ingen andre har roert.
//
//    1. serverens foerste find paa en ubygget side svarer tree_building (feltet naar frem til klienten)
//    2. siden ses gennem serveren
//    3. computer_set_value skriver i tekstfeltet, verified
//    4. computer_set_value paa kodefeltet naegtes (secure-field)
//
// Koeres bevidst: `node test/chrome-mcp-live.mjs`. Hjaelperen: CMCP_HELPER, ellers vendor/cmcp-helper.
// Roerer hverken mus eller tastatur. Aabner et lille Chrome-vindue med en engangs-profil.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = process.env.CMCP_HELPER || join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) { console.log('UMAALT  Google Chrome er ikke installeret her'); process.exit(0); }
{
  const io = execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' });
  if (/CGSSessionScreenIsLocked"?\s*=\s*(Yes|true|1)/.test(io)) { console.log('UMAALT  skaermen er laast - Chrome bygger ingen sider imens'); process.exit(0); }
}

let fejl = 0;
const check = (navn, ok, hvorfor) => { console.log(`${ok ? 'OK  ' : 'DUMP'} ${navn}${ok ? '' : ' - ' + hvorfor}`); if (!ok) fejl++; };
const vent = (ms) => new Promise((r) => setTimeout(r, ms));
// Et entydigt maerke pr. koersel: et vindue fra en tidligere koersel kan ikke give et svar.
const M = `CMCPSRV${Date.now().toString(36).toUpperCase()}`;

const mappe = mkdtempSync(join(tmpdir(), 'cmcp-chrome-mcp-'));
const side = join(mappe, 'side.html');
writeFileSync(side, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${M}-TITEL</title></head>
<body style="font:16px system-ui;padding:24px"><h1>${M}</h1>
<textarea rows="4" cols="40" aria-label="${M}-FELT">gammel</textarea>
<p><input type="password" aria-label="${M}-KODE" value="hemmelig"></p></body></html>`);
const chrome = spawn(CHROME, [`--user-data-dir=${join(mappe, 'profil')}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-session-crashed-bubble', '--window-position=60,90', '--window-size=720,520',
  `file://${side}`], { stdio: 'ignore', detached: true });
const state = mkdtempSync(join(tmpdir(), 'cmcp-chrome-mcp-state-'));

const { Client } = await import(join(ROOT, 'mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'index.js'));
const { StdioClientTransport } = await import(join(ROOT, 'mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'stdio.js'));
const env = { ...process.env, CMCP_HELPER: H, CMCP_STATE_DIR: state, CMCP_STATUS_IKON: '0', CMCP_MODE: 'allow', CMCP_SCREEN_ASK: '0' };
delete env.CMCP_BACKGROUND;
const tr = new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'mcp-server', 'index.js')], env, stderr: 'ignore' });
const kl = new Client({ name: 'chrome-mcp-live', version: '1' });
const ryd = () => { try { process.kill(-chrome.pid); } catch {} try { chrome.kill('SIGKILL'); } catch {}
  for (const m of [mappe, state]) { try { rmSync(m, { recursive: true, force: true }); } catch {} } };
process.on('exit', ryd);

// Svaret som klienten ser det: teksten i foerste indholdsblok, som JSON hvis den er det.
const kald = async (name, args) => {
  const r = await kl.callTool({ name, arguments: args });
  const tekst = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let json = null; try { json = JSON.parse(tekst); } catch { const m = tekst.match(/\{[\s\S]*\}/); if (m) { try { json = JSON.parse(m[0]); } catch {} } }
  return { fejl: !!r.isError, tekst, json };
};

try {
  // Vent paa vinduet UDEN at taende traeet (CMCP_INGEN_ELECTRON), saa serverens kald er det foerste.
  let set = false;
  for (let i = 0; i < 40 && !set; i++) {
    await vent(250);
    set = JSON.parse(execFileSync(H, ['find', '--app', 'com.google.Chrome', '--contains', `${M}-TITEL`, '--depth', '6'],
      { encoding: 'utf8', env: { ...process.env, CMCP_INGEN_ELECTRON: '1' } })).count > 0;
  }
  check('0. test-vinduet er aabnet', set, 'Chrome viste ikke vinduet paa 10 s');
  await kl.connect(tr);

  const f1 = await kald('computer_find', { app: 'com.google.Chrome', contains: `${M}-FELT`, depth: 60 });
  check('1. serverens foerste find paa den ubyggede side svarer tree_building',
        f1.json?.count === 0 && f1.json?.tree_building === true, f1.tekst.slice(0, 200));

  let f2 = { json: { count: 0 } };
  for (let i = 0; i < 60 && !f2.json?.count; i++) { await vent(500); f2 = await kald('computer_find', { app: 'com.google.Chrome', contains: `${M}-FELT`, depth: 60 }); }
  check('2. siden ses gennem serveren', f2.json?.count > 0 && f2.json.matches.some((m) => m.role === 'AXTextArea'), f2.tekst.slice(0, 200));

  // ⛔ MAALT 5/11 kl. 06.47: arbejder personen i SIT Chrome, venter serverens vagt 40 s og skriver intet -
  //    vagten skelner paa program-id, og test-vinduet er ogsaa com.google.Chrome. Det er produktets
  //    adfaerd, ikke en fejl: proeven siger UMAALT for skrivningen, ikke DUMPET.
  const venter = (r) => /^Waiting:/.test(r.tekst);
  const s3 = await kald('computer_set_value', { app: 'com.google.Chrome', contains: `${M}-FELT`, role: 'AXTextArea', text: 'skrevet gennem serveren' });
  if (venter(s3)) console.log('UMAALT 3. skrivning gennem serveren - personen arbejder i Chrome, vagten venter (som den skal)');
  else check('3. computer_set_value skriver i tekstfeltet, verified', !s3.fejl && /verified/.test(s3.tekst), s3.tekst.slice(0, 200));

  const s4 = venter(s3) ? s3 : await kald('computer_set_value', { app: 'com.google.Chrome', contains: `${M}-KODE`, subrole: 'AXSecureTextField', text: 'maa-aldrig-lande' });
  if (venter(s4)) console.log('UMAALT 4. afslag paa kodefeltet gennem serveren - samme grund');
  else check('4. computer_set_value paa kodefeltet naegtes', s4.fejl && /secure/i.test(s4.tekst), s4.tekst.slice(0, 200));
} finally {
  try { await kl.close(); } catch {}
  ryd();
}
console.log(fejl ? `\n${fejl} DUMPET` : '\nBESTAAET');
process.exit(fejl ? 1 : 0);
