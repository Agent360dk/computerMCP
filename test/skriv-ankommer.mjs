// SKRIV-ANKOMMER: når tekst til et program, der IKKE er forrest, faktisk frem?
//
// ⛔ HVORFOR DEN FINDES (27/9-2026)
//    Chat 88 skrev i Finders søgefelt med `type --app`; produktet svarede «skrevet»,
//    og intet kom frem. Tastetryk til et programs egen kø lander kun, hvis programmet
//    har et nøglevindue - og det har et program i baggrunden ofte ikke. e2e-forloeb
//    var rød 2 af 5 gange på netop «teksten ankom» 25/9.
//    Nu skrives der i programmets fokuserede felt gennem tilgængeligheds-laget, og
//    feltet læses tilbage. Et kodeordsfelt tager aldrig den vej.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HJAELPER = [process.env.CMCP_HELPER, join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper')].find(p => p && existsSync(p));
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const koer = (...a) => { try { return JSON.parse(execFileSync(HJAELPER, a, { encoding: 'utf8', timeout: 60000 })); }
                          catch (e) { try { return JSON.parse(String(e.stdout)); } catch { return { ok: false, error: String(e.stdout || e.message).slice(0, 200) }; } } };

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-skriv-'));
const MAAL = join(ARB, 'bin');
execFileSync('swiftc', ['-O', join(ROOT, 'test', 'fixture', 'proevemaal.swift'), '-o', MAAL], { stdio: 'pipe', timeout: 180000 });
const boern = [];
async function start(env) {
  const navn = 'cmcpskriv' + Math.random().toString(36).slice(2, 8);
  const sti = join(ARB, navn); execFileSync('cp', [MAAL, sti]);
  const b = spawn(sti, { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...env } }); boern.push(b);
  await new Promise((res) => { b.stdout.on('data', (d) => { if (/pid=/.test(String(d))) res(); }); setTimeout(res, 15000); });
  const frist = Date.now() + 60000;
  while (Date.now() < frist) { if ((koer('find', '--app', navn, '--role', 'AXTextField', '--limit', '5').matches || []).length) break; await new Promise(r => setTimeout(r, 500)); }
  return navn;
}
const feltet = (navn) => ((koer('find', '--app', navn, '--role', 'AXTextField', '--limit', '5').matches || [])[0] || {}).name || '';

try {
  const navn = await start({});
  // 1. Fem gange i træk: hver tekst skal stå i feltet bagefter.
  let alle = true, sidst = null;
  for (let i = 0; i < 5; i++) {
    const t = `ankom${i}-` + Math.random().toString(36).slice(2, 6);
    sidst = koer('type', '--app', navn, '--text', t);
    if (!(sidst.ok && sidst.verified === true && feltet(navn).includes(t))) { alle = false; break; }
  }
  check('1 tekst til et program der ikke er forrest når frem, fem gange i træk', alle, JSON.stringify(sidst).slice(0, 180));
  check('1b ...gennem tilgængeligheds-laget, uden at tage skærmen', sidst?.method === 'accessibility' && sidst?.took_screen === false, JSON.stringify(sidst).slice(0, 180));

  // 2. Den gamle vej kan stadig vælges, og den siger ærligt, at den ikke er efterprøvet.
  const r2 = koer('type', '--app', navn, '--keystrokes', '--text', 'x');
  check('2 --keystrokes sender tastetryk og siger «ikke efterprøvet»', r2.ok && r2.method === 'keystrokes' && r2.verified === false, JSON.stringify(r2).slice(0, 160));

  // 3. Et kodeordsfelt med fokus: aldrig tilgængeligheds-vejen.
  const sikker = await start({ CMCP_PROEVE_SIKKER: '1' });
  const r3 = koer('type', '--app', sikker, '--text', 'hemmelig123');
  check('3 et kodeordsfelt får aldrig tekst sat ind gennem tilgængeligheds-laget', r3.method !== 'accessibility', JSON.stringify(r3).slice(0, 160));
  // 3b. Et kodeordsfelt som på en webside (AXTextField med undertypen AXSecureTextField).
  //     macOS beskytter ikke dette; kun vores egen vagt gør.
  const web = await start({ CMCP_PROEVE_SIKKER: 'web' });
  const r3b = koer('type', '--app', web, '--text', 'hemmelig456');
  check('3b et kodeordsfelt som på en webside får heller ikke den vej', r3b.method !== 'accessibility', JSON.stringify(r3b).slice(0, 160));
} finally {
  for (const b of boern) { try { b.kill(); } catch {} }
  rmSync(ARB, { recursive: true, force: true });
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
