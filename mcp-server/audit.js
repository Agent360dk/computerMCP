import { appendFileSync, mkdirSync, chmodSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

const DIR = process.env.CMCP_STATE_DIR || join(homedir(), '.local', 'state', 'computer-mcp');
const FILE = join(DIR, 'audit.jsonl');

/// Tekst der skrives ind i et program, logges ALDRIG ordret.
///
/// Loeftet er at adgangskoder ikke forlader maskinen. Et revisionsspor der
/// gemmer hvert tastetryk i klartekst i en fil, ville bryde netop det loefte -
/// og goere loggen til det foerste sted en angriber ville kigge. Vi gemmer
/// laengden og et fingeraftryk: nok til at bevise at to handlinger skrev det
/// samme, aldrig nok til at laese hvad der stod.
export function fingerprint(text) {
  if (typeof text !== 'string') return null;
  return {
    length: text.length,
    sha256_12: createHash('sha256').update(text).digest('hex').slice(0, 12)
  };
}

const SENSITIVE_KEYS = new Set(['text', 'value', 'password']);

export function scrubArgs(args = {}) {
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = SENSITIVE_KEYS.has(k) ? fingerprint(String(v)) : v;
  }
  return out;
}

let warned = false;

export function record(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
    appendFileSync(FILE, line + '\n', { mode: 0o600 });
    chmodSync(FILE, 0o600);
  } catch (err) {
    // En revisionslog der ikke kan skrives, maa ikke kunne vaelte en koersel
    // tavst - men den maa heller ikke fejle stille. Én advarsel til stderr,
    // saa den der laeser loggen ved at der mangler linjer.
    if (!warned) {
      warned = true;
      process.stderr.write(`[computer-mcp] revisionsloggen kan ikke skrives (${err.code}); handlinger udfoeres stadig, men spores ikke\n`);
    }
  }
  return line;
}

export const AUDIT_PATH = FILE;
