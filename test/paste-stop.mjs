// PASTE-STOP: stopper den RIGTIGE hjaelper et paste, naar skaerm-laanet slutter?
//
// ⛔ HVORFOR DEN FINDES (runde 5, 1/10-2026, Astra 3)
//    Serveren sender SIGUSR1 til et paste der koerer, naar laanet slutter. Den falske
//    hjaelper (skaerm-laan 6f) beviser at signalet SENDES - ikke at Swift-siden
//    stopper. Her faar den rigtige hjaelper signalet, mens den venter paa teksten paa
//    stdin, og SKAL svare «stopped before anything changed» uden at have roert
//    udklipsholderen eller trykket Cmd+V.
//
// ⛔ KUN PAA EN FREMMED MASKINE: svigter stoppet, indsaettes teksten i det program
//    der er forrest. Paa menneskets Mac er det ikke en proeve, det er en skade.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
if (process.env.CMCP_FREMMED_MASKINE !== '1') {
  console.log('SPR. kun paa en fremmed maskine (CMCP_FREMMED_MASKINE=1) - et svigtende stop ville indsaette tekst');
  process.exit(0);
}
const HJ = [process.env.CMCP_HELPER, join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper'), join(ROOT, 'helper', '.build', 'release', 'cmcp-helper')]
  .filter(p => p && existsSync(p)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

const koer = (forsinkelseMs, tekstEfterMs = 300) => new Promise((res) => {
  const p = spawn(HJ, ['paste'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let ud = '';
  p.stdout.on('data', (d) => { ud += d; });
  p.on('close', (rc, sig) => res({ rc, sig, ud: ud.trim() }));
  setTimeout(() => {
    try { p.kill('SIGUSR1'); } catch {}
    const lever = () => { try { p.stdin.end('proeve-tekst der aldrig maa indsaettes'); } catch {} };
    if (tekstEfterMs === 0) lever(); else setTimeout(lever, tekstEfterMs);
  }, forsinkelseMs);
});

// 1. Signalet kommer mens hjaelperen venter paa teksten: den stopper foer noget er roert.
const r1 = await koer(800);
let j1 = {}; try { j1 = JSON.parse(r1.ud.split('\n').pop()); } catch {}
check('1 SIGUSR1 foer teksten: stoppet, intet aendret', j1.ok === false && j1.code === 'screen-taken-back' && /before anything changed/.test(j1.error || ''), r1.ud.slice(0, 160));

// 1b (efterkontrol, Astra): signalet og teksten i SAMME oejeblik - intet vindue for en
//    forsinket callback at overhale. Stoppet SKAL ses foer Cmd+V.
const r1b = await koer(800, 0);
let j1b = {}; try { j1b = JSON.parse(r1b.ud.split('\n').pop()); } catch {}
check('1b SIGUSR1 og teksten samtidig: stoppet foer Cmd+V', j1b.ok === false && j1b.code === 'screen-taken-back', r1b.ud.slice(0, 160));

// 2. Signalet kommer MED DET SAMME (maaske foer signalkilden findes): enten stoppet,
//    eller processen doer af signalet - aldrig et paste.
const r2 = await koer(0);
let j2 = {}; try { j2 = JSON.parse(r2.ud.split('\n').pop()); } catch {}
check('2 SIGUSR1 med det samme: stoppet eller doed af signalet - aldrig indsat', r2.sig === 'SIGUSR1' || (j2.ok === false && j2.code === 'screen-taken-back'),
      `sig=${r2.sig} ${r2.ud.slice(0, 120)}`);

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
