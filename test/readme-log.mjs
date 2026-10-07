// README'S LOG-UDDRAG ER LOGGEN SOM DEN ER (punkt L).
//
// ⛔ 7/10 (panel R8): uddraget skal vaere en byte-eksakt del af en committet log fra
//    en isoleret koersel, og den logs kaede skal holde. Aendres et tegn i uddraget
//    eller i loggen, er proeven roed. Loggen skrives af scripts/log-uddrag.mjs -
//    aldrig af et menneskes egen revisionslog.
import { readFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir, homedir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FASTE_OPSLAG } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const FIX = join(ROOT, 'test', 'fixtures', 'audit-readme.jsonl');
const fix = readFileSync(FIX, 'utf8');
const fixLinjer = fix.trim().split('\n');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const blokke = [...readme.matchAll(/<!-- log-uddrag:start -->\n```jsonl\n([\s\S]*?)\n```\n<!-- log-uddrag:end -->/g)];
check('README har praecis een log-uddrag-blok', blokke.length === 1, `${blokke.length}`);
const uddrag = (blokke[0]?.[1] || '').split('\n');

// 1. Byte for byte, i samme raekkefoelge, uden huller - saa kaeden kan foelges i uddraget.
const start = fixLinjer.indexOf(uddrag[0]);
const sammenhaengende = start >= 0 && uddrag.every((l, i) => fixLinjer[start + i] === l);
check('hver linje i uddraget staar byte for byte i loggen, i raekkefoelge', sammenhaengende,
      sammenhaengende ? `${uddrag.length} linjer fra linje ${start + 1}` : `foerste afvigende: ${(uddrag.find((l, i) => fixLinjer[start + i] !== l) || uddrag[0] || '').slice(0, 70)}`);
check('uddraget viser mindst et ja, et spoergsmaal uden svar og et nej', uddrag.length >= 3
      && uddrag.some(l => /"decision":"allowed"/.test(l))
      && uddrag.some(l => /"asked":true/.test(l) && /"decision":"denied"/.test(l))
      && uddrag.some(l => /"asked":false/.test(l) && /"decision":"denied"/.test(l)));

// 2. Loggens kaede holder - maalt med produktets egen kontrol, paa en kopi.
process.env.CMCP_STATE_DIR = mkdtempSync(join(tmpdir(), 'cmcp-readme-log-'));
copyFileSync(FIX, join(process.env.CMCP_STATE_DIR, 'audit.jsonl'));
const { kaedenHolder } = await import('../mcp-server/audit.js');
const k = kaedenHolder();
check('loggens kaede holder fra ende til anden', k.ok === true && k.checked === fixLinjer.length && k.aegte === 0 && k.gamle === 0,
      JSON.stringify(k));

// 3. Linjen med spoergsmaalet baerer serverens version - den skal vaere pakkens.
const version = JSON.parse(readFileSync(join(ROOT, 'mcp-server', 'package.json'), 'utf8')).version;
const servere = [...fix.matchAll(/"server":"([^"]+)"/g)].map(m => m[1]);
check('loggen er fra den version pakken udgiver (ellers: node scripts/log-uddrag.mjs)',
      servere.length > 0 && servere.every(v => v === version), `${servere.join(',') || 'ingen'} / ${version}`);

// 3b. README-sætningen om `presence` er bundet til hvor hvert felt kommer fra (Opus R10:
//     «målt på Mac'en» var usandt for fire af syv felter, og intet bandt sætningen).
const presence = [...fix.matchAll(/"presence":(\{[^}]*\})/g)].map(m => JSON.parse(m[1]));
check('presence: idle er attrappens faste svar, ikonet er stand-in med pakkens version, sessioner fra den isolerede mappe',
      presence.length > 0 && presence.every(p => p.idle_at_ask === FASTE_OPSLAG.idle.idle && p.idle_at_end === FASTE_OPSLAG.idle.idle
        && p.icon === version && p.sessions === 1 && p.surface_derived === (p.box === 'on' ? 'box+menu' : 'menu')), JSON.stringify(presence[0] || null));
const SAETNING = /In the `presence`\s+fields, the idle times come from the stand-in helper\s+and the icon version from the stand-in icon; the session count comes from the\s+isolated state, and the surface is derived\. Only the box setting was read from\s+the Mac that made the run\./;
check('README siger hvor hvert presence-felt kommer fra (samme ordlyd som felterne ovenfor)', SAETNING.test(readme));

// 4. Intet fra maskinen der skrev den.
check('loggen naevner hverken hjemmemappe eller maskinnavn', !fix.includes(homedir()) && !fix.includes(hostname()));

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
