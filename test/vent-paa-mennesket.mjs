// S1b (15/10, R38): skridtet VENTER selv paa mennesket i stedet for «Refused ... wait» - som Claude
// «waits while you type». Bevist gennem den rigtige server med en falsk hjaelper:
//   V1 mennesket forlader programmet undervejs: handlingen sker i SAMME kald.
//   V2 mennesket bliver: intet leveres, svaret er «Waiting» (ikke et afslag, ikke i koeen, logget «waiting»).
//   V3 kaldet afbrydes under ventetiden: intet leveres.
import './ryd-op.mjs';
import './egen-tilstand.mjs';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = ms => new Promise(r => setTimeout(r, ms));
const AKTIV = { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: false }, { name: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, active: true }] };
const BAGVED = { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: true }, { name: 'Notes', bundleId: 'com.apple.Notes', pid: 3303, active: false }] };

async function server(apps, ventSek, ekstra = {}) {
  const STATE = mkdtempSync(join(tmpdir(), 'cmcp-ventm-'));
  let sover = null;
  if (ekstra.laas) { sover = spawn('sleep', ['60']); mkdirSync(join(STATE, 'laase'), { recursive: true }); writeFileSync(join(STATE, 'laase', 'com.apple.Notes.lock'), String(sover.pid)); }
  const hj = lavFalskHjaelper('cmcp-ventm');
  hj.saetSvar({ apps, key: { ok: true, key: 'cmd+b', took_screen: false } });
  const env = { ...process.env, CMCP_MODE: 'allow', CMCP_HELPER: hj.sti, CMCP_STATE_DIR: STATE, CMCP_STATUS_IKON: '0',
                CMCP_WAIT_SEK: String(ventSek), CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-ventm-sp').sti, ...(ekstra.env || {}) };
  delete env.CMCP_BACKGROUND;
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const svar = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id != null) svar.set(m.id, m); } catch {} } });
  const send = (o) => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ventm', version: '1' } } });
  for (let i = 0; i < 100 && !svar.has(1); i++) await vent(100);
  send({ method: 'notifications/initialized' });
  const vente = async (id, ms = 20000) => { for (let i = 0; i < ms / 100 && !svar.has(id); i++) await vent(100); return svar.get(id); };
  const tekst = (m) => (m?.result?.content || []).map(c => c.text || '').join('\n');
  const log = () => existsSync(join(STATE, 'audit.jsonl')) ? readFileSync(join(STATE, 'audit.jsonl'), 'utf8') : '';
  const koe = () => { try { return readFileSync(join(STATE, 'pending.jsonl'), 'utf8'); } catch { return ''; } };
  return { srv, send, vente, tekst, hj, log, koe, sover };
}

// V1: Notes er forrest de foerste opslag, saa gaar mennesket videre - skridtet venter og udfoeres i SAMME kald.
{
  const s = await server({ _raekke: [AKTIV, AKTIV, AKTIV, AKTIV, AKTIV, AKTIV, BAGVED] }, 10);
  const t0 = Date.now();
  s.send({ id: 2, method: 'tools/call', params: { name: 'computer_key', arguments: { app: 'Notes', combo: 'cmd+b' } } });
  const r = await s.vente(2);
  const ms = Date.now() - t0;
  await s.hj.roligt?.();
  const taster = s.hj.kald().filter(k => k.argv[0] === 'key');
  check('V1 mennesket forlader programmet undervejs: skridtet ventede og blev udfoert i samme kald',
    !r?.result?.isError && taster.length === 1 && ms >= 1500 && ms < 10_000, `${ms} ms · taster=${taster.length} · ${s.tekst(r).slice(0, 80)}`);
  s.srv.kill();
}

