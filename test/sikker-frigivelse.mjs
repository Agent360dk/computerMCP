// S2b · SIKKER FRIGIVELSE (18/10): et stop maa aldrig efterlade en museknap eller en tast NEDE.
//
// ⛔ HVORFOR DEN FINDES: et traek holder venstre knap nede i op til ~4,5 s (hold + op til 200 skridt).
//    Serveren stopper hjaelperen med SIGTERM, naar skaermlaanet slutter eller mennesket trykker
//    «Stop all agents now» - og foer S2b doede processen paa stedet: knappen blev staaende NEDE for hele
//    Mac'en. Nu blokerer hjaelperen SIGTERM, mens den sender haendelser, ser stoppet mellem dem, slipper
//    knappen og svarer «screen-taken-back».
//
// Proeven koerer den RIGTIGE hjaelper med proevekrogen CMCP_HJAELPER_ATTRAP: haendelserne skrives i en fil
// i stedet for at blive sendt - intet naar skaermen, markoeren eller noget program.
//   F1 kalibrering: et helt traek = 1 ned, alle skridt, 1 op
//   F2 SIGTERM midt i et traek: knappen slippes (sidste haendelse = op), processen gaar straks, «screen-taken-back»
//   F3 SIGTERM midt i en klikserie: lige mange ned og op
//   F4 en hjaelper der er gaaet i staa med SIGTERM blokeret, draebes alligevel ved fristen (SIGKILL 2 s efter)
//   F5 kildekontrakt: click, drag, type og key blokerer stoppet foerst
//   F6 kildekontrakt: hvert stoppested slipper det der er nede; stop og frist draeber blidt (SIGTERM, SIGKILL 2 s efter)
//   F7 stop foer foerste tryk: intet trykkes · F8 SIGINT/SIGHUP · F9 sikkerhedsnet efter SIGKILL · F10 krogens sti
import './ryd-op.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = ms => new Promise(r => setTimeout(r, ms));
// Den nyeste bygning (som ikon-boks: .build/release kan vaere aeldre end pakkens - eller omvendt).
// CMCP_FRIGIV_HJ: en bestemt bygning (kalibrering mod en hjaelper UDEN rettelsen).
const HJ = process.env.CMCP_FRIGIV_HJ || [join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper'), join(ROOT, 'helper', '.build', 'release', 'cmcp-helper')]
  .filter(p => existsSync(p)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const NED = 1, OP = 2, TRAEK = 6;   // CGEventType: leftMouseDown, leftMouseUp, leftMouseDragged

// `signal`: efter et antal ms, ELLER (`efterFoerste`) saa snart den foerste haendelse staar i loggen.
async function koer(argv, signalEfterMs = null, { signal = 'SIGTERM', efterFoerste = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cmcp-frigiv-'));
  const log = join(dir, 'haendelser.txt');
  const barn = spawn(HJ, argv, { env: { ...process.env, CMCP_HJAELPER_ATTRAP: log }, stdio: ['ignore', 'pipe', 'pipe'] });
  let ud = ''; barn.stdout.on('data', d => { ud += d; });
  let sendt = null;
  if (signalEfterMs != null) setTimeout(() => { sendt = Date.now(); barn.kill(signal); }, signalEfterMs);
  if (efterFoerste) (async () => { for (let i = 0; i < 400; i++) { if (existsSync(log) && readFileSync(log, 'utf8').length > 0) { sendt = Date.now(); barn.kill(signal); return; } await vent(2); } })();
  const slut = await new Promise(r => barn.on('exit', (kode, sig) => r({ kode, sig, t: Date.now() })));
  let h = [];
  try { h = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => Number(l.split(' ')[0])); } catch {}
  let svar = null; try { svar = JSON.parse(ud.trim().split('\n').pop()); } catch {}
  return { ...slut, h, svar, efterSignal: sendt ? slut.t - sendt : null };
}
const antal = (h, t) => h.filter(x => x === t).length;

if (!HJ) { console.log('SPR. ingen bygget hjaelper'); process.exit(0); }

// F1 kalibrering
{
  const r = await koer(['drag', '--from-x', '10', '--from-y', '10', '--to-x', '60', '--to-y', '60', '--steps', '20', '--hold-ms', '50']);
  check('F1 kalibrering: et helt traek - 1 ned, 20 skridt, 1 op, svar ok', r.kode === 0 && r.svar?.ok === true && antal(r.h, NED) === 1 && antal(r.h, TRAEK) === 20 && antal(r.h, OP) === 1 && r.h.at(-1) === OP,
    `kode=${r.kode} ned=${antal(r.h, NED)} traek=${antal(r.h, TRAEK)} op=${antal(r.h, OP)}`);
}

// F2 SIGTERM midt i et traek
{
  const r = await koer(['drag', '--from-x', '10', '--from-y', '10', '--to-x', '600', '--to-y', '600', '--steps', '200', '--hold-ms', '300'], 600);
  check('F2 et traek der stoppes midt i: knappen slippes (1 ned, 1 op, op til sidst), og svaret er «screen-taken-back»',
    antal(r.h, NED) === 1 && antal(r.h, OP) === 1 && r.h.at(-1) === OP && antal(r.h, TRAEK) < 200 && r.svar?.code === 'screen-taken-back',
    `ned=${antal(r.h, NED)} op=${antal(r.h, OP)} traek=${antal(r.h, TRAEK)} sidste=${r.h.at(-1)} kode=${r.svar?.code}`);
  check('F2b ...og processen gaar straks (under 200 ms efter stoppet)', r.efterSignal != null && r.efterSignal < 200, `${r.efterSignal} ms`);
}

// F3 SIGTERM midt i en klikserie
{
  const r = await koer(['click', '--x', '20', '--y', '20', '--count', '8'], 120);
  check('F3 en klikserie der stoppes: lige mange ned og op, serien blev afbrudt, og svaret er «screen-taken-back» med antallet (R49)',
    antal(r.h, NED) === antal(r.h, OP) && antal(r.h, NED) >= 1 && antal(r.h, NED) < 8 && r.svar?.code === 'screen-taken-back' && new RegExp(`clicked ${antal(r.h, NED)} of 8`).test(JSON.stringify(r.svar?.did)),
    `ned=${antal(r.h, NED)} op=${antal(r.h, OP)} kode=${r.svar?.code} did=${JSON.stringify(r.svar?.did)}`);
}

// F7 (R49 Opus R1, MAALT 15/15): et stop EFTER blokeringen men FOER foerste tryk - intet trykkes (foer: et klik paa startpunktet).
{
  const r = await koer(['drag', '--from-x', '10', '--from-y', '10', '--to-x', '300', '--to-y', '300', '--steps', '50', '--hold-ms', '100'], null, { efterFoerste: true });
  check('F7 et stop lige efter traekkets foerste bevaegelse: knappen trykkes aldrig, svaret er «screen-taken-back»', antal(r.h, NED) === 0 && antal(r.h, OP) === 0 && r.svar?.code === 'screen-taken-back',
    `haendelser=${r.h.join(',')} kode=${r.svar?.code}`);
  const k = await koer(['click', '--x', '20', '--y', '20', '--count', '1'], null, { efterFoerste: true });
  check('F7b et stop lige efter klikkets bevaegelse: intet klik, svaret er «screen-taken-back»', antal(k.h, NED) === 0 && k.svar?.code === 'screen-taken-back', `haendelser=${k.h.join(',')} kode=${k.svar?.code}`);
}

// F8 (R49 Opus R8 + Astra 3/3): SIGINT og SIGHUP midt i et traek slipper ogsaa knappen.
for (const sig of ['SIGINT', 'SIGHUP']) {
  const r = await koer(['drag', '--from-x', '10', '--from-y', '10', '--to-x', '600', '--to-y', '600', '--steps', '200', '--hold-ms', '300'], 600, { signal: sig });
  check(`F8 ${sig} midt i et traek: knappen slippes`, antal(r.h, NED) === 1 && antal(r.h, OP) === 1 && r.h.at(-1) === OP, `ned=${antal(r.h, NED)} op=${antal(r.h, OP)}`);
}

// F9 (R49 Astra, MAALT med SIGSTOP: 1 ned, 0 op): en hjaelper der staar stille midt i et traek og maa draebes haardt -
//    serveren lader en ny hjaelper slippe knappen. Gennem den RIGTIGE serverkode (callHelper + afbrydSkaermKald).
{
  const dir = mkdtempSync(join(tmpdir(), 'cmcp-frigiv-net-'));
  const log = join(dir, 'haendelser.txt');
  const gemt = { h: process.env.CMCP_HELPER, a: process.env.CMCP_HJAELPER_ATTRAP };
  process.env.CMCP_HELPER = HJ; process.env.CMCP_HJAELPER_ATTRAP = log;
  const { callHelper, afbrydSkaermKald } = await import(join(ROOT, 'mcp-server', 'helper.js'));
  const svar = callHelper(['drag', '--from-x', '11', '--from-y', '13', '--to-x', '600', '--to-y', '600', '--steps', '200', '--hold-ms', '1500'], { timeout: 20000 }).then(() => 'ok', e => e.code);
  for (let i = 0; i < 300 && !(existsSync(log) && readFileSync(log, 'utf8').split('\n').some(l => l.startsWith('1 '))); i++) await vent(10);
  const pid = Number(execFileSync('pgrep', ['-f', 'drag --from-x 11 --from-y 13'], { encoding: 'utf8' }).trim().split('\n')[0]);
  process.kill(pid, 'SIGSTOP');                 // hjaelperen kan nu ikke selv slippe
  afbrydSkaermKald();                           // laanet slutter / Stop all
  await Promise.race([svar, vent(8000)]);       // uden SIGKILL ville kaldet haenge - proeven maa ikke
  await vent(1500);                             // sikkerhedsnettet (release-mouse) naar at koere
  try { process.kill(pid, 'SIGKILL'); } catch { /* allerede vaek */ }
  const h = readFileSync(log, 'utf8').trim().split('\n').map(l => Number(l.split(' ')[0]));
  check('F9 et traek der maa draebes haardt (SIGKILL efter 2 s): en ny hjaelper slipper knappen', antal(h, NED) === 1 && antal(h, OP) === 1 && h.at(-1) === OP, `haendelser=${h.join(',')}`);
  if (gemt.h === undefined) delete process.env.CMCP_HELPER; else process.env.CMCP_HELPER = gemt.h;
  if (gemt.a === undefined) delete process.env.CMCP_HJAELPER_ATTRAP; else process.env.CMCP_HJAELPER_ATTRAP = gemt.a;
}

// F10 (R49 Astra, MAALT): proevekrogen skriver kun i en midlertidig mappe og aldrig gennem et symbolsk link.
{
  // R50 (Opus): stien skal ligge UDEN FOR alle tilladte rødder, ogsaa naar repoet selv ligger i /tmp - hjemmemappen.
  //    Og kommandoen er et rul paa 0 (harmloest), saa en krog der fejlede aaben, intet ville goere.
  const udenfor = join(homedir(), `.cmcp-attrap-proeve-${process.pid}`);
  const b1 = spawn(HJ, ['scroll', '--dx', '0', '--dy', '0'], { env: { ...process.env, CMCP_HJAELPER_ATTRAP: udenfor }, stdio: 'ignore' });
  await new Promise(r => b1.on('exit', r));
  const dir = mkdtempSync(join(tmpdir(), 'cmcp-frigiv-link-'));
  const maal = join(dir, 'maal.txt'); writeFileSync(maal, 'urort\n');
  const link = join(dir, 'link.txt'); symlinkSync(maal, link);
  const b2 = spawn(HJ, ['scroll', '--dx', '0', '--dy', '0'], { env: { ...process.env, CMCP_HJAELPER_ATTRAP: link }, stdio: 'ignore' });
  await new Promise(r => b2.on('exit', r));
  const fandtes = existsSync(udenfor); if (fandtes) { try { unlinkSync(udenfor); } catch {} }
  check('F10 krogen skriver ikke uden for den midlertidige mappe, og ikke gennem et symbolsk link', !fandtes && readFileSync(maal, 'utf8') === 'urort\n', `udenfor=${fandtes} maal=${JSON.stringify(readFileSync(maal, 'utf8'))}`);
}

// F4 fristen draeber en hjaelper, der er gaaet i staa med SIGTERM blokeret
{
  const dir = mkdtempSync(join(tmpdir(), 'cmcp-frigiv-staa-'));
  const falsk = join(dir, 'staa.sh');
  writeFileSync(falsk, '#!/bin/sh\ntrap "" TERM\nexec sleep 30\n');   // exec: én proces, som en rigtig hjaelper
  chmodSync(falsk, 0o755);
  process.env.CMCP_HELPER = falsk;
  const { callHelper } = await import(join(ROOT, 'mcp-server', 'helper.js'));
  const t0 = Date.now();
  const r = await Promise.race([callHelper(['apps'], { timeout: 500 }).then(() => 'svar', e => e.code), vent(8000).then(() => 'hang')]);
  const ms = Date.now() - t0;
  check('F4 en hjaelper i staa med SIGTERM blokeret draebes ved fristen (SIGKILL 2 s efter) - kaldet haenger ikke', r === 'helper-timeout' && ms < 4000, `${r} efter ${ms} ms`);
}

// F4b (R49 Opus R5): et svar hjaelperen naaede at give efter fristen (fx et halvt `type`), vinder over «did not answer».
{
  const dir = mkdtempSync(join(tmpdir(), 'cmcp-frigiv-sent-'));
  const falsk = join(dir, 'sent.sh');
  writeFileSync(falsk, '#!/bin/sh\ntrap "" TERM\nsleep 1\necho \'{"ok":false,"code":"screen-taken-back","error":"stopped after 3 of 9 characters","typed":3}\'\nexit 1\n');
  chmodSync(falsk, 0o755);
  const gemt = process.env.CMCP_HELPER; process.env.CMCP_HELPER = falsk;
  const { callHelper } = await import(join(ROOT, 'mcp-server', 'helper.js'));
  const r = await callHelper(['type'], { timeout: 300 }).then(() => null, e => e);
  check('F4b et svar efter SERVERENS frist: koden er «helper-timeout» (ikke «laanet sluttede»), og det halve bevares (R50 Opus N1)', r?.code === 'helper-timeout' && r?.extra?.typed === 3, `${r?.code} · ${JSON.stringify(r?.extra)}`);
}

// F4c (R50): stoppes hjaelperen af laanet/Stop all (afbrydSkaermKald) og svarer «screen-taken-back», bevares DEN kode.
{
  const dir = mkdtempSync(join(tmpdir(), 'cmcp-frigiv-laan-'));
  const falsk = join(dir, 'laan.mjs');
  writeFileSync(falsk, `#!${process.execPath}\nprocess.on('SIGTERM', () => { process.stdout.write(JSON.stringify({ ok: false, code: 'screen-taken-back', error: 'stopped after 2 of 9 characters', typed: 2 }) + '\\n', () => process.exit(1)); });\nsetTimeout(() => {}, 15000);\n`);
  chmodSync(falsk, 0o755);
  const gemt = process.env.CMCP_HELPER; process.env.CMCP_HELPER = falsk;
  const { callHelper, afbrydSkaermKald } = await import(join(ROOT, 'mcp-server', 'helper.js'));
  const p = callHelper(['type'], { timeout: 10000 }).then(() => null, e => e);
  await vent(1200); afbrydSkaermKald();   // attrappen (node) skal naa at saette sin SIGTERM-haandtering op
  const r = await p;
  check('F4c et stop gennem laanet/Stop all bevarer «screen-taken-back» og det halve', r?.code === 'screen-taken-back' && r?.extra?.typed === 2, `${r?.code} · ${JSON.stringify(r?.extra)}`);
  if (gemt === undefined) delete process.env.CMCP_HELPER; else process.env.CMCP_HELPER = gemt;
  if (gemt === undefined) delete process.env.CMCP_HELPER; else process.env.CMCP_HELPER = gemt;
}

// F5 kildekontrakt: kommandoerne der sender haendelser, blokerer stoppet foerst
{
  const m = readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'main.swift'), 'utf8');
  const ok = ['click', 'drag', 'type', 'key'].every(k => new RegExp(`case "${k}":\\n    Input\\.blokerStop\\(\\)`).test(m));
  check('F5 click, drag, type og key blokerer stoppet foer de sender noget', ok);
}

