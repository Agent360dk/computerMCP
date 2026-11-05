// Vault-porten mod en AEGTE hvaelv-adresse: https://vault.bitwarden.com, serveret lokalt.
//
// ⛔ 5/11 09.5x (MAALT): Chrome aabner ikke chrome://password-manager fra kommandolinjen - proeven viste Chromes
//    nye-fane-side og maalte en almindelig side. Nu: en lokal https-server (selvsigneret certifikat) og
//    --host-resolver-rules, saa Chrome henter `vault.bitwarden.com` hos os. Adressen i tilgaengeligheden (AXURL) er
//    da den rigtige hvaelv-adresse - det porten genkender. Serveren lytter paa en tilfaeldig fri port, aldrig 9876-9895.
//
//    0. vinduet viser NETOP proevesiden (titlen) - ellers maaler proeven noget andet
//    1. naar siden er bygget, svaertes HELE vinduet - af grunden «password manager page»
//    2. find giver INTET fra siden (dens egne markoerer), og svaret siger at en adgangskode-side blev sprunget over
//    3. inspect giver en «denied»-markering og intet af sidens indhold
import { execFileSync } from 'node:child_process';
import { startChrome, inaktivSek, MIN_INAKTIV, slutDom } from './chrome-start.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const START_MS = Date.now();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = process.env.CMCP_HELPER || join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
const N = 5;
const spring = (grund) => { console.log(`SPRUNGET OVER: ${N} (${grund}) - bevist intet, ikke bestaaet`); process.exit(0); };
if (!existsSync('/Applications/Google Chrome.app')) spring('Google Chrome er ikke installeret her');
{
  const io = execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' });
  if (/CGSSessionScreenIsLocked"?\s*=\s*(Yes|true|1)/.test(io)) spring('skaermen er laast - Chrome bygger ingen sider imens');
}
if (inaktivSek() < MIN_INAKTIV) spring(`personen arbejder lige nu - inaktiv ${Math.round(inaktivSek())} s; en ny Chrome henter sig selv frem foran dem`);

let fejl = 0;
const check = (navn, ok, hvorfor) => { console.log(`${ok ? 'OK  ' : 'DUMP'} ${navn}${ok ? '' : ' - ' + hvorfor}`); if (!ok) fejl++; };
const hj = (args, env) => JSON.parse(execFileSync(H, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env }));
const vent = (ms) => new Promise((r) => setTimeout(r, ms));
const M = `CMCPVAULT${Date.now().toString(36).toUpperCase()}`;
// Indholdets markoer staar KUN paa siden, aldrig i titlen: fanen og vinduet baerer sidens titel (metadata, ikke skjult - som for programmer).
const I = `INDHOLD${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

// Selvsigneret certifikat til vault.bitwarden.com - kun i en engangs-mappe.
const mappe = mkdtempSync(join(tmpdir(), 'cmcp-chrome-vault-'));
execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=vault.bitwarden.com',
  '-keyout', join(mappe, 'k.pem'), '-out', join(mappe, 'c.pem')], { stdio: 'ignore' });
const side = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${M}-TITEL</title></head>
<body style="font:16px system-ui;padding:24px"><h1>${I}-TEKST</h1>
<p><input aria-label="${I}-NAVN" value="bruger@eksempel.dk"></p><p><input type="password" aria-label="${I}-KODE" value="hemmelig"></p></body></html>`;
const server = createServer({ key: readFileSync(join(mappe, 'k.pem')), cert: readFileSync(join(mappe, 'c.pem')) },
  (_, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(side); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
if (port >= 9876 && port <= 9895) { server.close(); spring(`styresystemet gav port ${port}, som er reserveret browser-mcp`); }

const V = { x: 120, y: 110, w: 820, h: 600 };
const iV = (r) => r.x >= V.x - 4 && r.y >= V.y - 4 && r.x + r.w <= V.x + V.w + 4 && r.y + r.h <= V.y + V.h + 4;
const heleV = (r) => Math.abs(r.w - V.w) <= 8 && Math.abs(r.h - V.h) <= 8;
const chrome = await startChrome([`--user-data-dir=${join(mappe, 'profil')}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-session-crashed-bubble', `--window-position=${V.x},${V.y}`, `--window-size=${V.w},${V.h}`,
  `--host-resolver-rules=MAP vault.bitwarden.com 127.0.0.1:${port}`, '--ignore-certificate-errors', 'https://vault.bitwarden.com/']);
const ryd = () => { chrome.stop(); try { server.close(); } catch {} try { rmSync(mappe, { recursive: true, force: true }); } catch {} };
process.on('exit', ryd);

try {
  // 0. Proevesiden, ikke en fejlside: vinduets titel (Chromes egen brugerflade) baerer sidens titel.
  let set = false;
  for (let i = 0; i < 60 && !set; i++) {
    await vent(250);
    set = hj(['find', '--app', 'com.google.Chrome', '--role', 'AXWindow', '--contains', `${M}-TITEL`, '--depth', '3'], { CMCP_INGEN_ELECTRON: '1' }).count > 0;
  }
  check('0. vinduet viser proevesiden fra «vault.bitwarden.com»', set, 'titlen kom aldrig - adressen blev ikke hentet hos os');

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

  // 2. find: sidens EGNE markoerer findes ikke, og svaret siger hvorfor.
  const f = hj(['find', '--app', 'com.google.Chrome', '--contains', I, '--depth', '60', '--limit', '50']);
  const fraSiden = f.matches || [];
  check('2. find giver intet fra siden, og siger at en adgangskode-side blev sprunget over',
        fraSiden.length === 0 && (f.skipped_password_pages || []).some((g) => /password manager page/.test(g)),
        `fra siden: ${JSON.stringify(fraSiden.map((m) => m.role))} sprunget: ${JSON.stringify(f.skipped_password_pages)}`);

  // 3. inspect: kun en «denied»-markering; intet med sidens markoer (vinduets titel er Chromes egen - den taeller ikke).
  const ins = hj(['inspect', '--app', 'com.google.Chrome', '--depth', '14', '--limit', '4000']).nodes || [];
  const naegtet = ins.filter((n) => n.denied && /password manager page/.test(n.note || ''));
  const indhold = ins.filter((n) => !n.denied && JSON.stringify([n.title, n.value, n.desc]).includes(I));
  check('3. inspect giver en «denied»-markering og intet af sidens indhold',
        naegtet.length > 0 && indhold.length === 0, `naegtet ${naegtet.length}, med sidens markoer: ${indhold.map((n) => n.role).join(', ')}`);
} finally {
  check('Z. proevens Chrome er lukket igen', chrome.stop(), 'den lever stadig');
  ryd();
}
process.exit(slutDom(fejl, N, START_MS));
