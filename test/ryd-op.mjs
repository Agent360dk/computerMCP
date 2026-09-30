// Proevernes midlertidige mapper slettes, naar proeven er BESTAAET.
//
// ⛔ MAALT 30/9-2026: 5.442 cmcp-*-mapper (3,4 GB) i $TMPDIR paa Gustavs Mac -
//    hver koersel af suiten eller mutationsbeviset efterlod ~400, og disken loeb
//    fuld midt i en mutant. En dumpet proeve beholder sine mapper: de er beviset.
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
process.on('exit', (kode) => {
  if (kode !== 0 || process.exitCode) return;
  for (const d of mapper) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
});
