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

// ---------------------------------------------------------------- D: R42 (Astra, MAALT)
// D2: et ALLEREDE afbrudt signal: intet spoergsmaal, ingen fejl - og naeste kald spoerger rigtigt (ingen falsk «venter»).
{
  const STATE = mkdtempSync(join(tmpdir(), 'cmcp-afbryd-d2-'));
  process.env.CMCP_STATE_DIR = STATE;
  const modtaget = [];
  const srv = createServer(sock => { let buf = ''; sock.on('data', d => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { modtaget.push(JSON.parse(buf.slice(0, i))); buf = ''; } }); sock.on('error', () => {}); });
  await new Promise(r => srv.listen(join(STATE, 'ikon.sock'), r));
  const G = await import(join(ROOT, 'mcp-server', 'godkend.js') + '?d2');
  const ac = new AbortController(); ac.abort();
  const sp = { session: 's2', client: 'proeve', text: 'Press Delete in Noter', scope: 'If you allow it, this one action only.', target: 'com.apple.Notes' };
  let fejl = null, a = null;
  try { a = await G.iHandling('computer_press', { app: 'Notes', title: 'Delete' }, () => G.spoergIkonet(sp, 4), ac.signal); } catch (e) { fejl = e; }
  const b = await G.iHandling('computer_press', { app: 'Notes', title: 'Delete' }, () => G.spoergIkonet(sp, 4), new AbortController().signal);
  check('D2 et allerede afbrudt kald: intet spoergsmaal og ingen fejl; naeste kald spoerger rigtigt', !fejl && a?.ok === false && /cancelled/.test(a?.grund || '') && b.venterStadig === true && modtaget.length === 1,
    `${fejl ? 'FEJL ' + fejl.message : (a?.grund || '')} · spurgt=${modtaget.length}`);
  await vent(4200); srv.close();
}

// D1: et afbrudt computer_request_screen faar IKKE laanet, selv om mennesket siger ja bagefter.
{
  const STATE = mkdtempSync(join(tmpdir(), 'cmcp-afbryd-d1-'));
  const ikon = createServer(sock => { let buf = ''; sock.on('data', d => { buf += d; const i = buf.indexOf('\n'); if (i < 0) return; const q = JSON.parse(buf.slice(0, i));
    setTimeout(() => { try { sock.write(JSON.stringify({ nonce: q.nonce, ok: true, verified: 'owner', until: Date.now() + 120000 }) + '\n'); } catch {} }, 1200); }); sock.on('error', () => {}); });
  await new Promise(r => ikon.listen(join(STATE, 'ikon.sock'), r));
  const hj = lavFalskHjaelper('cmcp-afbryd-d1');
  hj.saetSvar({ apps: { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true }] } });
  const env = { ...process.env, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti, CMCP_STATE_DIR: STATE, CMCP_STATUS_IKON: '0', CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-d1-sp').sti };
  delete env.CMCP_BACKGROUND;
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const svar = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id != null) svar.set(m.id, m); } catch {} } });
  const send = (o) => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'd1', version: '1' } } });
  for (let i = 0; i < 100 && !svar.has(1); i++) await vent(100);
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/call', params: { name: 'computer_request_screen', arguments: { action: 'request', minutes: 2, reason: 'Proeve af afbrydelse' } } });
  await vent(300);
  send({ method: 'notifications/cancelled', params: { requestId: 2, reason: 'proeve' } });
  await vent(2500);
  send({ id: 3, method: 'tools/call', params: { name: 'computer_request_screen', arguments: { action: 'status' } } });
  for (let i = 0; i < 100 && !svar.has(3); i++) await vent(100);
  const status = (svar.get(3)?.result?.content || []).map(c => c.text).join('');
  const { readFileSync } = await import('node:fs');
  let log = ''; try { log = readFileSync(join(STATE, 'audit.jsonl'), 'utf8'); } catch {}
  check('D1 et afbrudt computer_request_screen giver ikke laanet (ingen «lent», status ikke udlaant)', !/"outcome":"lent"/.test(log) && !/lent to this agent/.test(status), `${status.slice(0, 80)} · lent=${/"outcome":"lent"/.test(log)}`);
  srv.kill(); ikon.close();
}

// D3: computer_ask_user i forgrunden: afbrydes kaldet under opslagene foer dialogen, startes ingen dialog.
// ⛔ S2a-gaten (16/10): R42f overlevede én gang under last - en fast ventetid paa 3 s naaede ikke at se
//    dialogen. Nu kalibreret (uden afbrydelse SKAL en dialog starte) og med ventetid paa betingelsen.
for (const afbryd of [false, true]) {
  const STATE = mkdtempSync(join(tmpdir(), 'cmcp-afbryd-d3-'));
  const hj = lavFalskHjaelper('cmcp-afbryd-d3');
  hj.saetSvar({ apps: { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true }, { name: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, active: false }] },
                windows: { _vent: 1500, ok: true, windows: [{ title: 'Note' }] }, 'resolve-app': { ok: true, bundleId: 'com.apple.Notes' } });
  const sp = lavFalskSpoerger('ja', 'cmcp-d3-sp');
  const env = { ...process.env, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti, CMCP_STATE_DIR: STATE, CMCP_STATUS_IKON: '0', CMCP_BACKGROUND: '0', CMCP_OSASCRIPT: sp.sti };
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const svar = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id != null) svar.set(m.id, m); } catch {} } });
  const send = (o) => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'd3', version: '1' } } });
  for (let i = 0; i < 100 && !svar.has(1); i++) await vent(100);
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/call', params: { name: 'computer_ask_user', arguments: { message: 'Type your password in Notes', app: 'Notes' } } });
  await vent(500);
  if (afbryd) send({ method: 'notifications/cancelled', params: { requestId: 2, reason: 'proeve' } });
  for (let i = 0; i < 100 && sp.gangeSpurgt() === 0; i++) await vent(100);   // hoejst 10 s
  if (!afbryd) check('D3-kalibrering: uden afbrydelse starter dialogen', sp.gangeSpurgt() === 1, `dialoger=${sp.gangeSpurgt()}`);
  else check('D3 computer_ask_user afbrudt under opslagene foer dialogen: ingen dialog startet', sp.gangeSpurgt() === 0, `dialoger=${sp.gangeSpurgt()}`);
  srv.kill();
}

// ---------------------------------------------------------------- C: det sidste lag (kildekontrakt)
{
  const { readFileSync } = await import('node:fs');
  const ix = readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
  const i = ix.indexOf('stopgrund = await maalErStadigForsvarligt();');
  const blok = ix.slice(i, ix.indexOf('try { res = await runTool(name, args); return res; }', i));
  check('C sidste kontrol lige foer handlingen: et afbrudt kald udfoeres ikke (ogsaa hvis det blev afbrudt efter laasen)',
    i > 0 && /if \(kaldAfbrudt\(\)\) \{\n\s+stopgrund = (kaldStoppet\(\) \? '[^'\n]*' : )?'the client cancelled this call before it was done/.test(blok)
    && /\}, Math\.min\(60_000, Math\.max\(0, restMs\(\)\)\), kaldAfbrudt\);/.test(ix) && /svar = await iKald\(\(\) => iHandling\(navn, a, \(\) => haandterKald\(request\), extra\?\.signal \?\? null\)\);/.test(ix));
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
