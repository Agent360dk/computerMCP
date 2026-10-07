// INGEN PROEVE KAN SKRIVE I MENNESKETS RIGTIGE TILSTANDSMAPPE.
//
// ⛔ 7/10 (panel R8-R9, punkt F): en serverstart uden CMCP_STATE_DIR skriver i
//    ~/.local/state/computer-mcp - revisionslog, koe, samtykke. Proeven her kraever:
//    hver fil der starter serveren, importerer egen-tilstand.mjs (eller er undtaget
//    med en grund og en bevist reserve), ingen fil SLETTER variablen, og run-all.sh
//    saetter selv en midlertidig mappe.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const T = dirname(fileURLToPath(import.meta.url));
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

// Undtaget: kvitteringens fingeraftryk er policy.js + failclosed.mjs, saa en aendring
// dér kraever en ny dialog-koersel paa menneskets skaerm. Den har sin egen reserve.
// touchid-manuel.mjs taler MED VILJE til det rigtige ikon (et menneske godkender med
// Touch ID); den koeres kun i haanden, aldrig af run-all.sh eller CI - det tjekkes her.
const UNDTAGET = { 'failclosed.mjs': /CMCP_STATE_DIR:\s*process\.env\.CMCP_STATE_DIR\s*\n?\s*\|\|\s*mkdtempSync/,
                   'touchid-manuel.mjs': /const STATE = process\.env\.CMCP_STATE_DIR \|\| join\(homedir\(\), '\.local\/state\/computer-mcp'\)/ };
const starter = readdirSync(T).filter(f => f.endsWith('.mjs') && f !== 'tilstand-isoleret.mjs')
  .filter(f => { const s = readFileSync(join(T, f), 'utf8'); return /spawn\(/.test(s) && /index\.js/.test(s); });
check('maaleren fandt serverstartende proever', starter.length >= 25, `${starter.length}`);
const mangler = starter.filter(f => {
  const s = readFileSync(join(T, f), 'utf8');
  if (UNDTAGET[f]) return !UNDTAGET[f].test(s);
  return !/^import (\{[^}]*\} from )?'\.\/egen-tilstand\.mjs';$/m.test(s);
});
check('hver serverstartende proeve importerer egen-tilstand.mjs (eller har en bevist reserve)', mangler.length === 0, mangler.join(', ') || 'alle');
const sletter = readdirSync(T).filter(f => f.endsWith('.mjs') && f !== 'tilstand-isoleret.mjs')
  .filter(f => /delete process\.env\.CMCP_STATE_DIR/.test(readFileSync(join(T, f), 'utf8')));
check('ingen proeve sletter CMCP_STATE_DIR undervejs', sletter.length === 0, sletter.join(', ') || 'ingen');
check('den manuelle Touch ID-proeve koeres ikke af suiten', !/touchid-manuel/.test(readFileSync(join(T, 'run-all.sh'), 'utf8')));
check('egen-tilstand.mjs slaar ogsaa menneskets ikon fra (som run-all.sh)', /process\.env\.CMCP_STATUS_IKON = '0'/.test(readFileSync(join(T, 'egen-tilstand.mjs'), 'utf8')));
check('run-all.sh saetter selv en midlertidig tilstandsmappe', /^export CMCP_STATE_DIR="\$\{CMCP_STATE_DIR:-\$\(mktemp -d/m.test(readFileSync(join(T, 'run-all.sh'), 'utf8')));
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
