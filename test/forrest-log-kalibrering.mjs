// Forrest-loggens kalibrering: afspiller macOS' egen log fra koerslen paa Gustavs Mac
// 1/10-2026 (16:48-16:55 maskintid WITA) og kraever de tre domme konsulent-panelet fandt.
//
// ⛔ HVORFOR DEN FINDES: den gamle vagt (NSWorkspace i en osascript-loekke) saa 1 skift
//    pr. runde, mens loggen havde 26 - og kaldte en runde groen, hvor Skak stod forrest.
//    Et instrument der ikke kan blive roedt paa den kendte fejl, maaler intet.
//    Intet startes, intet laeses fra skaermen: kun en gemt logfil.
import './ryd-op.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tolk, parSkift, doem } from './forrest-log.mjs';

const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const fil = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'forrest-log-1-10.ndjson');
const skift = parSkift(readFileSync(fil, 'utf8').split('\n').map(tolk).filter(Boolean));
// Agenternes programmer i koerslen (pids fra macOS' processmanager-log).
const AGENT = new Set([62766, 62888, 62984, 63975, 64022, 65698, 65808]);
const t = (hms) => Date.parse(`2026-10-01T${hms}+08:00`);
const runde = (fra, til) => doem(skift.filter(s => s.t >= t(fra) && s.t <= t(til)), p => AGENT.has(p));

check('0 loggen har de 26 skift', skift.length === 26, String(skift.length));
const r5 = runde('16:48:43', '16:49:39'), r10 = runde('16:49:40', '16:51:02'), r15 = runde('16:51:04', '16:53:58');
check('5 rød: skærmen revet tilbage + Skak forrest', r5.length === 2
  && r5.some(f => f.slags === 'trak forgrunden tilbage fra mennesket') && r5.some(f => f.slags === 'agent-program forrest' && f.pid === 62888),
  JSON.stringify(r5.map(f => f.slags)));
check('10 rød: skærmen revet tilbage', r10.length === 1 && r10[0].slags === 'trak forgrunden tilbage fra mennesket', JSON.stringify(r10.map(f => f.slags)));
check('15 grøn: kun menneskets egne skrivebordsskift', r15.length === 0, JSON.stringify(r15));
// Menneskets egne skift er aldrig en fejl - ellers kan proeven ikke koere paa en Mac i brug.
check('mennesket: 9 skrivebordsskift i 15-runden giver ingen fund',
  skift.filter(s => s.t >= t('16:51:04') && s.t <= t('16:53:58') && s.aarsag === 'SetManagedDisplayCurrentSpace').length === 9);

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
