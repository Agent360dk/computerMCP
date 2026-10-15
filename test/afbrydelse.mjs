// S1 (15/10, R38 - Astra MAALT): afbroed klienten et kald, koerte serveren videre og udfoerte handlingen
// senere. Et afbrudt kald maa ALDRIG udfoeres: ikke efter en ventetid, ikke efter laasen, ikke efter et
// spoergsmaal. A: spoergsmaalet traekkes tilbage. B: gennem den rigtige server - kaldet venter paa en anden
// agents laas, klienten afbryder, laasen frigives, og hjaelperen faar INTET.
import './ryd-op.mjs';
import './egen-tilstand.mjs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- A: spoergsmaalet
{
  const STATE = mkdtempSync(join(tmpdir(), 'cmcp-afbryd-'));
  process.env.CMCP_STATE_DIR = STATE; process.env.CMCP_STATUS_IKON = '0';
  process.env.CMCP_ASK_WINDOW = '1'; process.env.CMCP_ASK_LIFE = '4'; process.env.CMCP_HELPER = '/usr/bin/false';
  const modtaget = []; let lukket = 0;
  const srv = createServer(sock => {
    let buf = '';
    let spurgt = false;   // kun spoergsmaalets egen forbindelse - ikke serverens «lever ikonet?»-tjek
    sock.on('data', d => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { modtaget.push(JSON.parse(buf.slice(0, i))); buf = ''; spurgt = true; } });
    sock.on('close', () => { if (spurgt) lukket++; });
    sock.on('error', () => {});
  });
  await new Promise(r => srv.listen(join(STATE, 'ikon.sock'), r));
  const G = await import(join(ROOT, 'mcp-server', 'godkend.js'));
  const sp = { session: 's1', client: 'proeve', text: 'Press Quit in Noter', scope: 'If you allow it, this one action only.', target: 'com.apple.Notes' };
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 300);
  const a = await G.iHandling('computer_press', { app: 'Notes', title: 'Quit' }, () => G.spoergIkonet(sp, 4), ac.signal);
  await vent(200);
  check('A1 et afbrudt kald venter ikke: det svarer straks, og spoergsmaalet traekkes tilbage (forbindelsen lukkes)',
    a.ok === false && /cancelled/.test(a.grund) && Date.now() - t0 < 900 && lukket === 1, `${Date.now() - t0} ms · lukket=${lukket} · ${a.grund}`);
  const foer = modtaget.length;
  const b = await G.iHandling('computer_press', { app: 'Notes', title: 'Quit' }, () => G.spoergIkonet(sp, 4), new AbortController().signal);
  check('A2 et afbrudt spoergsmaal er ikke gemt: samme kald spoerger paa ny', b.venterStadig === true && modtaget.length === foer + 1, `spurgt=${modtaget.length - foer}`);
  await vent(4200);
  srv.close();
}

// ---------------------------------------------------------------- B: gennem serveren
async function gennemServeren(afbryd) {
  const STATE = mkdtempSync(join(tmpdir(), 'cmcp-afbryd-srv-'));
  const hj = lavFalskHjaelper('cmcp-afbryd');
  hj.saetSvar({ apps: { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true },
                               { name: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, active: false }] },
                key: { ok: true, key: 'cmd+b', took_screen: false } });
  // En «anden agent» holder laasen paa Notes: en levende proces staar som ejer.
  const sover = spawn('sleep', ['60']);
  mkdirSync(join(STATE, 'laase'), { recursive: true });
  writeFileSync(join(STATE, 'laase', 'com.apple.Notes.lock'), String(sover.pid));
  const env = { ...process.env, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti, CMCP_STATE_DIR: STATE, CMCP_STATUS_IKON: '0',
                CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-afbryd-sp').sti };
  delete env.CMCP_BACKGROUND;
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const svar = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id != null) svar.set(m.id, m); } catch {} } });
  const send = (o) => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'afbryd', version: '1' } } });
  for (let i = 0; i < 100 && !svar.has(1); i++) await vent(100);
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/call', params: { name: 'computer_key', arguments: { app: 'Notes', combo: 'cmd+b' } } });
  await vent(1500);                                   // kaldet venter nu paa laasen
  const venterPaaLaas = !svar.has(2);
  if (afbryd) send({ method: 'notifications/cancelled', params: { requestId: 2, reason: 'proeve' } });
  await vent(500);
  sover.kill();                                       // laasen frigives
  await vent(2500);
  await hj.roligt?.();
  const taster = hj.kald().filter(k => k.argv[0] === 'key');
  srv.kill();
  const { readFileSync } = await import('node:fs');
  let log = ''; try { log = readFileSync(join(STATE, 'audit.jsonl'), 'utf8'); } catch {}
  return { venterPaaLaas, taster, log };
}
{
  const k = await gennemServeren(false);
  check('B0 kalibrering: UDEN afbrydelse naar tastetrykket hjaelperen, naar laasen frigives', k.venterPaaLaas && k.taster.length === 1, `ventede=${k.venterPaaLaas} taster=${k.taster.length}`);
  const b = await gennemServeren(true);
  check('B1 kaldet ventede paa en anden agents laas, da det blev afbrudt', b.venterPaaLaas, b.venterPaaLaas ? 'ventede' : 'svarede foer afbrydelsen');
  check('B2 efter afbrydelsen og laasens frigivelse naaede INTET tastetryk hjaelperen', b.taster.length === 0, JSON.stringify(b.taster.map(x => x.argv)));
  check('B3 det var laase-ventetiden der stoppede kaldet (loggen siger det)', /cancelled this call while it waited for another agent/.test(b.log), (b.log.match(/cancelled[^"]*/) || ['ingen'])[0]);
}

// ---------------------------------------------------------------- C: det sidste lag (kildekontrakt)
{
  const { readFileSync } = await import('node:fs');
  const ix = readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
  const i = ix.indexOf('stopgrund = await maalErStadigForsvarligt();');
  const blok = ix.slice(i, ix.indexOf('try { res = await runTool(name, args); return res; }', i));
  check('C sidste kontrol lige foer handlingen: et afbrudt kald udfoeres ikke (ogsaa hvis det blev afbrudt efter laasen)',
    i > 0 && /if \(kaldAfbrudt\(\)\) \{\n\s+stopgrund = 'the client cancelled this call before it was done/.test(blok)
    && /\}, 60_000, kaldAfbrudt\);/.test(ix) && /svar = await iKald\(\(\) => iHandling\(navn, a, \(\) => haandterKald\(request\), extra\?\.signal \?\? null\)\);/.test(ix));
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
