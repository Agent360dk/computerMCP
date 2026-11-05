// Smaa Chrome-vinduer (under 200x120): de to regler der KUN gaelder dem.
//
// ⛔ R3 5/11 (Astra): M4 («kaldet lige taendte Chrome» slaaet fra) og M6 («har et web-omraade» slaaet fra)
//    overlevede, fordi ingen proeve ramte deres veje - store vinduer gaar gennem porten paa stoerrelsen alene.
//    Denne proeve aabner to SMAA popups, saa netop de to regler er de eneste der kan svaerte dem:
//
//    1. P1 (med kodefelt), paa det kald der taender Chrome: intet web-omraade endnu -> kun «lige taendt» svaerter
//    2. P2 (en tom side), naar Chrome er taendt: web-omraadet findes, men er tomt -> kun «har et web-omraade» svaerter
//    3. P1, naar siden er bygget: kun kodefeltet, ikke hele vinduet
//
// Giver Chrome vinduerne mindst 200x120, kan vejen ikke naas i praksis - saa siger proeven SPRUNGET OVER.
import { execFileSync } from 'node:child_process';
import { startChrome, inaktivSek, MIN_INAKTIV, slutDom } from './chrome-start.mjs';
const START_MS = Date.now();
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const hj = (args, env) => JSON.parse(execFileSync(H, args, { encoding: 'utf8', timeout: 60000, env: env ? { ...process.env, ...env } : process.env }));
const vent = (ms) => new Promise((r) => setTimeout(r, ms));
const M = `CMCPLILLE${Date.now().toString(36).toUpperCase()}`;

const mappe = mkdtempSync(join(tmpdir(), 'cmcp-chrome-lille-'));
writeFileSync(join(mappe, 'p1.html'), `<!doctype html><html><head><meta charset="utf-8"><title>${M}-P1</title></head>
<body style="margin:2px;font:11px system-ui"><input type="password" aria-label="${M}-KODE" value="hemmelig" style="width:90px"></body></html>`);
writeFileSync(join(mappe, 'p2.html'), `<!doctype html><html><head><meta charset="utf-8"><title>${M}-P2</title></head><body></body></html>`);
writeFileSync(join(mappe, 'side.html'), `<!doctype html><html><head><meta charset="utf-8"><title>${M}-HOVED</title></head><body><script>
window.open('p1.html', 'p1', 'popup,width=170,height=100,left=700,top=150');
window.open('p2.html', 'p2', 'popup,width=170,height=100,left=700,top=400');
</script></body></html>`);
const chrome = await startChrome([`--user-data-dir=${join(mappe, 'profil')}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-popup-blocking', '--disable-session-crashed-bubble', '--window-position=60,90',
  '--window-size=520,380', `file://${join(mappe, 'side.html')}`]);
const ryd = () => { chrome.stop(); try { rmSync(mappe, { recursive: true, force: true }); } catch {} };
process.on('exit', ryd);

const vindue = (titel) => (hj(['find', '--app', 'com.google.Chrome', '--role', 'AXWindow', '--contains', titel, '--depth', '3'], { CMCP_INGEN_ELECTRON: '1' }).matches || [])[0];
const helt = (rects, f) => rects.some((r) => Math.abs(r.x - f.x) <= 4 && Math.abs(r.y - f.y) <= 4 && Math.abs(r.w - f.w) <= 6 && Math.abs(r.h - f.h) <= 6);
const inde = (rects, f) => rects.filter((r) => r.x >= f.x - 4 && r.y >= f.y - 4 && r.x + r.w <= f.x + f.w + 4 && r.y + r.h <= f.y + f.h + 4);

try {
  let p1, p2;
  for (let i = 0; i < 60 && !(p1 && p2); i++) { await vent(250); p1 = p1 || vindue(`${M}-P1`); p2 = p2 || vindue(`${M}-P2`); }
  check('0. de to smaa popups er aabnet', !!(p1 && p2), 'Chrome viste dem ikke paa 15 s');
  if (p1 && p2) {
    console.log(`     P1 ${JSON.stringify(p1.frame)} ${p1.subrole} · P2 ${JSON.stringify(p2.frame)} ${p2.subrole}`);
    if (p1.frame.w >= 200 && p1.frame.h >= 120 || p2.frame.w >= 200 && p2.frame.h >= 120) {
      ryd(); spring(`Chrome gav vinduerne ${p1.frame.w}x${p1.frame.h} og ${p2.frame.w}x${p2.frame.h} - smaavinduesvejen kan ikke naas med Chrome`);
    }
    // 1. Det taendende kald: P1 har intet web-omraade endnu.
    const r1 = hj(['secure-rects', '--app', 'com.google.Chrome']);
    check('1. P1 svaertes helt paa det kald der taender Chrome («lige taendt»)', helt(r1.rects, p1.frame),
          `rekt i P1 ${JSON.stringify(inde(r1.rects, p1.frame))} grunde ${JSON.stringify(r1.whole_window)}`);
    // Vent til P1's kodefelt er bygget.
    let fk = { count: 0 };
    for (let i = 0; i < 60 && !fk.count; i++) { await vent(500); fk = hj(['find', '--app', 'com.google.Chrome', '--contains', `${M}-KODE`, '--depth', '60']); }
    const r2 = hj(['secure-rects', '--app', 'com.google.Chrome']);
    // 2. P2: en tom side - web-omraadet findes, men har intet indhold.
    check('2. P2 (tom side) svaertes helt («har et web-omraade», men tomt)', helt(r2.rects, p2.frame),
          `rekt i P2 ${JSON.stringify(inde(r2.rects, p2.frame))} grunde ${JSON.stringify(r2.whole_window)}`);
    // 3. P1 bygget: kun feltet.
    check('3. P1, naar siden er bygget: kun kodefeltet, ikke hele vinduet',
          fk.count > 0 && inde(r2.rects, p1.frame).length >= 1 && !helt(r2.rects, p1.frame),
          `fundet ${fk.count}, rekt i P1 ${JSON.stringify(inde(r2.rects, p1.frame))}`);
  }
} finally {
  check('Z. proevens Chrome er lukket igen', chrome.stop(), 'den lever stadig');
  ryd();
}
process.exit(slutDom(fejl, 5, START_MS));
