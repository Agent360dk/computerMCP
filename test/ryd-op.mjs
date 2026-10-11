// Proevernes midlertidige mapper slettes, naar proeven slutter - ogsaa naar den dumper eller afbrydes.
//
// ⛔ MAALT 30/9-2026: 5.442 cmcp-*-mapper (3,4 GB) i $TMPDIR paa Gustavs Mac -
//    hver koersel af suiten eller mutationsbeviset efterlod ~400, og disken loeb
//    fuld midt i en mutant.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
const { realpathSync } = fs;

const mapper = [];
const original = fs.mkdtempSync;
fs.mkdtempSync = (prefix, ...rest) => {
  const d = original(prefix, ...rest);
  // Kun mapper i systemets midlertidige mappe - aldrig noget en proeve fik udefra.
  if (realpathSync(d).startsWith(realpathSync(tmpdir()) + '/')) mapper.push(d);
  return d;
};
syncBuiltinESMExports();
// ⛔ 11/10 (diskchatten, maalt 8.041 mapper og et nedbrud 11/10 11.03 fordi disken var fuld):
//    «kun ved bestaaet» efterlod ALT fra hver dumpet proeve - og mutantporten faar proeverne
//    til at dumpe med vilje, hundredvis af gange pr. koersel. Afbrudte koersler ryddede heller
//    intet. Nu ryddes der altid: ved bestaaet, ved dumpet og ved afbrydelse. Skal en dumpet
//    proeves mapper gemmes til fejlsoegning, saet CMCP_BEHOLD_PROEVEMAPPER=1.
function ryd() {
  if (process.env.CMCP_BEHOLD_PROEVEMAPPER === '1') return;
  for (const d of mapper.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}
process.on('exit', ryd);
for (const [sig, nr] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) {
  process.on(sig, () => {
    ryd();
    // Har proeven selv en handler for signalet, faar den lov at afslutte; ellers goer vi.
    if (process.listenerCount(sig) <= 1) process.exit(128 + nr);
  });
}
