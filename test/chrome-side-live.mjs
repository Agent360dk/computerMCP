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
import { execFileSync } from 'node:child_process';
import { startChrome, inaktivSek, MIN_INAKTIV, slutDom } from './chrome-start.mjs';
const START_MS = Date.now();
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = process.env.CMCP_HELPER || join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) { console.log('SPRUNGET OVER: 8 (Google Chrome er ikke installeret her) - bevist intet, ikke bestaaet'); process.exit(0); }
// ⛔ MAALT 5/11 kl. 02.09: mens Mac'en er LAAST, bygger Chrome ikke siders tilgaengeligheds-trae.
//    Et maaleprogram uden hjaelperen fandt 0 web-omraader efter 25,6 s paa en frisk Chrome (laast),
//    mod 2,1 s kl. 01.20 (ulaast). Proeven maaler da laasen, ikke koden - saa den siger UMAALT.
{
  const io = execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' });
  if (/CGSSessionScreenIsLocked"?\s*=\s*(Yes|true|1)/.test(io)) { console.log('SPRUNGET OVER: 8 (skaermen er laast - Chrome bygger ingen sider imens) - bevist intet, ikke bestaaet'); process.exit(0); }
}
// ⛔ MAALT 5/11 08.21: Chrome henter sig selv frem trods `open -g`. Kun naar personen ikke arbejder.
if (inaktivSek() < MIN_INAKTIV) { console.log(`SPRUNGET OVER: 8 (personen arbejder lige nu - inaktiv ${Math.round(inaktivSek())} s; en ny Chrome henter sig selv frem foran dem) - bevist intet, ikke bestaaet`); process.exit(0); }

let fejl = 0;
const check = (navn, ok, hvorfor) => { console.log(`${ok ? 'OK  ' : 'DUMP'} ${navn}${ok ? '' : ' - ' + hvorfor}`); if (!ok) fejl++; };
const hj = (args, stdin, env) => JSON.parse(execFileSync(H, args, { input: stdin, encoding: 'utf8', timeout: 60000, env: env ? { ...process.env, ...env } : process.env }));
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

const mappe = mkdtempSync(join(tmpdir(), 'cmcp-chrome-'));
const side = join(mappe, 'side.html');
writeFileSync(side, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CMCP-LIVE</title></head>
<body style="font:16px system-ui;padding:24px"><h1>CMCPLIVEOVERSKRIFT</h1>
<textarea rows="4" cols="40" aria-label="CMCPLIVEFELT">gammel</textarea>
<p><input type="password" aria-label="CMCPLIVEKODE" value="hemmelig"></p></body></html>`);
// ⛔ 5/11 09.11-09.58: trin 2b aabnede et tomt popup fra denne side. MAALT: popuppen tog fokus, og Chrome byggede
//    ALDRIG hovedvinduets side (trin 3-4 roede i alle koersler; groenne naar popuppen blev fjernet). Det tomme
//    vindue har nu sin egen proeve med ét vindue (chrome-tom-side-live.mjs).
// Vinduets plads og stoerrelse er kendte, saa svarene kan holdes op mod netop det vindue -
// hjaelperen ser ogsaa personens eget Chrome.
const V = { x: 40, y: 80, w: 760, h: 560 };
// Startes i BAGGRUNDEN (open -g): en direkte start hentede Chrome frem foran personen (5/11).
const chrome = await startChrome([`--user-data-dir=${join(mappe, 'profil')}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-session-crashed-bubble', `--window-position=${V.x},${V.y}`, `--window-size=${V.w},${V.h}`,
  `file://${side}`]);
const ryd = () => { chrome.stop(); try { rmSync(mappe, { recursive: true, force: true }); } catch {} };
process.on('exit', ryd);

const iVinduet = (r) => r.x >= V.x - 4 && r.y >= V.y - 4 && r.x + r.w <= V.x + V.w + 4 && r.y + r.h <= V.y + V.h + 4;
const heleVinduet = (r) => Math.abs(r.w - V.w) <= 8 && Math.abs(r.h - V.h) <= 8;

