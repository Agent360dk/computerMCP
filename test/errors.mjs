// Fejlbeskeder er ogsaa en flade, og en forkert besked koster mere end ingen.
//
// MAALT 18/9: at optage et program der laa paa en anden Space svarede
// "programmet koerer ikke". Programmet koerte udmaerket. Den besked sender
// folk ud at lede efter noget der staar lige for naesen af dem, og det er
// praecis den forvirring der kostede en halv dag under byggeriet.
//
// Proeven kraever at de TO tilfaelde kan skelnes. Uden det andet tjek ville
// "sig altid at den ligger paa en anden Space" bestaa.
import { spawn, execFile } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = join(ROOT, 'helper', '.build', 'release', 'cmcp-helper');
const APP = join(ROOT, 'test', 'fixture', 'CMCPFixture.app');

const fails = [], skips = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const skip = (l, why) => { console.log(`SPR. ${l} - ${why}`); skips.push(l); };

async function shot(bundle) {
  try {
    const { stdout } = await run(H, ['screenshot', '--app', bundle, '--out', join(tmpdir(), 'cmcp-err.png')]);
    return JSON.parse(stdout.trim().split('\n').pop());
  } catch (e) {
    const out = String(e.stdout || '').trim();
    try { return JSON.parse(out.split('\n').pop()); } catch { return { error: out || e.message }; }
  }
}

// --- Tilfaelde B foerst: et program der virkelig ikke findes ---
const gone = await shot('com.example.definitely.not.installed');
check('et ukendt program siger "koerer ikke"',
      /koerer ikke/.test(gone.error || ''), (gone.error || '').slice(0, 60));

// --- Tilfaelde A: et program der KOERER, men uden vindue paa denne Space ---
if (!existsSync(APP)) {
  skip('et koerende program uden vindue forklarer Space', 'fixtur-app ikke bygget');
} else {
  await run('/usr/bin/open', [APP]);
  await new Promise(r => setTimeout(r, 3000));
  const running = await new Promise(r =>
    execFile('/usr/bin/pgrep', ['-f', 'CMCPFixture'], (e, o) => r(Boolean(String(o).trim()))));

  if (!running) {
    skip('et koerende program uden vindue forklarer Space', 'fixturen startede ikke');
  } else {
    const other = await shot('dev.computermcp.fixture');
    const msg = other.error || '';
    // Den maa IKKE sige "koerer ikke", for det goer den.
    check('et koerende program siger ikke "koerer ikke"',
          !/programmet .* koerer ikke/.test(msg), msg.slice(0, 70));
    check('den forklarer Space i stedet',
          /Space/.test(msg), msg.slice(0, 70));
    await new Promise(r => execFile('/usr/bin/pkill', ['-f', 'CMCPFixture'], () => r()));
  }
}

console.log();
if (skips.length) console.log(`SPRUNGET OVER: ${skips.length} (bevist intet - ikke bestaaet)`);
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
