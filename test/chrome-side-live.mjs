// Chrome-sider gennem den SENDTE hjaelper - adfaerd, ikke tekst.
//
// ⛔ REVIEW 5/11-2026 (Opus): claims-offline 8b-8e tjekker at strengene STAAR i kilden. Syv af
//    otte meningsfulde mutationer forblev groenne - ogsaa «porten svaerter intet» og «kontakten
//    saettes aldrig». En proeve der ikke kan blive roed af det den hedder, beviser ingenting.
//    Denne kalder hjaelperen mod en rigtig Chrome og maaler det der skal vaere sandt:
//
//    1. kaldet der TAENDER Chromes trae, svarer tree_building (ikke et stumt 0)
//    2. mens siden bygges, svaertes HELE vinduet (fail-closed) - kodefeltet kan ikke ses endnu
//    3. naar siden er bygget, ses den: tekstfeltet findes
//    4. og saa svaertes KUN kodefeltet, ikke hele vinduet
//    5. skrivning i tekstfeltet bekraeftes, laest tilbage
//    6. skrivning i kodefeltet naegtes (secure-field)
//
// Koeres bevidst: `node test/chrome-side-live.mjs`. Den roerer hverken mus eller tastatur, men den
// aabner et lille Chrome-vindue med en engangs-profil i et par sekunder, og hjaelperen taender
// Chromes trae ogsaa i dit eget Chrome (det er produktets adfaerd). Uden Google Chrome: UMAALT.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = process.env.CMCP_HELPER || join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) { console.log('UMAALT  Google Chrome er ikke installeret her'); process.exit(0); }
// ⛔ MAALT 5/11 kl. 02.09: mens Mac'en er LAAST, bygger Chrome ikke siders tilgaengeligheds-trae.
//    Et maaleprogram uden hjaelperen fandt 0 web-omraader efter 25,6 s paa en frisk Chrome (laast),
//    mod 2,1 s kl. 01.20 (ulaast). Proeven maaler da laasen, ikke koden - saa den siger UMAALT.
{
  const io = execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' });
  if (/CGSSessionScreenIsLocked"?\s*=\s*(Yes|true|1)/.test(io)) { console.log('UMAALT  skaermen er laast - Chrome bygger ingen sider imens'); process.exit(0); }
}

let fejl = 0;
const check = (navn, ok, hvorfor) => { console.log(`${ok ? 'OK  ' : 'DUMP'} ${navn}${ok ? '' : ' - ' + hvorfor}`); if (!ok) fejl++; };
const hj = (args, stdin) => JSON.parse(execFileSync(H, args, { input: stdin, encoding: 'utf8', timeout: 60000 }));
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

const mappe = mkdtempSync(join(tmpdir(), 'cmcp-chrome-'));
const side = join(mappe, 'side.html');
writeFileSync(side, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CMCP-LIVE</title></head>
<body style="font:16px system-ui;padding:24px"><h1>CMCPLIVEOVERSKRIFT</h1>
<textarea rows="4" cols="40" aria-label="CMCPLIVEFELT">gammel</textarea>
<p><input type="password" aria-label="CMCPLIVEKODE" value="hemmelig"></p></body></html>`);
// Vinduets plads og stoerrelse er kendte, saa svarene kan holdes op mod netop det vindue -
// hjaelperen ser ogsaa personens eget Chrome.
const V = { x: 40, y: 80, w: 760, h: 560 };
const chrome = spawn(CHROME, [`--user-data-dir=${join(mappe, 'profil')}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-session-crashed-bubble', `--window-position=${V.x},${V.y}`, `--window-size=${V.w},${V.h}`,
  `file://${side}`], { stdio: 'ignore', detached: true });
const ryd = () => { try { process.kill(-chrome.pid); } catch {} try { chrome.kill('SIGKILL'); } catch {} try { rmSync(mappe, { recursive: true, force: true }); } catch {} };
process.on('exit', ryd);

const iVinduet = (r) => r.x >= V.x - 4 && r.y >= V.y - 4 && r.x + r.w <= V.x + V.w + 4 && r.y + r.h <= V.y + V.h + 4;
const heleVinduet = (r) => Math.abs(r.w - V.w) <= 8 && Math.abs(r.h - V.h) <= 8;

try {
  // Vent til vinduet findes for Chromes egen brugerflade (titlen), FOER traeet roeres.
  let set = false;
  for (let i = 0; i < 40 && !set; i++) { await vent(250); set = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCP-LIVE', '--depth', '6']).count > 0; }
  check('0. test-vinduet er aabnet', set, 'Chrome viste ikke vinduet paa 10 s');

  // 1. Det kald der taender traeet, ser ikke siden endnu - og skal sige hvorfor.
  const f1 = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCPLIVEFELT', '--depth', '60']);
  check('1. det taendende kald svarer tree_building, ikke et stumt 0',
        f1.count === 0 && f1.tree_building === true, JSON.stringify(f1).slice(0, 160));

  // 2. Lige efter: traeet bygges stadig - hele vinduet svaertes.
  const r2 = hj(['secure-rects', '--app', 'com.google.Chrome']).rects.filter(iVinduet);
  check('2. mens siden bygges, svaertes HELE test-vinduet', r2.some(heleVinduet),
        `ingen hele-vindue-rektangel i ${JSON.stringify(r2)}`);

  // 3. Siden kommer.
  let f3 = { count: 0 };
  for (let i = 0; i < 60 && !f3.count; i++) { await vent(500); f3 = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCPLIVEFELT', '--depth', '60']); }
  check('3. siden ses: tekstfeltet findes', f3.count > 0 && f3.matches.some((m) => m.role === 'AXTextArea'), 'ikke fundet paa 30 s');

  // 4. Nu svaertes kodefeltet - og IKKE hele vinduet.
  const r4 = hj(['secure-rects', '--app', 'com.google.Chrome']).rects.filter(iVinduet);
  check('4. kun kodefeltet svaertes, ikke hele vinduet',
        r4.length >= 1 && !r4.some(heleVinduet) && r4.some((r) => r.w < 400 && r.h < 60), JSON.stringify(r4));

  // 5. Skrivning bekraeftes og laeses tilbage.
  const s5 = hj(['set-value', '--match-stdin', '--app', 'com.google.Chrome', '--role', 'AXTextArea'],
                JSON.stringify({ contains: 'CMCPLIVEFELT', text: 'skrevet af proeven' }));
  const tilbage = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCPLIVEFELT', '--role', 'AXTextArea', '--depth', '60']);
  check('5. skrivning i tekstfeltet er verified og laest tilbage',
        s5.ok === true && s5.verified === true && JSON.stringify(tilbage.matches?.[0]?.names || []).includes('skrevet af proeven'),
        JSON.stringify(s5).slice(0, 160));

  // 6. Kodefeltet naegtes.
  let s6;
  try { s6 = hj(['set-value', '--match-stdin', '--app', 'com.google.Chrome', '--subrole', 'AXSecureTextField'],
                JSON.stringify({ contains: 'CMCPLIVEKODE', text: 'maa-aldrig-lande' })); }
  catch (e) { s6 = JSON.parse(e.stdout || '{}'); }
  check('6. skrivning i kodefeltet naegtes', s6.ok === false && s6.code === 'secure-field', JSON.stringify(s6).slice(0, 160));
} finally {
  ryd();
}
console.log(fejl ? `\n${fejl} DUMPET` : '\nBESTAAET');
process.exit(fejl ? 1 : 0);
