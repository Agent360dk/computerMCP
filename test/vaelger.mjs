// VÆLGEREN: kan agenten pege på præcis ét felt uden navn, uden at gætte?
//
// ⛔ HVORFOR DEN FINDES (27/9-2026)
//    Chat 88 prøvede at skrive i Finders søgefelt. Feltet har intet navn, så den
//    eneste vej var `first: true`, og det første tekstfelt i Finder var et
//    FILNAVN. `set_value` havde omdøbt en fil. Et felt uden navn skal kunne
//    udpeges på sin undertype (subrole) eller sit nummer i listen (index), og
//    `set_value`, som overskriver tekst, må aldrig gætte med «det første».
//
// Kører på et prøvemål VI ejer (usynligt vindue uden for skærmen, se fixture).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HJAELPER = [process.env.CMCP_HELPER, join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper')].find(p => p && existsSync(p));
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
if (!HJAELPER) { console.log('UMAALT hjælperen findes ikke'); process.exit(0); }

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-vaelger-'));
const NAVN = 'cmcpvaelger' + Math.random().toString(36).slice(2, 8);
const MAAL = join(ARB, NAVN);
execFileSync('swiftc', ['-O', join(ROOT, 'test', 'fixture', 'proevemaal.swift'), '-o', MAAL], { stdio: 'pipe', timeout: 180000 });
const barn = spawn(MAAL, { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, CMCP_PROEVE_VAELGER: '1' } });
let pid = null;
await new Promise((res) => { barn.stdout.on('data', (b) => { const m = /pid=(\d+)/.exec(String(b)); if (m) { pid = Number(m[1]); res(); } }); setTimeout(res, 15000); });
const luk = () => { try { barn.kill(); } catch {} rmSync(ARB, { recursive: true, force: true }); };
if (!pid) { luk(); console.log('DUMP prøvemålet startede ikke'); process.exit(1); }

// Hjælperen svarer JSON både ved ok og ved fejl (exit 1); begge læses.
const koer = (...a) => { try { return JSON.parse(execFileSync(HJAELPER, a, { encoding: 'utf8', timeout: 60000 })); }
                          catch (e) { try { return JSON.parse(String(e.stdout)); } catch { return { ok: false, error: String(e.stdout || e.message).slice(0, 200) }; } } };
const vaerdier = () => (koer('find', '--app', NAVN, '--role', 'AXTextField', '--limit', '10').matches || []).map(m => m.name ?? '');

try {
  // Vent til de tre felter findes (belastet maskine: op til 60 sek).
  const frist = Date.now() + 60000;
  let felter = [];
  while (Date.now() < frist) { felter = koer('find', '--app', NAVN, '--role', 'AXTextField', '--limit', '10').matches || []; if (felter.length >= 3) break; await new Promise(r => setTimeout(r, 500)); }
  check('prøvemålet viser tre tekstfelter (et søgefelt og to uden navn)', felter.length === 3, JSON.stringify(felter.map(f => f.subrole || '-')));

  // 1. set_value med «det første» på flere felter: afvises, intet overskrives.
  const r1 = koer('set-value', '--app', NAVN, '--role', 'AXTextField', '--first', '--text', 'GAET');
  check('1 set_value gætter ikke med «det første» når flere felter passer', r1.ok === false && r1.code === 'ambiguous' && !vaerdier().includes('GAET'), JSON.stringify(r1).slice(0, 160));

  // 2. Undertypen udpeger søgefeltet og kun det.
  const r2 = koer('set-value', '--app', NAVN, '--role', 'AXTextField', '--subrole', 'AXSearchField', '--text', 'soeg-her');
  const efter2 = koer('find', '--app', NAVN, '--role', 'AXTextField', '--subrole', 'AXSearchField').matches || [];
  check('2 subrole AXSearchField skriver i søgefeltet', r2.ok === true && efter2.length === 1 && efter2[0].name === 'soeg-her', JSON.stringify(r2).slice(0, 160));
  check('2b ...og filnavnet står urørt', vaerdier().includes('filnavn.txt'), JSON.stringify(vaerdier()));

  // 3. Nummeret i listen udpeger præcis det felt, find viste på den plads.
  const liste = koer('find', '--app', NAVN, '--role', 'AXTextField', '--limit', '10').matches || [];
  const i = liste.findIndex(m => m.name === 'filnavn.txt');
  const r3 = koer('set-value', '--app', NAVN, '--role', 'AXTextField', '--index', String(i), '--text', 'valgt-med-nummer');
  check('3 index skriver i det felt, find viste på den plads', i >= 0 && r3.ok === true && vaerdier().includes('valgt-med-nummer') && vaerdier().includes('soeg-her'), JSON.stringify(r3).slice(0, 160));

  // 4. Et nummer der ikke findes, er en fejl.
  const r4 = koer('set-value', '--app', NAVN, '--role', 'AXTextField', '--index', '9', '--text', 'x');
  check('4 index uden for listen afvises', r4.ok === false && !vaerdier().includes('x'), JSON.stringify(r4).slice(0, 160));

  // 5. press med index trykker den knap, find viste på den plads.
  const knapper = koer('find', '--app', NAVN, '--role', 'AXButton', '--limit', '20').matches || [];
  const k = knapper.findIndex(m => m.name === 'ikke-trykket');
  const r5 = koer('press', '--app', NAVN, '--role', 'AXButton', '--index', String(k));
  const efter5 = (koer('find', '--app', NAVN, '--role', 'AXButton', '--limit', '20').matches || []).map(m => m.name);
  check('5 press med index trykker den rigtige knap', k >= 0 && r5.ok === true && efter5.includes('TRYKKET'), JSON.stringify(r5).slice(0, 160));
} finally { luk(); }

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