// F6 kildekontrakt: hvert sted et trin kan stoppe, slipper det der er nede (Swift-mutanter genbygges ikke af gaten,
//    saa bindingen sker her - F2 er kalibreret mod en bygning UDEN rettelsen: 1 ned, 0 op).
{
  const inp = readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'Input.swift'), 'utf8');
  const hj = readFileSync(join(ROOT, 'mcp-server', 'helper.js'), 'utf8');
  check('F6 traekket slipper knappen baade under holdet og under skridtene; klik og tegn stopper mellem par; stop og frist draeber blidt',
    /while holdt > 0 \{\n\s+if stopVenter \{ slipKnap\(start, start\); return \.stoppet \}/.test(inp)
    && /for i in 1\.\.\.n \{\n\s+if stopVenter \{ slipKnap\(her, start\); return \.stoppet \}/.test(inp)
    && /if stopVenter \{ return i - 1 \}/.test(inp) && /if stopVenter \{ return sendt \}/.test(inp)
    && /if stopVenter \{ return 0 \}   \/\/ R49/.test(inp) && /if stopVenter \{ return \.ikkeBegyndt \}   \/\/ R49: et stop under opslagene/.test(inp)
    && /\/\/ R49 \(Opus R1\): et stop under opslagene ovenfor - tasten sendes ikke\.\n\s+if Input\.stopVenter \{ Out\.fail/.test(readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'main.swift'), 'utf8'))
    && /\/\/ R49 \(Opus R1\): et stop under opslagene ovenfor - intet skrives, heller ikke gennem tilgaengeligheds-laget\.\n\s+if Input\.stopVenter \{/.test(readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'main.swift'), 'utf8'))
    && /if klikGjort < klikAntal \{\n\s+Out\.fail\(/.test(readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'main.swift'), 'utf8'))
    && /private static let stopSignaler: \[Int32\] = \[SIGTERM, SIGINT, SIGHUP\]/.test(inp)
    && /if attrapStiTilladt\(fil\) \{/.test(inp) && /O_WRONLY \| O_APPEND \| O_CREAT \| O_NOFOLLOW/.test(inp)
    && /usleep\(60_000\)\n\s+if stopVenter \{ slipKnap\(slut, start\); return \.stoppet \}/.test(inp)
    && /guard session && !fysisk else \{ return false \}/.test(inp)
    && /guard !Input\.stopVenter else \{ return nil \}\n\s+guard AXUIElementSetAttributeValue\(el, kAXSelectedTextAttribute/.test(readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'Accessibility.swift'), 'utf8'))
    && /var tastMaal = Skaerm\.maalt\(tilPid: tastPid\) \{\n\s+if Input\.stopVenter \{ tastStoppet = true; return \}/.test(readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'main.swift'), 'utf8'))
    && (() => { const mm = readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'main.swift'), 'utf8'); const g = mm.indexOf('let tilbage = Skaerm.givTilbage(foer: klikFoer'), f = mm.indexOf('    if klikGjort < klikAntal {'); return g > 0 && f > g; })()
    && /else \{ draebBlidt\(child\); n\+\+; \}/.test(hj) && /const fristUr = setTimeout\(\(\) => \{ udloebet = true; draebBlidt\(child\); \}, timeout\);/.test(hj));
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
