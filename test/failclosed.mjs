// Bevis: svarer ingen paa dialogen, er svaret NEJ.
//
// Det er den eneste egenskab hvor en fejl er stille og alvorlig. En dialog
// der ender med "ja" fordi ingen saa den, ligner samtykke i loggen og er det
// ikke. Proeven saetter tidsgraensen til 2 sekunder, lader dialogen loebe ud,
// og kraever et afslag.
//
// MUTATIONSBEVIS 19/9 - koert, ikke husket: begge steder i policy.js hvor
// `gave up:true` bliver til `resolve(false)`, vendt til `resolve(true)`.
//   -> DUMPET 2 af 3 tjek. Og den muterede udgave KLIKKEDE faktisk
//      ("Klikkede i 5, 5"). Porten er det eneste der staar mellem
//      "ingen svarede" og "agenten handlede".
//
// ⛔ Foerste forsoeg var et NO-OP: jeg skrev `assert count == 1`, men strengen
//    findes TO steder (askHuman og askHumanToDo). Assertionen fejlede, filen
//    blev aldrig muteret, og proeven var groen mod ren kode. Det lignede et
//    bevis. Fanget fordi jeg sammenlignede md5 foer og efter i stedet for at
//    antage at gendannelsen var noedvendig.
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ⛔ 19/9: her stod at proeven springes over uden CMCP_DIALOGS=1, fordi den
//    ellers viste en aegte hvid boks. Resultatet var at produktets vigtigste
//    egenskab - at en ubesvaret dialog er et AFSLAG - var ubevist i naesten
//    hver koersel. MAALT i menneskets rigtige revisionslog: 323 gange paa to
//    dage blev han spurgt, 274 udloeb ubesvaret, og naesten alle kom fra
//    proevekoersler som denne.
//
//    Nu gaar spoergsmaalet gennem en ATTRAP (CMCP_OSASCRIPT). Hele vejen er
//    aegte: den rigtige port, det rigtige kald, den rigtige tolkning af svaret.
//    Kun selve vinduet er der ikke - og proeven koerer derfor HVER gang i
//    stedet for naesten aldrig.
//
//    ⚠️ Det ene der stadig kraever en aegte dialog: at osascript FAKTISK
//    skriver `gave up:true` efter `giving up after N`. Det er en OS-kontrakt,
//    ikke vores logik. Med CMCP_DIALOGS=1 koeres netop den, mod det rigtige
//    osascript - een boks, to sekunder.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⛔ FALSK HJAELPER (19/9): denne proeve beder om en AEGTE handling og regner
//    med at porten afviser den. Holder porten ikke, ville handlingen lande paa
//    menneskets skaerm - og proeven findes jo netop for det tilfaelde. Med
//    `CMCP_HELPER` peget paa en attrap kan en roed port ikke naa skaermen, og
//    proeven kan stadig se at handlingen kom.
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';
const attrap = lavFalskHjaelper('cmcp-failclosed');
// Med CMCP_DIALOGS=1 spoerges det RIGTIGE osascript - saa maales OS-kontrakten.
const AEGTE_DIALOG = process.env.CMCP_DIALOGS === '1';
const spoerger = AEGTE_DIALOG ? null : lavFalskSpoerger('udloeb', 'cmcp-failclosed-spoerger');
const env = { ...process.env, CMCP_MODE: 'ask', CMCP_ASK_TIMEOUT: '2',
              CMCP_STATE_DIR: process.env.CMCP_STATE_DIR
                || mkdtempSync(join(tmpdir(), 'cmcp-proevelog-')),
              CMCP_HELPER: attrap.sti,
              ...(spoerger ? { CMCP_OSASCRIPT: spoerger.sti } : {}) };
const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; const pending = new Map();
srv.stdout.on('data', d => { buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!l.trim()) continue; try { const m = JSON.parse(l);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} } });
let id = 0;
const rpc = (method, params = {}) => new Promise((res, rej) => {
  const my = ++id; pending.set(my, res);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
  setTimeout(() => { if (pending.has(my)) { pending.delete(my); rej(new Error('timeout ' + method)); } }, 90000);
});

const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const list = await rpc('tools/list');
  const names = (list.result?.tools || []).map(t => t.name);
  check('ask-tilstand viser haenderne', names.includes('computer_click'), `${names.length} vaerktoejer`);

  console.log(AEGTE_DIALOG
    ? '  (en AEGTE dialog vises i 2 sekunder og lukker sig selv - det er OS-kontrakten der maales)'
    : '  (spoergsmaalet gaar gennem en attrap - ingen boks; koer med CMCP_DIALOGS=1 for OS-kontrakten)');
  const t0 = Date.now();
  const r = await rpc('tools/call', { name: 'computer_click', arguments: { x: 5, y: 5 } });
  const txt = r.result?.content?.[0]?.text || '';
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  check('udloebet dialog = afslag', r.result?.isError === true, `${secs}s: ${txt.split('\n')[0]}`);
  check('afslaget siger hvorfor', /svarede ikke|sagde nej/.test(txt), txt.split('\n')[0]);
  // Uden dette tjek kunne proeven bestaa fordi porten afviste af en HELT anden
  // grund end at dialogen udloeb - og saa maaler den ikke det den hedder.
  if (spoerger) {
    check('og mennesket blev FAKTISK spurgt', spoerger.gangeSpurgt() === 1,
          `${spoerger.gangeSpurgt()} spoergsmaal`);
  } else {
    check('OS-kontrakten: osascript gav op af sig selv', /svarede ikke/.test(txt),
          'maalt mod det rigtige osascript');
  }
} catch (e) { console.log('DUMP:', e.message); fails.push(e.message); }
finally { srv.kill(); }
console.log(fails.length ? `\nDUMPET: ${fails.length}` : '\nBESTAAET');
process.exit(fails.length ? 1 : 0);
