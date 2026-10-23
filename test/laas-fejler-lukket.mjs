// M1 (28/9): programlåsen fejler LUKKET ved en infra-fejl.
//
// ⛔ HVORFOR DEN FINDES
//    programlaas.js:45 kørte FØR handlingen alligevel (fail-open), hvis låsen
//    ikke kunne tages af en anden grund end "optaget" (EEXIST). En låse-mappe
//    der bliver en fil giver ENOTDIR - og så skrev to agenter i flæng i samme
//    program, netop det låsen skal forhindre. Prøven tvinger ENOTDIR frem og
//    kræver, at handlingen AFVISES (ok:false), ikke udføres.
import './ryd-op.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

// Gør 'laase'-stien til en FIL, så openSync inde i den giver ENOTDIR (ikke EEXIST).
const base = mkdtempSync(join(tmpdir(), 'cmcp-laas-'));
writeFileSync(join(base, 'laase'), 'jeg er en fil, ikke en mappe');
process.env.CMCP_STATE_DIR = base;

// DIR læses ved modul-load fra env, så env SKAL sættes før import.
const { medProgramLaas } = await import('../mcp-server/programlaas.js');

let kørt = false;
const r = await medProgramLaas('com.apple.TextEdit', async () => { kørt = true; return 'skulle-ikke-ske'; });

check('1 laasen fejler LUKKET (ok:false), ikke aaben', r.ok === false, JSON.stringify(r));
check('2 handlingen blev IKKE udfoert', kørt === false);
check('3 afslaget siger hvorfor (infra, ikke contention)', /could not be taken|serialised/.test(r.grund || ''), r.grund);

// Kontrol: en ren mappe låser og kører handlingen som normalt.
const base2 = mkdtempSync(join(tmpdir(), 'cmcp-laas-ok-'));
process.env.CMCP_STATE_DIR = base2;
const { medProgramLaas: laas2 } = await import('../mcp-server/programlaas.js?ren');
let kørt2 = false;
const r2 = await laas2('com.apple.TextEdit', async () => { kørt2 = true; return 42; });
check('4 en ren mappe laaser og koerer handlingen', r2.ok === true && r2.vaerdi === 42 && kørt2 === true, JSON.stringify(r2));

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
