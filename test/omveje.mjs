// OMVEJE: siger computer_permissions hvor klienten lader en agent handle UDEN
// om denne server?
//
// ⛔ HVORFOR DEN FINDES (29/9-2026, panelet: B6)
//    Samtykke-porten vogter denne servers egne kald. En `Bash(osascript ...)` eller
//    en browser-automation med klik/udfyld i klientens allow-liste gaar helt uden
//    om - og porten saa ud som et faengsel, den ikke er. Nu naevnes de regler.
//    Proeven bruger en MIDLERTIDIG indstillingsfil, aldrig menneskets rigtige.
import './ryd-op.mjs';
import './egen-tilstand.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-omveje-'));
const MED = join(ARB, 'med.json'), UDEN = join(ARB, 'uden.json');
writeFileSync(MED, JSON.stringify({ permissions: { allow: [
  'Bash(osascript -e \' *)', 'mcp__browser-mcp__browser_click', 'mcp__browser-mcp__browser_fill', 'Bash(*)',
  'Bash(git status)', 'mcp__computer-mcp__computer_find', 'mcp__browser-mcp__browser_screenshot', 'Read(HEMMELIG-STI)',
  // Runde 1 30/9 (Fable P5): skaller, fortolkere og en hel browser-server - stod i husets egne indstillinger.
  'Bash(bash *)', 'Bash(zsh *)', 'Bash(python3 *)', 'Bash(node -e \' *)', 'mcp__browser-mcp', 'Bash(npm test)',
  // Runde 2 30/9 (Fable 1): root, fuld sti, programmer der koerer programmer, og de
  // automations-servere klienterne selv skibes med. Og det der IKKE er en omvej.
  'Bash(sudo *)', 'Bash(/bin/zsh *)', 'Bash(npx playwright *)', 'mcp__claude-in-chrome', 'mcp__computer-use__computer',
  'Bash(npx tsc:*)', 'mcp__computer-mcp',
  // Live-proeven 30/9: PRAECISE kommandoer tillader kun den ene ting - ikke en omvej.
  'Bash(node --check index.js)', 'Bash(python3 -c "import ast; ast.parse(open(\'x.py\').read())")',
  'Bash(osascript -e \'tell application "Simulator" to activate\')', 'Bash(open -a Simulator)', 'Bash(sudo pmset *)',
  // ...men et script fra stdin er en omvej.
  'Bash(python3 -)'] } }));
writeFileSync(UDEN, JSON.stringify({ permissions: { allow: ['Bash(git status)', 'mcp__computer-mcp__computer_press'] } }));

async function permissions(filer) {
  const HJ = lavFalskHjaelper('cmcp-omveje');
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], {
    env: { ...process.env, CMCP_HELPER: HJ.sti, CMCP_STATE_DIR: ARB, CMCP_STATUS_IKON: '0', CMCP_KLIENT_INDSTILLINGER: filer,
           CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-omveje-sp').sti },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const v = new Map(); let n = 0;
  srv.stdout.on('data', d => { buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(l); v.get(m.id)?.(m); v.delete(m.id); } catch {} } });
  const rpc = (method, params = {}) => new Promise((res, rej) => { const id = ++n; v.set(id, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => rej(new Error('timeout')), 30000); });
  try {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'omveje', version: '1' } });
    const r = await rpc('tools/call', { name: 'computer_permissions', arguments: {} });
    return r.result?.content?.[0]?.text || '';
  } finally { srv.kill(); }
}

const med = await permissions(MED);
let j = {}; try { j = JSON.parse(med); } catch {}
const regler = (j.bypasses || []).map(b => b.rule);
check('1 osascript i allow naevnes som omvej', regler.some(r => /osascript/.test(r)), regler.join(' | '));
check('2 en fri shell naevnes', regler.includes('Bash(*)'), regler.join(' | '));
check('3 browser-klik og -udfyld naevnes', regler.includes('mcp__browser-mcp__browser_click') && regler.includes('mcp__browser-mcp__browser_fill'), regler.join(' | '));
check('4 harmloese regler naevnes IKKE (git status, computer-mcp selv, et skaermbillede)',
      !regler.some(r => /git status|computer-mcp|screenshot/.test(r)), regler.join(' | '));
check('4b skaller, fortolkere og en hel browser-server naevnes (Fable P5)',
      ['Bash(bash *)', 'Bash(zsh *)', 'Bash(python3 *)', "Bash(node -e ' *)", 'mcp__browser-mcp'].every(r => regler.includes(r)), regler.join(' | '));
check('4c ...men ikke «npm test»', !regler.includes('Bash(npm test)'), regler.join(' | '));
check('4d root, fuld sti, npx playwright, Claude in Chrome og computer-use naevnes (Fable R2 1)',
      ['Bash(sudo *)', 'Bash(/bin/zsh *)', 'Bash(npx playwright *)', 'mcp__claude-in-chrome', 'mcp__computer-use__computer'].every(r => regler.includes(r)), regler.join(' | '));
check('4f praecise kommandoer (uden wildcard) naevnes IKKE - kun de der tillader hvad som helst',
      !regler.some(r => /node --check|ast\.parse|to activate|open -a Simulator|sudo pmset/.test(r)), regler.join(' | '));
check('4g et script fra stdin (python3 -) er en omvej', regler.includes('Bash(python3 -)'), regler.join(' | '));
check('4e ...men ikke «npx tsc» eller computer-mcp selv', !regler.includes('Bash(npx tsc:*)') && !regler.includes('mcp__computer-mcp'), regler.join(' | '));
check('5 resten af filen laekkes ikke', !/HEMMELIG-STI/.test(med), 'svaret naevner kun de fundne regler');
check('6 og mennesket faar at vide at kun det kan fjerne dem', /Only the person can remove them/.test(j.bypassNote || ''), j.bypassNote);
const uden = JSON.parse(await permissions(UDEN) || '{}');
check('7 uden omveje: ingen advarsel', Array.isArray(uden.bypasses) && uden.bypasses.length === 0 && !uden.bypassNote, JSON.stringify(uden.bypasses));
const ingen = JSON.parse(await permissions(join(ARB, 'findes-ikke.json')) || '{}');
check('8 ingen indstillinger fundet: det siges, ikke tavshed', /other MCP clients are not checked/.test(String(ingen.bypassesChecked)), String(ingen.bypassesChecked));

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
