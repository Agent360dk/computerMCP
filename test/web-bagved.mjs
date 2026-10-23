import './ryd-op.mjs';   // 11/10: mapperne ryddes altid, ogsaa ved dumpet og afbrudt
// WEB-BAGVED: en webside i et program BAGVED kan laeses, udfyldes og bruges - uden at noget kommer frem.
//
// ⛔ HVORFOR DEN FINDES (14/10-2026, Gustav: «den burde jo kunne alt uden at skulle laane skaermen»)
//    Maalt i et WebKit-proevemaal (Safaris motor) bagved: siden, felterne, knappen og linket ses, tryk og
//    link virker - men `set_value` i et tekstfelt svarede «set-ignored»: WebKit tager kun imod vaerdien,
//    naar feltet har fokus. Fokus foerst, saa vaerdien: teksten stod i feltet, og formularen blev sendt.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HJ = [process.env.CMCP_HELPER, join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper')].find(p => p && existsSync(p));
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const koer = (a, stdin) => { try { return JSON.parse(execFileSync(HJ, a, { encoding: 'utf8', timeout: 60000, input: stdin })); }
  catch (e) { try { return JSON.parse(String(e.stdout)); } catch { return { ok: false, error: String(e.stdout || e.message).slice(0, 200) }; } } };
const vent = (ms) => new Promise(r => setTimeout(r, ms));
const forrest = () => { try { return execFileSync('osascript', ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'], { encoding: 'utf8' }).trim(); } catch { return '?'; } };

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-web-'));
writeFileSync(join(ARB, 'side.html'), `<!doctype html><html><head><meta charset="utf-8"><title>PROEVE START</title></head><body>
<label for="navn">Navn</label><input id="navn" aria-label="Navn">
<label for="kode">Kode</label><input id="kode" type="password" aria-label="Kode">
<button onclick="document.title='SENDT:'+document.getElementById('navn').value+':'+document.getElementById('kode').value.length">Send formularen</button>
<a href="side2.html">Naeste side</a></body></html>`);
writeFileSync(join(ARB, 'side2.html'), '<!doctype html><html><head><meta charset="utf-8"><title>SIDE 2</title></head><body>Side 2</body></html>');
const navn = 'cmcpweb' + Math.random().toString(36).slice(2, 7);
execFileSync('swiftc', ['-O', join(ROOT, 'test', 'fixture', 'webside.swift'), '-o', join(ARB, navn)], { stdio: 'pipe', timeout: 240000 });
let titel = '';
const barn = spawn(join(ARB, navn), [join(ARB, 'side.html')], { stdio: ['ignore', 'pipe', 'ignore'] });
barn.stdout.on('data', d => { const m = String(d).match(/TITEL:(.*)/g); if (m) titel = m[m.length - 1].slice(6).trim(); });
try {
  for (const frist = Date.now() + 30000; Date.now() < frist && titel !== 'PROEVE START'; ) await vent(300);
  for (const frist = Date.now() + 30000; Date.now() < frist; await vent(300)) if ((koer(['find', '--app', navn, '--role', 'AXButton', '--limit', '1']).matches || []).length) break;
  const foer = forrest();
  const felter = koer(['find', '--app', navn, '--role', 'AXTextField', '--limit', '5']).matches || [];
  check('1 siden ses bagved: felterne Navn og Kode, og Kode er et kodeordsfelt',
    felter.some(f => f.name === 'Navn') && felter.some(f => f.name === 'Kode' && f.subrole === 'AXSecureTextField'), JSON.stringify(felter.map(f => [f.name, f.subrole])));
  const s = koer(['set-value', '--app', navn, '--role', 'AXTextField', '--match-stdin'], JSON.stringify({ title: 'Navn', text: 'Gustav test' }));
  check('2 set_value i et webfelt bagved: teksten staar i feltet (laest tilbage)', s.ok === true && s.verified === true, JSON.stringify(s).slice(0, 200));
  const k = koer(['set-value', '--app', navn, '--role', 'AXTextField', '--match-stdin'], JSON.stringify({ title: 'Kode', text: 'hemmelig' }));
  check('3 kodeordsfeltet paa siden faar aldrig tekst', k.ok === false && k.code === 'secure-field', JSON.stringify(k).slice(0, 160));
  koer(['press', '--app', navn, '--role', 'AXButton', '--title', 'Send formularen']);
  for (const frist = Date.now() + 5000; Date.now() < frist && !titel.startsWith('SENDT'); ) await vent(200);
  check('4 knappen trykkes bagved, og siden fik navnet - og INTET kodeord (laest af siden selv)', titel === 'SENDT:Gustav test:0', titel);
  koer(['press', '--app', navn, '--role', 'AXLink', '--title', 'Naeste side']);
  for (const frist = Date.now() + 5000; Date.now() < frist && titel !== 'SIDE 2'; ) await vent(200);
  check('5 linket foelges bagved', titel === 'SIDE 2', titel);
  check('6 forreste program er uaendret hele vejen', forrest() === foer, `${foer} → ${forrest()}`);
  const m = readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'main.swift'), 'utf8');
  check('7 set-value: tager feltet ikke imod vaerdien, saettes fokus i SAMME felt, og der skrives og laeses igen',
    /if let e = efter, e != sv, AX\.fokuserOgSaet\(t\.el, sv\) \{/.test(m));
} finally { try { barn.kill(); } catch {} }
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
