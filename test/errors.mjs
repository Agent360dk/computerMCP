// Fejlbeskeder er ogsaa en flade, og en forkert besked koster mere end ingen.
//
// MAALT 18/9: at optage et program der laa paa en anden Space svarede
// "programmet koerer ikke". Programmet koerte udmaerket. Den besked sender
// folk ud at lede efter noget der staar lige for naesen af dem, og det er
// praecis den forvirring der kostede en halv dag under byggeriet.
//
// Proeven kraever at de TO tilfaelde kan skelnes. Uden det andet tjek ville
// "sig altid at den ligger paa en anden Space" bestaa.
//
// TO tidligere udgaver af denne fil maalte maskinen i stedet for koden:
//   1. Den startede en fixtur-app og PAASTOD en fejl. Fik fixturen et
//      vindue - hvilket afhaenger af om udvikleren koerer fuldskaerm -
//      skete der ingen fejl, og proeven dumpede paa at produktet virkede.
//   2. Rettet til at springe over i det tilfaelde, hvorefter den sprang over
//      i BEGGE miljoeer og beviste ingenting.
//
// Nu findes maalet i stedet: et program der koerer uden vinduer paa den
// synlige Space. Dem er der altid nogle af, og maskinen siger selv hvilke.
// Ingen fixtur, ingen binaer i repoet, intet der afhaenger af hvordan
// skrivebordet tilfaeldigvis staar.
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Samme binaer som serveren vaelger - se redaction-unit.py for hvorfor.
const H = [process.env.CMCP_HELPER,
           join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper'),
           join(ROOT, 'helper', '.build', 'release', 'cmcp-helper')]
          .find(p => p && existsSync(p)) || join(ROOT, 'helper', '.build', 'release', 'cmcp-helper');

const fails = [], skips = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const skip = (l, why) => { console.log(`SPR. ${l} - ${why}`); skips.push(l); };

async function helper(args) {
  try {
    const { stdout } = await run(H, args, { maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(stdout.trim().split('\n').pop());
  } catch (e) {
    const out = String(e.stdout || '').trim();
    try { return JSON.parse(out.split('\n').pop()); } catch { return { ok: false, error: out || e.message }; }
  }
}
const shot = bundle => helper(['screenshot', '--app', bundle, '--out', join(tmpdir(), 'cmcp-err.png')]);

// --- Tilfaelde B: et program der virkelig ikke findes ---
const gone = await shot('com.example.definitely.not.installed');
check('et ukendt program siger "koerer ikke"',
      /koerer ikke/.test(gone.error || ''), (gone.error || '').slice(0, 60));

// --- Tilfaelde A: et program der KOERER, men uden vindue paa denne Space ---
const apps = (await helper(['apps'])).apps || [];
const withWindows = new Set(((await helper(['windows'])).windows || []).map(w => w.bundleId));
const windowless = apps.filter(a => a.bundleId && !withWindows.has(a.bundleId));

if (!windowless.length) {
  skip('et koerende program uden vindue forklarer Space',
       `alle ${apps.length} koerende programmer har vinduer fremme - intet at proeve med`);
} else {
  const target = windowless[0];
  const other = await shot(target.bundleId);
  const msg = other.error || '';
  if (!msg) {
    skip('et koerende program uden vindue forklarer Space',
         `${target.name} kunne optages alligevel - intet at bedoemme`);
  } else {
    check('et koerende program siger ikke "koerer ikke"',
          !/programmet .* koerer ikke/.test(msg), `${target.name}: ${msg.slice(0, 55)}`);
    check('den forklarer Space i stedet',
          /Space/.test(msg), msg.slice(0, 70));
  }
}

console.log();
if (skips.length) console.log(`SPRUNGET OVER: ${skips.length} (bevist intet - ikke bestaaet)`);
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
