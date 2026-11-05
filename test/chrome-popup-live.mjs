// Et Chrome-vindue der IKKE er et almindeligt browser-vindue: et popup fra window.open med et kodefelt.
//
// ⛔ R2 5/11 (Opus N3): porten galdt kun AXStandardWindow; en udvidelses-popup (1Password, Bitwarden) har
//    web-indhold og en anden underrolle og sprang den over. En rigtig udvidelse kan ikke indlaeses i en
//    engangs-profil (--load-extension er slaaet fra i Chrome siden 137), saa denne proeve bruger et popup-
//    vindue og SKRIVER underrollen ned: er den AXStandardWindow, maaler proeven den gamle regel, og det siges.
//
//    1. kaldet der taender Chrome, svaerter popup-vinduet helt
//    2. naar popup'ens side er bygget, ses den
//    3. og saa svaertes KUN kodefeltet i popup'en, ikke hele vinduet
//
// Koeres bevidst: `node test/chrome-popup-live.mjs`. Roerer hverken mus eller tastatur.
import { execFileSync } from 'node:child_process';
import { startChrome, inaktivSek, MIN_INAKTIV } from './chrome-start.mjs';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = process.env.CMCP_HELPER || join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) { console.log('SPRUNGET OVER: 6 (Google Chrome er ikke installeret her) - bevist intet, ikke bestaaet'); process.exit(0); }
{
  const io = execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' });
  if (/CGSSessionScreenIsLocked"?\s*=\s*(Yes|true|1)/.test(io)) { console.log('SPRUNGET OVER: 6 (skaermen er laast - Chrome bygger ingen sider imens) - bevist intet, ikke bestaaet'); process.exit(0); }
}
// ⛔ MAALT 5/11 08.21: Chrome henter sig selv frem trods `open -g`. Kun naar personen ikke arbejder.
if (inaktivSek() < MIN_INAKTIV) { console.log(`SPRUNGET OVER: 6 (personen arbejder lige nu - inaktiv ${Math.round(inaktivSek())} s; en ny Chrome henter sig selv frem foran dem) - bevist intet, ikke bestaaet`); process.exit(0); }
let fejl = 0;
const check = (navn, ok, hvorfor) => { console.log(`${ok ? 'OK  ' : 'DUMP'} ${navn}${ok ? '' : ' - ' + hvorfor}`); if (!ok) fejl++; };
const hj = (args, env) => JSON.parse(execFileSync(H, args, { encoding: 'utf8', timeout: 60000, env: env ? { ...process.env, ...env } : process.env }));
const vent = (ms) => new Promise((r) => setTimeout(r, ms));
const M = `CMCPPOP${Date.now().toString(36).toUpperCase()}`;

const mappe = mkdtempSync(join(tmpdir(), 'cmcp-chrome-pop-'));
writeFileSync(join(mappe, 'pop.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${M}-POP</title></head>
<body style="font:15px system-ui;padding:16px"><p>${M}-TEKST</p><input aria-label="${M}-NAVN" value="bruger">
<p><input type="password" aria-label="${M}-KODE" value="hemmelig"></p></body></html>`);
writeFileSync(join(mappe, 'side.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${M}-HOVED</title></head>
<body><p>hovedside</p><script>window.open('pop.html', 'p', 'popup,width=440,height=300,left=880,top=120');</script></body></html>`);
// Startes i BAGGRUNDEN (open -g): en direkte start hentede Chrome frem foran personen (5/11).
const chrome = await startChrome([`--user-data-dir=${join(mappe, 'profil')}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-popup-blocking', '--disable-session-crashed-bubble', '--window-position=60,90',
  '--window-size=600,420', `file://${join(mappe, 'side.html')}`]);
const ryd = () => { chrome.stop(); try { rmSync(mappe, { recursive: true, force: true }); } catch {} };
process.on('exit', ryd);

try {
  // Vent paa popup-vinduet (titlen, Chromes egen brugerflade) UDEN at taende traeet.
  let pop = null;
  for (let i = 0; i < 60 && !pop; i++) {
    await vent(250);
    // `find` (ikke `windows`) giver underrollen med.
    const w = hj(['find', '--app', 'com.google.Chrome', '--role', 'AXWindow', '--contains', `${M}-POP`, '--depth', '3'], { CMCP_INGEN_ELECTRON: '1' });
    pop = (w.matches || [])[0] || null;
  }
  check('0. popup-vinduet er aabnet', !!pop, 'Chrome viste intet popup paa 15 s');
  // 5/11: maalt MENS proevevinduet er aabent (efter lukning ville fokus vende tilbage og skjule det).
  //    Paa processen (ASN), ikke navnet - personens Chrome og proevens hedder begge «Google Chrome».
  // 0b (oplysning, ikke et tjek): MAALT 5/11 - Chrome tager forreste plads trods open -g; derfor inaktivitetsvagten.
  console.log(`     forreste proces foer/efter start: ${chrome.forrestFoer} / ${chrome.forrestEfter()} (${chrome.forrestNavn()})`);
  if (pop) {
    const f = pop.frame || {};
    console.log(`     popup-vinduets underrolle: ${pop.subrole ?? '(ikke i svaret)'} · ramme ${JSON.stringify(f)}`);
    const iPop = (r) => r.x >= f.x - 4 && r.y >= f.y - 4 && r.x + r.w <= f.x + f.w + 4 && r.y + r.h <= f.y + f.h + 4;
    const helePop = (r) => Math.abs(r.w - f.w) <= 8 && Math.abs(r.h - f.h) <= 8;

    const r1 = hj(['secure-rects', '--app', 'com.google.Chrome']);
    check('1. kaldet der taender Chrome, svaerter popup-vinduet helt', r1.rects.filter(iPop).some(helePop),
          `rekt ${JSON.stringify(r1.rects.filter(iPop))} grunde ${JSON.stringify(r1.whole_window)}`);

    let fnd = { count: 0 };
    for (let i = 0; i < 60 && !fnd.count; i++) { await vent(500); fnd = hj(['find', '--app', 'com.google.Chrome', '--contains', `${M}-NAVN`, '--depth', '60']); }
    check('2. popup-sidens felt ses', fnd.count > 0, 'ikke fundet paa 30 s');

    const r3 = hj(['secure-rects', '--app', 'com.google.Chrome']).rects.filter(iPop);
    check('3. kun kodefeltet i popup\'en svaertes, ikke hele vinduet',
          r3.length >= 1 && !r3.some(helePop) && r3.some((r) => r.w < 400 && r.h < 60), JSON.stringify(r3));
  }
} finally {
  check('Z. proevens Chrome er lukket igen', chrome.stop(), 'den lever stadig - naeste proeve ville maale dens vinduer');
  ryd();
}
console.log(fejl ? `\n${fejl} DUMPET` : '\nBESTAAET');
process.exit(fejl ? 1 : 0);
