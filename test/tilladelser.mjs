// Den foerste besked en fremmed nogensinde ser.
//
// ⛔ HVORFOR DEN FINDES (23/9-2026)
//    `missing-accessibility` og `missing-screen-recording` var naevnt praecis
//    to steder i hele repoet - i hjaelperen der rejser dem, og i serveren der
//    oversaetter dem. INGEN proeve roerte dem.
//
//    Det er den eneste fejl hver eneste nye bruger moeder: man installerer,
//    kalder noget, og macOS har ikke faaet lov endnu. Er beskeden daarlig,
//    fejler produktet for ALLE i det foerste minut - og vi ville hoere det
//    fra brugerne, ikke fra en proeve.
//
//    Beskeden baerer én ting man ikke gaetter: tilladelsen tilhoerer det
//    PROGRAM der koerer serveren, ikke dette vaerktoej. Den saetning er
//    forskellen paa at finde det rigtige flueben og at lede forgaeves.
//
//    Tilladelserne kan ikke fjernes paa menneskets maskine - det ville koste
//    ham hans egne. Saa hjaelperen erstattes af en attrap der svarer praecis
//    den fejlkode macOS ville udloese, og vi maaler hvad SERVEREN goer ved den.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.env.CMCP_STATUS_IKON = '0';
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const DIR = mkdtempSync(join(tmpdir(), 'cmcp-tillad-'));

/// En hjaelper der altid svarer med én bestemt fejlkode - det macOS ville sige.
function attrapDerNaegter(kode, besked) {
  const sti = join(DIR, 'h-' + kode + '.sh');
  writeFileSync(sti, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ ok: false, error: besked, code: kode })}'\nexit 1\n`);
  chmodSync(sti, 0o755);
  return sti;
}

async function spoerg(kode, besked, vaerktoej) {
  const state = mkdtempSync(join(DIR, 'state-'));
  const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
    env: { ...process.env, CMCP_STATE_DIR: state, CMCP_MODE: 'readonly',
           CMCP_HELPER: attrapDerNaegter(kode, besked),
           // Husets vagt 26: ingen proeve maa kunne rejse en aegte dialog.
           CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-tillad').sti },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', n = 0; const w = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'tillad', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const r = await rpc('tools/call', { name: vaerktoej, arguments: {} });
  srv.kill();
  return r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? {});
}

// 1. Tilgaengelighed mangler - det foerste en fremmed rammer.
const a = await spoerg('missing-accessibility', 'accessibility is not granted', 'computer_apps');
check('1a beskeden siger hvor fluebenet sidder', /System Settings.*Accessibility/is.test(a), a.slice(0, 90));
check('1b ...og at tilladelsen tilhoerer PROGRAMMET, ikke vaerktoejet',
      /belongs to that app, not to this tool/i.test(a), a.slice(-60));
check('1c ...og at man skal genstarte bagefter', /restart it/i.test(a));

// 2. Skaermoptagelse mangler - den anden af de to.
const b = await spoerg('missing-screen-recording', 'screen recording is not granted', 'computer_screenshot');
check('2a beskeden peger paa den RIGTIGE rude i Systemindstillinger',
      /Screen & System Audio Recording/i.test(b), b.slice(0, 90));
check('2b ...og forveksler den ikke med tilgaengelighed', !/> Accessibility/i.test(b));

// 3. ⛔ KALIBRERING. Uden den ville «svar altid med tilladelses-teksten»
//    bestaa proeve 1 og 2. En almindelig fejl maa IKKE blive til en
//    tilladelses-vejledning - saa ville hver fremmed sendes til
//    Systemindstillinger for noget der ikke er en tilladelse.
const c = await spoerg('helper-error', 'something else went wrong', 'computer_apps');
check('3 en almindelig fejl bliver IKKE til en tilladelses-vejledning',
      !/System Settings/i.test(c), c.slice(0, 90));
check('3b ...men den almindelige fejl naar frem', /something else went wrong/i.test(c), c.slice(0, 60));

rmSync(DIR, { recursive: true, force: true });
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
