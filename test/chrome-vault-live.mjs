// Vault-porten: en adgangskode-side INDE i Chrome laeses ikke som tekst og svaertes helt.
//
// Gustav 5/11: «kør e2e også password programmer i chrome». Chromes egen kodeordsside (chrome://password-manager)
// er en aegte vault-side - i en engangs-profil er den tom, men den har et soegefelt og knapper.
//
//    1. naar siden er bygget, svaertes HELE vinduet - af grunden «password manager page»
//    2. find giver INTET tekstfelt fra siden, og svaret siger at en adgangskode-side blev sprunget over
//    3. inspect afleverer kun en «denied»-markering for siden
//
// Koeres bevidst: `node test/chrome-vault-live.mjs`. Roerer hverken mus eller tastatur; kun naar personen er inaktiv.
import { execFileSync } from 'node:child_process';
import { startChrome, inaktivSek, MIN_INAKTIV } from './chrome-start.mjs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = process.env.CMCP_HELPER || join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
const N = 5;
if (!existsSync('/Applications/Google Chrome.app')) { console.log(`SPRUNGET OVER: ${N} (Google Chrome er ikke installeret her) - bevist intet, ikke bestaaet`); process.exit(0); }
{
  const io = execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' });
  if (/CGSSessionScreenIsLocked"?\s*=\s*(Yes|true|1)/.test(io)) { console.log(`SPRUNGET OVER: ${N} (skaermen er laast - Chrome bygger ingen sider imens) - bevist intet, ikke bestaaet`); process.exit(0); }
}
if (inaktivSek() < MIN_INAKTIV) { console.log(`SPRUNGET OVER: ${N} (personen arbejder lige nu - inaktiv ${Math.round(inaktivSek())} s; en ny Chrome henter sig selv frem foran dem) - bevist intet, ikke bestaaet`); process.exit(0); }

let fejl = 0;
const check = (navn, ok, hvorfor) => { console.log(`${ok ? 'OK  ' : 'DUMP'} ${navn}${ok ? '' : ' - ' + hvorfor}`); if (!ok) fejl++; };
const hj = (args, env) => JSON.parse(execFileSync(H, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env }));
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

const V = { x: 120, y: 110, w: 820, h: 600 };
const iV = (r) => r.x >= V.x - 4 && r.y >= V.y - 4 && r.x + r.w <= V.x + V.w + 4 && r.y + r.h <= V.y + V.h + 4;
const heleV = (r) => Math.abs(r.w - V.w) <= 8 && Math.abs(r.h - V.h) <= 8;
// Sidens omraade: under fanelinje og vaerktoejslinje.
const iSiden = (f) => f && f.x >= V.x && f.x + f.w <= V.x + V.w + 4 && f.y >= V.y + 90 && f.y + f.h <= V.y + V.h + 4;

// ⛔ find/inspect uden soegeord ser OGSAA personens egne Chrome-vinduer. Et geometri-filter alene ville
//    taelle deres felter med (falsk roedt) og skrive deres navne i bevisfilen. Derfor et oejebliksbillede
//    FOER proevens Chrome starter, og kun FORSKELLEN maales. Intet fra personens vinduer udskrives.
const noegle = (x) => `${x.role}|${x.name || x.title || ''}|${x.value || ''}|${JSON.stringify(x.frame || {})}`;
const findFelter = () => (hj(['find', '--app', 'com.google.Chrome', '--role', 'AXTextField', '--depth', '60', '--limit', '400']).matches || []);
const inspektion = () => hj(['inspect', '--app', 'com.google.Chrome', '--depth', '14', '--limit', '4000']).nodes || [];
const foerFind = new Set(findFelter().map(noegle));
const foerIns = new Set(inspektion().map(noegle));

const mappe = mkdtempSync(join(tmpdir(), 'cmcp-chrome-vault-'));
const chrome = await startChrome([`--user-data-dir=${join(mappe, 'profil')}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-session-crashed-bubble', `--window-position=${V.x},${V.y}`, `--window-size=${V.w},${V.h}`,
  'chrome://password-manager/passwords']);
const ryd = () => { chrome.stop(); try { rmSync(mappe, { recursive: true, force: true }); } catch {} };
process.on('exit', ryd);

try {
  // Vent paa vinduet (dets ramme, Chromes egen brugerflade) UDEN at taende traeet.
  let set = false;
  for (let i = 0; i < 40 && !set; i++) {
    await vent(250);
    const w = hj(['find', '--app', 'com.google.Chrome', '--role', 'AXWindow', '--depth', '2'], { CMCP_INGEN_ELECTRON: '1' });
    set = (w.matches || []).some((m) => m.frame && heleV(m.frame) && iV(m.frame));
  }
  check('0. test-vinduet med kodeordssiden er aabnet', set, 'intet vindue med den ramme paa 10 s');

  // 1. Naar siden er bygget: hele vinduet ud, af vault-grunden.
  let sr = { rects: [], whole_window: [] };
  for (let i = 0; i < 60; i++) {
    sr = hj(['secure-rects', '--app', 'com.google.Chrome']);
    if ((sr.whole_window || []).some((g) => /password manager page/.test(g))) break;
    await vent(500);
  }
  check('1. vinduet svaertes HELT, af grunden «password manager page»',
        sr.rects.filter(iV).some(heleV) && (sr.whole_window || []).some((g) => /password manager page/.test(g)),
        `rekt ${JSON.stringify(sr.rects.filter(iV))} grunde ${JSON.stringify(sr.whole_window)}`);

  // 2. find: intet tekstfelt fra siden (kodeordssiden har et soegefelt), og svaret siger hvorfor.
  const f = hj(['find', '--app', 'com.google.Chrome', '--role', 'AXTextField', '--depth', '60', '--limit', '400']);
  const fraSiden = (f.matches || []).filter((m) => iSiden(m.frame) && !foerFind.has(noegle(m)));
  check('2. find giver intet felt fra kodeordssiden, og siger at den blev sprunget over',
        fraSiden.length === 0 && (f.skipped_password_pages || []).length > 0,
        `fra siden: ${JSON.stringify(fraSiden.map((m) => m.name || m.role))} sprunget: ${JSON.stringify(f.skipped_password_pages)}`);

  // 3. inspect: kun en «denied»-markering for siden.
  const ins = inspektion();
  const naegtet = ins.filter((n) => n.denied && n.role === 'AXWebArea' && /password manager page/.test(n.note || ''));
  const indhold = ins.filter((n) => !n.denied && iSiden(n.frame) && (n.value || n.title) && !foerIns.has(noegle(n)));
  check('3. inspect giver en «denied»-markering og intet indhold fra siden',
        naegtet.length > 0 && indhold.length === 0,
        `naegtet ${naegtet.length}, indhold fra siden: ${JSON.stringify(indhold.slice(0, 5).map((n) => n.title || n.value))}`);
} finally {
  check('Z. proevens Chrome er lukket igen', chrome.stop(), 'den lever stadig');
  ryd();
}
console.log(fejl ? `\n${fejl} DUMPET` : '\nBESTAAET');
process.exit(fejl ? 1 : 0);
