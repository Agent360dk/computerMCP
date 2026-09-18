// De paastande der kan proeves uden adgang til skaerm eller
// tilgaengeligheds-API - altsaa dem en byggekoerer kan sige noget sandt om.
//
// Resten staar uproevet indtil et menneske koerer ./test/run-all.sh paa en Mac.
// En groen byggekoersel maa ikke kunne forveksles med en fuld proeve, saa
// CI'en siger hoejt hvad den IKKE har set.
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const { TOOLS, TOOL_BY_NAME } = await import(join(ROOT, 'mcp-server', 'tools.js'));
const policy = await import(join(ROOT, 'mcp-server', 'policy.js'));
const audit = await import(join(ROOT, 'mcp-server', 'audit.js'));

// 1. Ingen skal-, fil- eller URL-vaerktoejer er sneget ind
const forbidden = /exec|shell|command|run_|open_file|read_file|fetch|download|url/i;
const offenders = TOOLS.filter(t => forbidden.test(t.name));
check('ingen skal-, fil- eller URL-vaerktoejer', offenders.length === 0,
      offenders.length ? offenders.map(t => t.name).join(', ') : `${TOOLS.length} vaerktoejer gennemgaaet`);

// 2. Hvert vaerktoej baerer et niveau. Uden det kan inddelingen glide fra
//    hinanden uden at nogen opdager det.
const tierless = TOOLS.filter(t => !t.tier);
check('alle vaerktoejer har et niveau', tierless.length === 0,
      tierless.map(t => t.name).join(', ') || 'ingen uden');

// 3. Listen over programmer der altid spoerger, er ikke tom.
//    En tom liste ville bestaa alle andre proever og fjerne hele spaerren.
check('altid-spoerg-listen er ikke tom', policy.ALWAYS_ASK_APPS.size > 0,
      `${policy.ALWAYS_ASK_APPS.size} programmer`);

// 4. Revisionsloggen gemmer ikke det skrevne ordret.
const PROBE = 'AABBCC-maa-ikke-staa-i-loggen-112233';
const scrubbed = audit.scrubArgs({ text: PROBE, x: 10 });
const asText = JSON.stringify(scrubbed);
check('skrevet tekst gemmes ikke ordret', !asText.includes(PROBE), asText.slice(0, 80));
check('der gemmes laengde og fingeraftryk i stedet',
      scrubbed.text && scrubbed.text.length === PROBE.length && !!scrubbed.text.sha256_12,
      JSON.stringify(scrubbed.text));
check('andre felter gaar uroert igennem', scrubbed.x === 10);

// 5. Tilstandene findes og standarden er kendt.
check('tilstandene er readonly/auto/ask eller readonly/ask/allow',
      policy.MODES.size === 3, [...policy.MODES].join('/'));

console.log();
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
