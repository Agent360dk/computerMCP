// Foraeldre-vagten: doer chatten, doer serveren med.
//
// ⛔ HVORFOR DEN FINDES (23/9-2026)
//    MAALT paa maskinen: 34 statusfiler mod 15 levende serverprocesser. De 19
//    doede var chats der var lukket - men serveren var i flere tilfaelde ikke
//    doed MED dem. En efterladt server staar med tilgaengeligheds-rettigheder,
//    taeller med i «hvor mange agenter koerer», og kan ikke laengere faa svar
//    paa et godkendelses-spoergsmaal, fordi der ikke er nogen at spoerge.
//
//    Den normale vej - stdin lukker - daekker ikke en klient der bliver DRAEBT.
//
// ⛔ OG MAALT SAMME DAG, hvilket aendrede vagten: naar foraelderen doer,
//    adopterer launchd os, og `process.ppid` svarer **1** ved naeste opslag.
//    Det er et bedre signal end «lever klientens pid stadig», for et pid kan
//    genbruges af en fremmed proces. Proeve 5 og 6 koerer den aegte vej: et
//    barnebarn af en skal der doer.
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ledErDoedt, erForaeldreloes, startVagt } from '../mcp-server/vagt.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const fejl = (kode) => { const e = new Error(kode); e.code = kode; throw e; };

// 1. KALIBRERING af instrumentet mod to kendt-sande tilfaelde paa DENNE maskine.
//    Uden den maaler resten kun mine egne attrapper.
check('1a pid 1 (launchd) lever - EPERM maa ikke laeses som doed', ledErDoedt(1) === false);
check('1b vores egen pid lever', ledErDoedt(process.pid) === false);

// Et pid der beviseligt ikke findes: start noget, vent til det er hoestet.
const doedPid = spawnSync('/bin/sh', ['-c', 'exit 0']).pid;
check('1c et hoestet pid er doedt', ledErDoedt(doedPid) === true, `pid ${doedPid}`);

// 2. ESRCH er det ENESTE svar der betyder doed.
check('2a ESRCH  = doed', ledErDoedt(9, () => fejl('ESRCH')) === true);
check('2b EPERM  = lever', ledErDoedt(9, () => fejl('EPERM')) === false);
check('2c ukendt = lever (ved tvivl draeber vi ikke)', ledErDoedt(9, () => fejl('EWAT')) === false);
check('2d intet kast = lever', ledErDoedt(9, () => {}) === false);

// 3. Foraeldreloes-dommen.
const lever = () => { };
check('3a samme foraelder + levende = ikke foraeldreloes',
  erForaeldreloes(4711, () => 4711, lever) === false);
check('3b adopteret af launchd (ppid=1) = foraeldreloes',
  erForaeldreloes(4711, () => 1, lever) === true);
check('3c foraelderens pid er vaek = foraeldreloes',
  erForaeldreloes(4711, () => 4711, () => fejl('ESRCH')) === true);
check('3d startet AF launchd (start=1) = ingen chat at doe med',
  erForaeldreloes(1, () => 1, () => fejl('ESRCH')) === false);
check('3e ukendt start = ingen vagt',
  erForaeldreloes(0, () => 1, lever) === false);

// 4. startVagt: flaget, og at vagten faktisk fyrer.
let lukket = 0;
const stop1 = startVagt({ intervalMs: 5, start: 4711, nuPpid: () => 1, kill: lever,
  nuLuk: () => { lukket++; }, miljoe: {} });
await new Promise(r => setTimeout(r, 60));
stop1();
check('4a vagten lukkede en foraeldreloes server', lukket > 0, `${lukket} gange`);

let lukket2 = 0;
const stop2 = startVagt({ intervalMs: 5, start: 4711, nuPpid: () => 4711, kill: lever,
  nuLuk: () => { lukket2++; }, miljoe: {} });
await new Promise(r => setTimeout(r, 60));
stop2();
check('4b vagten lukker IKKE en levende chat', lukket2 === 0);

let lukket3 = 0;
startVagt({ intervalMs: 5, start: 4711, nuPpid: () => 1, kill: lever,
  nuLuk: () => { lukket3++; }, miljoe: { CMCP_INGEN_VAGT: '1' } });
await new Promise(r => setTimeout(r, 60));
check('4c CMCP_INGEN_VAGT=1 slaar vagten fra', lukket3 === 0);

// 5-6. DEN AEGTE VEJ: en rigtig proces, en rigtig doed foraelder, den rigtige
//      `luk` (process.exit). Attrapperne ovenfor beviser reglen; den her
//      beviser at signalet findes i virkeligheden.
const DIR = mkdtempSync(join(tmpdir(), 'cmcp-vagt-'));
const BARN = join(DIR, 'barn.mjs');
const MAERKE = join(DIR, 'lukkede');
writeFileSync(BARN, `
import { writeFileSync } from 'node:fs';
import { startVagt } from ${JSON.stringify(join(ROOT, 'mcp-server', 'vagt.js'))};
process.on('exit', () => { try { writeFileSync(${JSON.stringify(MAERKE)}, String(process.ppid)); } catch {} });
startVagt({ intervalMs: 50 });
setTimeout(() => process.exit(9), 8000);   // faldbag: staar den endnu, er vagten doed
`);
// Skallen doer efter 0,3 s; barnet bliver adopteret af launchd.
spawnSync('/bin/sh', ['-c', `${process.execPath} ${BARN} & sleep 0.3; exit 0`], { timeout: 10000 });
await new Promise(r => setTimeout(r, 1500));
check('5 serveren lukkede sig selv da foraelder-skallen doede', existsSync(MAERKE),
  existsSync(MAERKE) ? 'ppid ved exit: ' + readFileSync(MAERKE, 'utf8') : 'stod der endnu');

// 6. KALIBRERING DEN ANDEN VEJ: bliver skallen staaende, maa barnet blive.
const MAERKE2 = join(DIR, 'lukkede2');
const BARN2 = join(DIR, 'barn2.mjs');
writeFileSync(BARN2, `
import { writeFileSync } from 'node:fs';
import { startVagt } from ${JSON.stringify(join(ROOT, 'mcp-server', 'vagt.js'))};
process.on('exit', () => { try { writeFileSync(${JSON.stringify(MAERKE2)}, 'lukkede'); } catch {} });
startVagt({ intervalMs: 50 });
setTimeout(() => {}, 1200);
`);
spawnSync('/bin/sh', ['-c', `${process.execPath} ${BARN2}`], { timeout: 10000 });
check('6 en levende foraelder lukkede INGEN server for tidligt',
  readFileSync(MAERKE2, 'utf8').trim() === 'lukkede');
// (Den skrev maerket da den selv loeb ud - havde vagten fyret, var den doed foer.)

// 7. Serveren skal faktisk STARTE vagten. En vagt ingen kalder, er ingen vagt.
const idx = readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
check('7a index.js henter vagten', /from '\.\/vagt\.js'/.test(idx));
check('7b index.js starter vagten', /^\s*startVagt\(\);/m.test(idx));

rmSync(DIR, { recursive: true, force: true });
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