try {
  // Vent til vinduet findes for Chromes egen brugerflade (titlen), FOER traeet roeres.
  // ⛔ MAALT 5/11 kl. 06.35: uden CMCP_INGEN_ELECTRON taendte VENTE-kaldet selv traeet. Ulaast og med
  //    lav belastning naaede Chrome at bygge siden, foer trin 1 koerte, saa trin 1-2 var roede, mens
  //    koden opfoerte sig rigtigt. Proeven maalte et kapløb, ikke det foerste kald.
  let set = false;
  for (let i = 0; i < 40 && !set; i++) { await vent(250); set = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCP-LIVE', '--depth', '6'], undefined, { CMCP_INGEN_ELECTRON: '1' }).count > 0; }
  check('0. test-vinduet er aabnet', set, 'Chrome viste ikke vinduet paa 10 s');
  // 5/11: maalt MENS proevevinduet er aabent (efter lukning ville fokus vende tilbage og skjule det).
  //    Paa processen (ASN), ikke navnet - personens Chrome og proevens hedder begge «Google Chrome».
  // 0b (oplysning, ikke et tjek): MAALT 5/11 - Chrome tager forreste plads trods open -g; derfor inaktivitetsvagten.
  console.log(`     forreste proces foer/efter start: ${chrome.forrestFoer} / ${chrome.forrestEfter()} (${chrome.forrestNavn()})`);

  // 1. Det kald der taender traeet, ser ikke siden endnu - og skal sige hvorfor.
  const f1 = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCPLIVEFELT', '--depth', '60']);
  check('1. det taendende kald svarer tree_building, ikke et stumt 0',
        f1.count === 0 && f1.tree_building === true, JSON.stringify(f1).slice(0, 160));

  // 2. Lige efter: traeet bygges stadig - hele vinduet svaertes.
  const r2 = hj(['secure-rects', '--app', 'com.google.Chrome']).rects.filter(iVinduet);
  const alleredeBygget = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCPLIVEFELT', '--depth', '60']).count > 0;
  if (alleredeBygget && !r2.some(heleVinduet)) {
    console.log('     2. (oplysning) siden var allerede bygget ved andet kald - kun kodefeltet svaertet, som det skal; trin 2b er det faste bevis');
  } else {
    check('2. mens siden bygges, svaertes HELE test-vinduet', r2.some(heleVinduet), `ingen hele-vindue-rektangel i ${JSON.stringify(r2)}`);
  }

  // 3. Siden kommer.
  let f3 = { count: 0 };
  for (let i = 0; i < 60 && !f3.count; i++) { await vent(500); f3 = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCPLIVEFELT', '--depth', '60']); }
  check('3. siden ses: tekstfeltet findes', f3.count > 0 && f3.matches.some((m) => m.role === 'AXTextArea'), 'ikke fundet paa 30 s');

  // 4. Nu svaertes kodefeltet - og IKKE hele vinduet.
  const r4 = hj(['secure-rects', '--app', 'com.google.Chrome']).rects.filter(iVinduet);
  check('4. kun kodefeltet svaertes, ikke hele vinduet',
        r4.length >= 1 && !r4.some(heleVinduet) && r4.some((r) => r.w < 400 && r.h < 60), JSON.stringify(r4));

  // 5. Skrivning bekraeftes og laeses tilbage.
  // R7 (Opus O1, MAALT): fejlede set-value (exit 1), kastede kaldet, og proeven gik ned uden slutlinje - et roedt
  // resultat saa ud som et nedbrud. Nu svarer et afslag som et DUMP med hjaelperens grund, ligesom trin 6.
  let s5, tilbage = {};
  try { s5 = hj(['set-value', '--match-stdin', '--app', 'com.google.Chrome', '--role', 'AXTextArea'],
                JSON.stringify({ contains: 'CMCPLIVEFELT', text: 'skrevet af proeven' })); }
  catch (e) { try { s5 = JSON.parse(e.stdout || '{}'); } catch { s5 = { ok: false, error: String(e).slice(0, 120) }; } }
  try { tilbage = hj(['find', '--app', 'com.google.Chrome', '--contains', 'CMCPLIVEFELT', '--role', 'AXTextArea', '--depth', '60']); }
  catch (e) { try { tilbage = JSON.parse(e.stdout || '{}'); } catch { tilbage = {}; } }
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
  check('Z. proevens Chrome er lukket igen', chrome.stop(), 'den lever stadig - naeste proeve ville maale dens vinduer');
  ryd();
}
process.exit(slutDom(fejl, 8, START_MS));
