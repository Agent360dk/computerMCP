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
import './ryd-op.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

async function koer(argv, signalEfterMs = null) {
  const dir = mkdtempSync(join(tmpdir(), 'cmcp-frigiv-'));
  const log = join(dir, 'haendelser.txt');
  const barn = spawn(HJ, argv, { env: { ...process.env, CMCP_HJAELPER_ATTRAP: log }, stdio: ['ignore', 'pipe', 'pipe'] });
  let ud = ''; barn.stdout.on('data', d => { ud += d; });
  let sendt = null;
  if (signalEfterMs != null) setTimeout(() => { sendt = Date.now(); barn.kill('SIGTERM'); }, signalEfterMs);
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
  check('F3 en klikserie der stoppes: lige mange ned og op, og serien blev afbrudt', antal(r.h, NED) === antal(r.h, OP) && antal(r.h, NED) >= 1 && antal(r.h, NED) < 8,
    `ned=${antal(r.h, NED)} op=${antal(r.h, OP)}`);
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
    /while holdt > 0 \{\n\s+if stopVenter \{ slipKnap\(start\); return false \}/.test(inp)
    && /for i in 1\.\.\.n \{\n\s+if stopVenter \{ slipKnap\(her\); return false \}/.test(inp)
    && /if i > 1 && stopVenter \{ return \}/.test(inp) && /if stopVenter \{ return sendt \}/.test(inp)
    && /else \{ draebBlidt\(child\); n\+\+; \}/.test(hj) && /const fristUr = setTimeout\(\(\) => \{ udloebet = true; draebBlidt\(child\); \}, timeout\);/.test(hj));
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
