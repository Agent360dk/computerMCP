// PROEVE-ATTRAPPEN SVARER FAST PAA DE OPSLAG DER AFGOER EN DOM (punkt H).
//
// ⛔ 7/10 (panel R8): `at`, `apps`, `focused`, `press --dry` og `idle` gik til den
//    AEGTE hjaelper, saa en proeves dom afhang af udviklerens skaerm (R6-R7: tre roede
//    dage paa Gustavs Mac). Proeven her kraever: de fem svarer fast som standard, en
//    proeves eget `saetSvar` vinder, og aegte opslag sker kun naar proeven beder om det.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, FASTE_OPSLAG } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const kald = (h, argv) => {
  const r = spawnSync(h.sti, argv, { encoding: 'utf8', input: '{}' });
  try { return JSON.parse(r.stdout); } catch { return { ulaeseligt: (r.stdout + r.stderr).slice(0, 80) }; }
};
const FEM = [['apps', '--all'], ['at', '--x', '5', '--y', '5'], ['focused'], ['press', '--app', 'com.apple.finder', '--dry'], ['idle']];
const noegle = a => a[0] + (a.includes('--dry') ? ' --dry' : '');

check('de fem opslag der afgoer en dom har hvert et fast svar',
      FEM.every(a => FASTE_OPSLAG[noegle(a)]) && Object.keys(FASTE_OPSLAG).length === 5, Object.keys(FASTE_OPSLAG).join(', '));

// 1. Standard: hvert svar er det faste - og staar i sporet som fast, ikke videresendt.
const h = lavFalskHjaelper('cmcp-faste-opslag');
for (const a of FEM) {
  const svar = kald(h, a);
  const { ok, ...resten } = svar;
  check(`standard: ${noegle(a)} svarer fast`, ok === true && JSON.stringify(resten) === JSON.stringify(FASTE_OPSLAG[noegle(a)]),
        JSON.stringify(svar).slice(0, 90));
}
check('standard: hvert svar er noteret som fast i sporet', h.kald().filter(k => k.fast).length === FEM.length,
      `${h.kald().filter(k => k.fast).length} af ${FEM.length}`);

// 2. Proevens eget svar vinder over standarden.
h.saetSvar({ at: { found: false } });
check('saetSvar vinder over standarden', kald(h, ['at', '--x', '1', '--y', '1']).found === false);

// 3. Aegte opslag kun paa bestilling - og saa er det IKKE det faste svar.
const RIGTIG = [join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper'), join(ROOT, 'helper', '.build', 'release', 'cmcp-helper')].some(existsSync);
if (!RIGTIG || process.platform !== 'darwin') {
  console.log('SPRUNGET OVER: aegte opslag (ingen bygget hjaelper her) - bevist intet');
} else {
  const ae = lavFalskHjaelper('cmcp-aegte-opslag', { aegteOpslag: true });
  const apps = kald(ae, ['apps', '--all']);
  check('aegteOpslag: apps kommer fra den rigtige hjaelper, ikke det faste svar',
        Array.isArray(apps.apps) && JSON.stringify(apps.apps) !== JSON.stringify(FASTE_OPSLAG.apps.apps)
        && !ae.kald().some(k => k.fast), `${apps.apps?.length ?? '?'} programmer`);
  // Opus R10: med de faste svar maaler server-e2e ikke laengere de ægte svars FORM. Den
  // maales her, laesende: idle (som P og D hviler paa), at og focused.
  const id = kald(ae, ['idle']), at = kald(ae, ['at', '--x', '5', '--y', '5']), fo = kald(ae, ['focused']);
  check('aegteOpslag: idle er et tal >= 0 fra den rigtige hjaelper', typeof id.idle === 'number' && id.idle >= 0 && id.idle !== FASTE_OPSLAG.idle.idle, JSON.stringify(id).slice(0, 60));
  check('aegteOpslag: at og focused svarer i den aftalte form', typeof at.found === 'boolean' && typeof fo.focused === 'boolean',
        `${JSON.stringify(at).slice(0, 50)} · ${JSON.stringify(fo).slice(0, 50)}`);
  // press --dry er ogsaa et opslag (Astra R10): det rigtige svar, aldrig attrappens «intet blev udfoert».
  const dry = kald(ae, ['press', '--app', 'com.apple.finder', '--title', 'zzz ingen knap hedder saadan', '--dry']);
  check('aegteOpslag: press --dry naar den rigtige hjaelper (et svar, ikke et slugt kald)',
        !dry.note && (dry.would_press || dry.code), JSON.stringify(dry).slice(0, 90));
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
