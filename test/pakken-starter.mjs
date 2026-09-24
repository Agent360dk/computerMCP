// Den pakke en fremmed faar fra npm, skal kunne STARTE.
//
// ⛔ HVORFOR DEN FINDES (24/9-2026) - fundet af en konsulent, ikke af mig.
//    Jeg tilfoejede `vagt.js` 23/9 og importerede den fra index.js, men satte
//    den aldrig paa `files`-listen i package.json. MAALT paa den rigtige pakke:
//    `npm pack` -> pak ud -> start -> «Cannot find module 'vagt.js'». Serveren
//    doede foer foerste vaerktoej. Havde Gustav sagt ja til udgivelsen, var det
//    hvad enhver fremmed fik.
//    INGEN proeve kunne se det: suiten koerer fra repoet, hvor filen findes.
//    Og `files` er en liste nogen skal huske at udvide - husets egen laere siger
//    at saadan en liste ER hullet.
//
//    Derfor maaler den her ikke listen. Den goer det en fremmed goer: pakker,
//    pakker ud i en tom mappe og starter serveren derfra. Enhver glemt fil -
//    js, binaer eller andet - faar den til at falde.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MS = join(ROOT, 'mcp-server');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const D = mkdtempSync(join(tmpdir(), 'cmcp-pakke-'));
try {
  execFileSync('npm', ['pack', '--pack-destination', D], { cwd: MS, stdio: 'pipe' });
  const tgz = readdirSync(D).find(f => f.endsWith('.tgz'));
  execFileSync('tar', ['-xzf', join(D, tgz), '-C', D]);
  const PKG = join(D, 'package');
  // Afhaengighederne linkes ind, saa det ENESTE der kan mangle er pakkens egne
  // filer. (NODE_PATH virker ikke for ES-moduler.)
  symlinkSync(join(MS, 'node_modules'), join(PKG, 'node_modules'));

  const srv = spawn('node', [join(PKG, 'index.js')], {
    // Husets vagt 26: ingen proeve maa kunne rejse en aegte dialog.
    env: { ...process.env, CMCP_MODE: 'readonly', CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
           CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-pakke').sti,
           CMCP_STATE_DIR: mkdtempSync(join(tmpdir(), 'cmcp-pakke-state-')) },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '', buf = '', n = 0, doed = null; const w = new Map();
  srv.stderr.on('data', d => err += d);
  srv.on('exit', c => { doed = c; for (const r of w.values()) r(null); });
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { if (doed !== null) return r(null); const id = ++n; w.set(id, r);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); setTimeout(() => r(null), 15000); });

  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pakke', version: '1' } });
  check('1 den udpakkede pakke starter og svarer paa handtrykket', !!init?.result,
        doed !== null ? `doede med exit ${doed}: ${err.split('\n').find(l => /Error/.test(l)) || err.slice(0, 120)}` : 'svarede');
  if (init?.result) {
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const liste = await rpc('tools/list', {});
    const antal = liste?.result?.tools?.length || 0;
    check('2 ...og lister sine vaerktoejer (readonly: de laesende)', antal >= 10, `${antal} vaerktoejer`);
  }
  srv.kill();
} finally {
  rmSync(D, { recursive: true, force: true });
}
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