// V2: Notes bliver forrest - intet leveres, svaret er «Waiting», ikke et afslag i koeen.
{
  const s = await server(AKTIV, 2);
  const t0 = Date.now();
  s.send({ id: 2, method: 'tools/call', params: { name: 'computer_key', arguments: { app: 'Notes', combo: 'cmd+b' } } });
  const r = await s.vente(2);
  const ms = Date.now() - t0;
  await s.hj.roligt?.();
  const taster = s.hj.kald().filter(k => k.argv[0] === 'key');
  const t = s.tekst(r);
  check('V2 mennesket bliver i programmet: intet leveres, og svaret er «Waiting» efter ventetiden',
    taster.length === 0 && /^Waiting: Notes is still the window the person is working in right now after 2 seconds/.test(t) && ms >= 1800 && !/Refused/.test(t),
    `${ms} ms · taster=${taster.length} · ${t.slice(0, 90)}`);
  check('V2b ...logget som «waiting», ikke «denied», og ikke lagt i koeen', /"decision":"waiting"/.test(s.log()) && !/"decision":"denied"/.test(s.log()) && s.koe().trim() === '',
    `${(s.log().match(/"decision":"\w+"/g) || []).join(',')}`);
  s.srv.kill();
}

// V3: kaldet afbrydes mens det venter paa mennesket - intet leveres, heller ikke da Notes gaar bagud.
{
  const s = await server({ _raekke: [AKTIV, AKTIV, AKTIV, AKTIV, AKTIV, AKTIV, AKTIV, AKTIV, BAGVED] }, 10);
  s.send({ id: 2, method: 'tools/call', params: { name: 'computer_key', arguments: { app: 'Notes', combo: 'cmd+b' } } });
  await vent(1000);
  s.send({ method: 'notifications/cancelled', params: { requestId: 2, reason: 'proeve' } });
  await vent(4000);
  await s.hj.roligt?.();
  const taster = s.hj.kald().filter(k => k.argv[0] === 'key');
  check('V3 et kald afbrudt under ventetiden leveres aldrig', taster.length === 0, `taster=${taster.length}`);
  check('V3b ...og det var ventetiden paa mennesket der stoppede det (loggen siger det)', /cancelled this call while it waited for the person/.test(s.log()), (s.log().match(/cancelled[^"]*/) || ['ingen'])[0]);
  s.srv.kill();
}

// ---- R42 (Opus + Astra) ----
// V5: mennesket VENDER TILBAGE mens kaldet venter paa en anden agents laas: intet leveres (kontrollen koeres igen inde i laasen).
{
  const s = await server(BAGVED, 10, { laas: true });
  s.send({ id: 2, method: 'tools/call', params: { name: 'computer_key', arguments: { app: 'Notes', combo: 'cmd+b' } } });
  await vent(1200);                                   // porten er passeret (Notes bagved), kaldet venter paa laasen
  s.hj.saetSvar({ apps: AKTIV, key: { ok: true, key: 'cmd+b', took_screen: false } });   // mennesket gaar tilbage til Notes
  await vent(300);
  s.sover.kill();                                     // laasen frigives
  const r = await s.vente(2);
  await s.hj.roligt?.();
  const taster = s.hj.kald().filter(k => k.argv[0] === 'key');
  check('V5 mennesket vender tilbage under ventetiden paa laasen: intet leveres, svaret er «Waiting»', taster.length === 0 && /^Waiting: Notes became the window the person is working in again/.test(s.tekst(r)),
    `taster=${taster.length} · ${s.tekst(r).slice(0, 100)}`);
  s.srv.kill();
}

// V6: et opslag der FEJLER midt i ventetiden er ukendt, ikke «gaaet» (Opus P3: AKTIV x3, fejl, AKTIV).
{
  const FEJL = { ok: false, code: 'timeout', error: 'the accessibility layer did not answer' };
  const s = await server({ _raekke: [AKTIV, AKTIV, AKTIV, FEJL, AKTIV] }, 3);
  s.send({ id: 2, method: 'tools/call', params: { name: 'computer_key', arguments: { app: 'Notes', combo: 'cmd+b' } } });
  const r = await s.vente(2);
  await s.hj.roligt?.();
  const taster = s.hj.kald().filter(k => k.argv[0] === 'key');
  check('V6 et fejlet opslag faar ikke porten til at aabne: intet leveres, «Waiting»', taster.length === 0 && /^Waiting: Notes is still the window/.test(s.tekst(r)), `taster=${taster.length} · ${s.tekst(r).slice(0, 90)}`);
  s.srv.kill();
}

// V7: hele kaldet holder sig inden for sit budget (Astra MAALT 65 s): laasen bliver holdt, budgettet er 3 s.
{
  const s = await server(BAGVED, 10, { laas: true, env: { CMCP_CALL_BUDGET: '3' } });
  const t0 = Date.now();
  s.send({ id: 2, method: 'tools/call', params: { name: 'computer_key', arguments: { app: 'Notes', combo: 'cmd+b' } } });
  const r = await s.vente(2, 15000);
  const ms = Date.now() - t0;
  await s.hj.roligt?.();
  const taster = s.hj.kald().filter(k => k.argv[0] === 'key');
  check('V7 et kald der venter paa en laas, svarer inden for sit budget - ikke efter 60 s', r && ms < 5000 && taster.length === 0 && /within the time this call has/.test(s.tekst(r)), `${ms} ms · ${s.tekst(r).slice(0, 90)}`);
  s.sover.kill(); s.srv.kill();
}

// V9: R43 (Astra, MAALT 66 s): laasen frigives taet paa fristen, og opslagene efter laasen er langsomme -
//     intet sker, og svaret kommer inden for budgettet (ikke efter de faste 5 + 15 s).
{
  const s = await server({ _vent: 1200, ...BAGVED }, 10, { laas: true, env: { CMCP_CALL_BUDGET: '4' } });
  const t0 = Date.now();
  s.send({ id: 2, method: 'tools/call', params: { name: 'computer_key', arguments: { app: 'Notes', combo: 'cmd+b' } } });
  setTimeout(() => s.sover.kill(), 3500);            // laasen frigives 0,5 s foer fristen
  const r = await s.vente(2, 20000);
  const ms = Date.now() - t0;
  await s.hj.roligt?.();
  const taster = s.hj.kald().filter(k => k.argv[0] === 'key');
  check('V9 laasen frigives taet paa fristen og opslagene er langsomme: intet sker, og svaret kommer inden for budgettet',
    r && taster.length === 0 && ms < 6000 && /^Waiting:/.test(s.tekst(r)), `${ms} ms · taster=${taster.length} · ${s.tekst(r).slice(0, 90)}`);
  s.srv.kill();
}

// V4: kildekontrakt - laanets ventetid er den samme, afbrydelige ventetid (ventSek), ikke 5 s.
{
  const ix = readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
  check('V4 laanets ventetid tager af kaldets budget, er afbrydelig, synlig i boksen og ligger UDEN for programlaasen',
    /const slut = Date\.now\(\) \+ Math\.min\(ventSek\(\) \* 1000, restMs\(\)\);/.test(ix)
    && /while \(laanAktivt\(\) && laanOejeblik\(\) === vedDom && Date\.now\(\) < slut && !kaldAfbrudt\(\)\) \{/.test(ix)
    && /return Number\.isFinite\(v\) && v >= 0 \? Math\.min\(v, 40\) : 40;/.test(ix)
    && /statusVenter\(`Waiting for you to pause - /.test(ix)
    && ix.indexOf('if (laanAktivt()) await ventPaaStilhed(laanVedDom);') < ix.indexOf('const laast = await medProgramLaas('));
}

// V8: R42 (Opus) - ventetiden skrives paa den koerende statuslinje, ikke som nye historiklinjer, og «Waiting» er sit eget udfald.
{
  const ix = readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
  const st = readFileSync(join(ROOT, 'mcp-server', 'status.js'), 'utf8');
  const sw = readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-status', 'main.swift'), 'utf8');
  check('V8 ventetiden staar paa den koerende linje (statusVenter), ikke som ny historik; «Waiting» har sit eget tegn',
    !/statusHandling\(`Waiting for you/.test(ix) && /statusVenter\(maal\?\.active \? `Waiting for you to leave/.test(ix)
    && /export function statusVenter\(tekst, linje = tilstand\?\.now\) \{/.test(st) && /linje\._venteOriginal/.test(st) && !/let venteOriginal/.test(st)
    && /statusVenter\(null, ventLinje\)/.test(ix) && /statusVenter\(null, pauseLinje\)/.test(ix) && !/statusVenter[\s\S]{0,400}tilstand\.recent\.push/.test(st.slice(st.indexOf('export function statusVenter')))
    && /\/\^Waiting\/\.test\(foerste\) \? 'waiting'/.test(ix) && /case "waiting": return /.test(sw));
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
