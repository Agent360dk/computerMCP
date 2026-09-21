// De paastande der kan proeves uden adgang til skaerm eller
// tilgaengeligheds-API - altsaa dem en byggekoerer kan sige noget sandt om.
//
// Resten staar uproevet indtil et menneske koerer ./test/run-all.sh paa en Mac.
// En groen byggekoersel maa ikke kunne forveksles med en fuld proeve, saa
// CI'en siger hoejt hvad den IKKE har set.
import { readFileSync } from 'node:fs';
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

// 6. ⛔ KERNELOEFTET: den stille vej roerer ALDRIG markoeren.
//
//    Produktet siger: "It works in the windows behind the one you are using,
//    and leaves your pointer where you put it." Det er det vi saelger paa, og
//    det var UBEVIST indtil 21/9.
//
//    Foerste forsoeg paa en proeve maalte markoerens position foer og efter et
//    tryk. Den var ubrugelig: den blev roed fordi MENNESKET flyttede musen.
//    En proeve der kan brydes af at nogen aander, maaler ingenting.
//
//    Det her maaler reglen i stedet: alt der flytter en markoer gaar gennem
//    CGEvent med mouseEventSource/mouseCursorPosition, og det hoerer hjemme i
//    Input.swift. Accessibility.swift - hvor press, set_value og menu bor -
//    maa kun bruge tastatur-hændelser. Bryd det, og denne paastand bliver roed.
const ax = readFileSync(new URL('../helper/Sources/cmcp-helper/Accessibility.swift', import.meta.url), 'utf8');
const museKald = [...ax.matchAll(/mouseEventSource|mouseCursorPosition|CGWarpMouseCursorPosition|mouseMoved|leftMouseDown|rightMouseDown|otherMouseDown|leftMouseDragged/g)].map(m => m[0]);
check('den stille vej roerer aldrig markoeren',
      museKald.length === 0,
      museKald.length ? `Accessibility.swift kalder: ${[...new Set(museKald)].join(', ')}` : 'ingen muse-haendelser i Accessibility.swift');

console.log();
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
