// Et kodefelt DYBERE end sloeringens gennemgang naar (dybde 40 fra vinduet) maa ikke slippe igennem.
//
// ⛔ REVIEW 5/11-2026 (Opus, F5): gennemgangen stopper i dybde 40, og siden starter i dybde 8. Et felt
//    dybere nede blev hverken fundet eller fik vinduet svaertet. Gustavs rigtige sider gaar til dybde 16
//    (maalt), saa reglen rammer ikke hans daglige brug - men en tungt indlejret side kan gaa dybere.
//    Denne side har 45 indlejrede grupper med kodefeltet i bunden. Forventet: hele vinduet svaertes.
//
// (Resten af opstillingen er den samme som chrome-side-live.mjs.)
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
if (!existsSync(CHROME)) { console.log('SPRUNGET OVER: 4 (Google Chrome er ikke installeret her) - bevist intet, ikke bestaaet'); process.exit(0); }
// ⛔ MAALT 5/11 kl. 02.09: mens Mac'en er LAAST, bygger Chrome ikke siders tilgaengeligheds-trae.
//    Et maaleprogram uden hjaelperen fandt 0 web-omraader efter 25,6 s paa en frisk Chrome (laast),
//    mod 2,1 s kl. 01.20 (ulaast). Proeven maaler da laasen, ikke koden - saa den siger UMAALT.
{
  const io = execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' });
  if (/CGSSessionScreenIsLocked"?\s*=\s*(Yes|true|1)/.test(io)) { console.log('SPRUNGET OVER: 4 (skaermen er laast - Chrome bygger ingen sider imens) - bevist intet, ikke bestaaet'); process.exit(0); }
}

let fejl = 0;
const check = (navn, ok, hvorfor) => { console.log(`${ok ? 'OK  ' : 'DUMP'} ${navn}${ok ? '' : ' - ' + hvorfor}`); if (!ok) fejl++; };
const hj = (args, stdin) => JSON.parse(execFileSync(H, args, { input: stdin, encoding: 'utf8', timeout: 60000 }));
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

const mappe = mkdtempSync(join(tmpdir(), 'cmcp-chrome-'));
const side = join(mappe, 'side.html');
writeFileSync(side, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CMCP-LIVE</title></head>
<body style="font:16px system-ui;padding:24px"><h1>CMCPLIVEOVERSKRIFT</h1>
<textarea rows="2" cols="40" aria-label="CMCPLIVEFELT">gammel</textarea>
${'<div role="group" aria-label="lag">'.repeat(45)}<input type="password" aria-label="CMCPLIVEKODE" value="hemmelig">${'</div>'.repeat(45)}
</body></html>`);
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

  // Vent til siden er bygget (tekstfeltet ses), saa svaret ikke handler om opbygningen.
  let f = { count: 0 };
  for (let i = 0; i < 60 && !f.count; i++) { await vent(500); f = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCPLIVEFELT', '--depth', '60']); }
  check('1. siden er bygget (tekstfeltet ses)', f.count > 0, 'ikke fundet paa 30 s');
  const dyb = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCPLIVEKODE', '--depth', '80']);
  // ⛔ R2 (Astra): «fundet med 80» beviste ikke at feltet ligger DYBERE end 40. Nu begge sider af loftet.
  const flad = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCPLIVEKODE', '--depth', '40']);
  check('2. kodefeltet ligger dybere end sloeringens 40 (ikke fundet med 40, fundet med 80)', dyb.count > 0 && flad.count === 0,
        `dybde 40: ${flad.count}, dybde 80: ${dyb.count}`);
  const sr = hj(['secure-rects', '--app', 'com.google.Chrome']);
  const r = sr.rects.filter(iVinduet);
  // ⛔ R2 (Astra): et hele-vindue-rektangel kan have en ANDEN grund. Kraev dybde-grunden.
  check('3. et felt sloeringen ikke naar, svaerter HELE vinduet - af netop den grund',
        r.some(heleVinduet) && (sr.whole_window || []).some((g) => /deeper than the scan reaches/.test(g)),
        `rekt ${JSON.stringify(r)} grunde ${JSON.stringify(sr.whole_window)}`);
} finally {
  ryd();
}
console.log(fejl ? `\n${fejl} DUMPET` : '\nBESTAAET');
process.exit(fejl ? 1 : 0);
