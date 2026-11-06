// Et Chrome-vindue med en TOM side: porten skal altid svaerte det helt. Deterministisk.
//
// ⛔ 5/11 (Opus R3-5 + maalt 09.11-09.58): trin 2 i side-proeven er et kaploeb, og et tomt POPUP fra samme side tog
//    fokus, saa Chrome aldrig byggede hovedvinduet. Her er den tomme side det ENESTE vindue. Dets web-omraade findes
//    og forbliver tomt, saa porten kan aldrig staa inde for det - uanset tidspunkt. Binder M1 (porten svaerter intet)
//    og M2 (et tomt web-omraade taeller som bygget).
//
//    1. web-omraadet findes (siden er bygget - ellers maaler trin 2 noget andet)
//    2. hele vinduet svaertes
import { execFileSync } from 'node:child_process';
import { startChrome, inaktivSek, MIN_INAKTIV, slutDom } from './chrome-start.mjs';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const START_MS = Date.now();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = process.env.CMCP_HELPER || join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
const N = 4;
const spring = (grund) => { console.log(`SPRUNGET OVER: ${N} (${grund}) - bevist intet, ikke bestaaet`); process.exit(0); };
if (!existsSync('/Applications/Google Chrome.app')) spring('Google Chrome er ikke installeret her');
{
  const io = execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' });
  if (/CGSSessionScreenIsLocked"?\s*=\s*(Yes|true|1)/.test(io)) spring('skaermen er laast - Chrome bygger ingen sider imens');
}
if (inaktivSek() < MIN_INAKTIV) spring(`personen arbejder lige nu - inaktiv ${Math.round(inaktivSek())} s; en ny Chrome henter sig selv frem foran dem`);

let fejl = 0;
const check = (navn, ok, hvorfor) => { console.log(`${ok ? 'OK  ' : 'DUMP'} ${navn}${ok ? '' : ' - ' + hvorfor}`); if (!ok) fejl++; };
const hj = (args, env) => JSON.parse(execFileSync(H, args, { encoding: 'utf8', timeout: 60000, env: env ? { ...process.env, ...env } : process.env }));
const vent = (ms) => new Promise((r) => setTimeout(r, ms));
const M = `CMCPTOM${Date.now().toString(36).toUpperCase()}`;

const mappe = mkdtempSync(join(tmpdir(), 'cmcp-chrome-tom-'));
writeFileSync(join(mappe, 'tom.html'), `<!doctype html><html><head><meta charset="utf-8"><title>${M}</title></head><body></body></html>`);
const V = { x: 160, y: 140, w: 640, h: 480 };
const chrome = await startChrome([`--user-data-dir=${join(mappe, 'profil')}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-session-crashed-bubble', `--window-position=${V.x},${V.y}`, `--window-size=${V.w},${V.h}`,
  `file://${join(mappe, 'tom.html')}`]);
const ryd = () => { chrome.stop(); try { rmSync(mappe, { recursive: true, force: true }); } catch {} };
process.on('exit', ryd);

try {
  let w = null;
  for (let i = 0; i < 60 && !w; i++) {
    await vent(250);
    w = (hj(['find', '--app', 'com.google.Chrome', '--role', 'AXWindow', '--contains', M, '--depth', '3'], { CMCP_INGEN_ELECTRON: '1' }).matches || [])[0] || null;
  }
  check('0. vinduet med den tomme side er aabnet', !!w, 'Chrome viste det ikke paa 15 s');
  if (w) {
    // 1. Web-omraadet findes (sidens titel baeres af omraadet) - saa er siden bygget, og den ER tom.
    let wa = { count: 0 };
    for (let i = 0; i < 60 && !wa.count; i++) { wa = hj(['find', '--app', 'com.google.Chrome', '--role', 'AXWebArea', '--contains', M, '--depth', '20']); if (!wa.count) await vent(500); }
    check('1. den tomme sides web-omraade findes (siden er bygget)', wa.count > 0, `intet web-omraade paa 30 s ${JSON.stringify(wa).slice(0, 160)}`);
    // 2. Hele vinduet ud.
    const f = w.frame;
    const sr = hj(['secure-rects', '--app', 'com.google.Chrome']);
    const hel = sr.rects.some((r) => Math.abs(r.x - f.x) <= 4 && Math.abs(r.y - f.y) <= 4 && Math.abs(r.w - f.w) <= 6 && Math.abs(r.h - f.h) <= 6);
    check('2. vinduet med den tomme side svaertes HELT', hel,
          `ingen hele-vindue-rektangel paa ${JSON.stringify(f)}; grunde ${JSON.stringify(sr.whole_window)}`);
  }
} finally {
  check('Z. proevens Chrome er lukket igen', chrome.stop(), 'den lever stadig');
  ryd();
}
process.exit(slutDom(fejl, N, START_MS));
