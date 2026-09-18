import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

/// Hjaelperen er en separat binaer, ikke en node-udvidelse. Det er et valg:
/// den binaer er det eneste der faar Tilgaengeligheds- og Skaermoptagelses-
/// rettigheder, den er lille nok til at laese igennem, og den kan udskiftes
/// uden at roere serveren.
export function helperPath() {
  const candidates = [
    process.env.CMCP_HELPER,
    join(HERE, 'vendor', 'cmcp-helper'),
    join(HERE, '..', 'helper', '.build', 'release', 'cmcp-helper'),
    join(HERE, '..', 'helper', '.build', 'debug', 'cmcp-helper')
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export class HelperError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export function callHelper(args, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const bin = helperPath();
    if (!bin) {
      return reject(new HelperError(
        'cmcp-helper blev ikke fundet. Byg den med `swift build -c release` i helper/, eller saet CMCP_HELPER til stien.',
        'helper-missing'
      ));
    }
    // Argumenter gives som et array, aldrig som en streng gennem en skal.
    // Ellers ville en vindues-titel med et semikolon i kunne blive til en
    // kommando, og saa ville hele samtykke-modellen vaere ligegyldig.
    execFile(bin, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      const text = String(stdout || '').trim();
      let parsed = null;
      if (text) { try { parsed = JSON.parse(text.split('\n').pop()); } catch { /* ikke JSON */ } }
      if (parsed && parsed.ok === false) {
        return reject(new HelperError(parsed.error || 'hjaelperen fejlede', parsed.code || 'helper-error'));
      }
      if (err && !parsed) {
        return reject(new HelperError(
          err.killed ? `hjaelperen svarede ikke inden for ${timeout} ms` : (String(stderr).trim() || err.message),
          err.killed ? 'helper-timeout' : 'helper-failed'
        ));
      }
      if (!parsed) return reject(new HelperError('hjaelperen svarede ikke med JSON', 'helper-bad-output'));
      resolve(parsed);
    });
  });
}

/// Hvilket program er forrest lige nu. Bruges til at afgoere om en handling
/// rammer et program der altid skal spoerge (adgangskode-bokse, terminaler).
export async function frontmostBundleId() {
  try {
    const r = await callHelper(['apps'], { timeout: 5000 });
    const active = (r.apps || []).find(a => a.active);
    return active ? active.bundleId : null;
  } catch { return null; }
}
