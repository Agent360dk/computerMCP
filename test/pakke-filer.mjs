// ALT SERVEREN IMPORTERER, ER MED I DEN PAKKE DER UDGIVES.
//
// ⛔ 7/10: punkt P tilfoejede `mcp-server/tilstede.js`, og `godkend.js` importerer
//    den. `package.json` "files" er en haandholdt liste - den manglede filen, og
//    det samme gjorde `scripts/build-mcpb.sh`. Alle proever koerer fra kildemappen,
//    saa INGEN af dem saa det: den udgivne pakke ville gaa ned ved opstart
//    (ERR_MODULE_NOT_FOUND). Proeven her laeser hvad `npm pack` FAKTISK pakker og
//    foelger hver relativ import fra index.js.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRV = join(ROOT, 'mcp-server');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

// Hvad npm faktisk ville pakke (ingen netvaerk, ingen skrivning).
const ud = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: SRV, encoding: 'utf8' });
const pakket = new Set(JSON.parse(ud)[0].files.map(f => f.path));
check('npm pack svarede med en filliste', pakket.size > 5, `${pakket.size} filer`);

// Foelg relative imports fra indgangen.
const set = new Set(), mangler = [];
const koe = ['index.js'];
while (koe.length) {
  const f = koe.shift();
  if (set.has(f)) continue;
  set.add(f);
  const sti = join(SRV, f);
  if (!existsSync(sti)) { mangler.push(`${f} (findes ikke i kilden)`); continue; }
  const kilde = readFileSync(sti, 'utf8');
  for (const m of kilde.matchAll(/(?:import|export)[^'"`]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    const rel = m[1] || m[2];
    koe.push(normalize(join(dirname(f), rel)));
  }
}
for (const f of set) if (!pakket.has(f)) mangler.push(f);
check('hver fil index.js importerer (hele kaeden) er med i pakken', mangler.length === 0, mangler.join(', ') || `${set.size} filer`);
check('kaeden er ikke trivielt kort (maaleren saa importerne)', set.size >= 8, `${set.size}`);

// MCPB-scriptet bruger samme liste - ingen egen haandholdt kopi.
const mcpb = readFileSync(join(ROOT, 'scripts', 'build-mcpb.sh'), 'utf8');
check('build-mcpb.sh laeser fillisten fra package.json', /package\.json/.test(mcpb) && !/for f in index\.js tools\.js/.test(mcpb));

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
