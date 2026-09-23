// Sloejfe-vaernet, paa tvaers af agenter.
//
// ⛔ FABLE (23/9): vaernet var en `Map` i ÉN serverproces. Paa den maskine det
//    blev skrevet paa koerte 15 servere samtidig - én pr. aaben chat - saa
//    graensen «ti ens skrivende kald i minuttet» var i virkeligheden 150.
//    En agent der sidder fast, er sjaelden. Femten agenter der sidder fast paa
//    den samme knap, er praecis det doegndrift handler om.
//
// Taelleren ligger derfor i state-mappen, som revisionsloggen: én linje pr.
// kald, og vi taeller linjerne med samme noegle inden for vinduet. Append er
// billigt og kan ikke laase for nogen; filen klippes naar den bliver lang.
import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const DIR = process.env.CMCP_STATE_DIR || join(homedir(), '.local', 'state', 'computer-mcp');
const FIL = join(DIR, 'sloejfe.jsonl');
const VINDUE_MS = 60_000;
const MAKS_LINJER = 4000;

/// Noeglen er vaerktoej + argumenter, men hashet: argumenterne kan baere en
/// hemmelighed, og det her er en taeller - ikke et spor.
export function noegle(navn, args) {
  return createHash('sha256').update(navn + '|' + JSON.stringify(args ?? {})).digest('hex').slice(0, 16);
}

/// Hvor mange gange er PRAECIS det her kald sket paa maskinen i det sidste
/// minut - af alle agenter tilsammen? Tallet inkluderer dette kald.
export function taelOgTael(navn, args) {
  const k = noegle(navn, args);
  const nu = Date.now();
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
    appendFileSync(FIL, JSON.stringify({ t: nu, k }) + '\n', { mode: 0o600 });
  } catch { return 1; }   // kan vi ikke taelle, skal vi ikke afvise nogen
  let linjer = [];
  try { linjer = readFileSync(FIL, 'utf8').split('\n').filter(Boolean); } catch { return 1; }
  const friske = [];
  let antal = 0;
  for (const l of linjer) {
    let d; try { d = JSON.parse(l); } catch { continue; }
    if (nu - d.t > VINDUE_MS) continue;
    friske.push(l);
    if (d.k === k) antal++;
  }
  // Klip filen naar den vokser: kun det sidste minut har betydning.
  if (linjer.length > MAKS_LINJER) {
    try {
      writeFileSync(FIL + '.tmp', friske.join('\n') + '\n', { mode: 0o600 });
      renameSync(FIL + '.tmp', FIL);
    } catch { /* en mislykket oprydning maa ikke vaelte et kald */ }
  }
  return antal;
}
