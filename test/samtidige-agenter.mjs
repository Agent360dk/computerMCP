// To agenter der HANDLER samtidig - ikke kun skriver i loggen samtidig.
//
// Tilfoejet 22/9 efter Gustavs spoergsmaal: «hvis flere koerer samtidig i
// baggrunden, er det ogsaa testet korrekt og verificeret?» Svaret var nej:
// `concurrent.mjs` maalte kun loggen. Foerste maaling herfra fandt at to
// agenter i SAMME program flettede teksten tegn for tegn (67 skift).
//
// To rigtige servere, den rigtige hjaelper, og to usynlige proevevinduer
// (uden titellinje, gennemsigtige, uden for skaermen - se proevemaal.swift).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Ingen proeve maa saette et ikon i menneskets menulinje - heller ikke koert uden run-all.sh.
process.env.CMCP_STATUS_IKON = '0';
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = ms => new Promise(r => setTimeout(r, ms));
if (!existsSync(join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper'))) {
  console.log('DUMP hjaelperen er ikke bygget - koer scripts/build-release.sh'); process.exit(1);
}

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-samtidig-'));
const STATE = mkdtempSync(join(tmpdir(), 'cmcp-samtidig-state-'));
const binaer = join(ARB, 'proevemaal');
execFileSync('swiftc', ['-O', join(ROOT, 'test/fixture/proevemaal.swift'), '-o', binaer], { stdio: 'pipe' });

/// Et proevevindue som rigtigt program med bundle-ID, saa porten kan slaa det op.
function lavProgram() {
  const navn = 'cmcpsam' + Math.random().toString(36).slice(2, 7);
  const pakke = join(ARB, navn + '.app');
  mkdirSync(join(pakke, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(pakke, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dk.agent360.cmcp.${navn}</string>
<key>CFBundleName</key><string>${navn}</string>
<key>CFBundleExecutable</key><string>${navn}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>`);
  execFileSync('cp', [binaer, join(pakke, 'Contents', 'MacOS', navn)]);
  const b = spawn(join(pakke, 'Contents', 'MacOS', navn), { stdio: ['ignore', 'pipe', 'ignore'] });
  return { bid: `dk.agent360.cmcp.${navn}`, b,
           klar: new Promise(r => { b.stdout.on('data', d => /pid=/.test(String(d)) && r()); setTimeout(r, 8000); }) };
}

function server(navn) {
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], {
    env: { ...process.env, CMCP_STATE_DIR: STATE, CMCP_MODE: 'allow', CMCP_STATUS_IKON: '0',
           CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-samtidig-' + navn).sti },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const v = new Map(); let n = 0;
  srv.stdout.on('data', d => { buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(l); v.get(m.id)?.(m); v.delete(m.id); } catch {} } });
  const rpc = (method, params = {}) => new Promise((res, rej) => { const id = ++n; v.set(id, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => rej(new Error('timeout')), 90000); });
  const kald = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
  return { srv, kald, async klar() {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: navn, version: '1' } });
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); } };
}

const F1 = lavProgram(), F2 = lavProgram();
const A = server('chat-alfa'), B = server('chat-beta');
try {
  await Promise.all([F1.klar, F2.klar, A.klar(), B.klar()]);
  await vent(2500);
  const felt = async (bid) => {
    const r = await A.kald('computer_inspect', { app: bid, format: 'json', limit: 30 });
    const j = JSON.parse(r.content[0].text);
    return (j.nodes.find(x => x.role === 'AXTextField') || {}).value || '';
  };
  // ⛔ 80 + 80, ikke 120 + 120: hjaelperen klipper feltvaerdier ved 200 tegn.
  //    Foerste maaling rapporterede «40 af 240 tegn tabt» - det var klippet,
  //    ikke tabet. Sammenfletningen (67 skift) var derimod aegte.
  const TA = 'a'.repeat(80), TB = 'b'.repeat(80);

  // 1. Hver sit program, samtidig.
  const [r1, r2] = await Promise.all([
    A.kald('computer_type', { app: F1.bid, text: TA }),
    B.kald('computer_type', { app: F2.bid, text: TB }),
  ]);
  check('hver sit program: begge kald lykkedes', !r1.isError && !r2.isError, `${r1.content[0].text.slice(0, 50)} | ${r2.content[0].text.slice(0, 50)}`);
  await vent(400);
  const v1 = await felt(F1.bid), v2 = await felt(F2.bid);
  check('hver sit program: alfas tekst landede rent i sit program', v1 === TA, `${v1.length} tegn`);
  check('hver sit program: betas tekst landede rent i sit program', v2 === TB, `${v2.length} tegn`);

  // 2. SAMME program, samtidig. Foer programlaasen: flettet tegn for tegn.
  await A.kald('computer_set_value', { app: F2.bid, role: 'AXTextField', text: '' });
  const [r3, r4] = await Promise.all([
    A.kald('computer_type', { app: F2.bid, text: TA }),
    B.kald('computer_type', { app: F2.bid, text: TB }),
  ]);
  check('samme program: begge kald lykkedes', !r3.isError && !r4.isError, `${r3.content[0].text.slice(0, 50)} | ${r4.content[0].text.slice(0, 50)}`);
  await vent(400);
  const v = await felt(F2.bid);
  const skift = [...v].filter((c, i) => i > 0 && c !== v[i - 1]).length;
  console.log(`   maalt: ${v.length} tegn, ${skift} skift mellem a og b`);
  check('samme program: ingen tegn tabt', v.length === 160, `${v.length} af 160`);
  check('samme program: teksterne blev ikke flettet - den ene efter den anden',
        v === TA + TB || v === TB + TA, v.slice(0, 40) + '…');
} finally {
  A.srv.kill(); B.srv.kill(); F1.b.kill(); F2.b.kill();
  rmSync(ARB, { recursive: true, force: true });
}
if (fails.length) { console.log(`\n${fails.length} DUMPET`); process.exit(1); }
console.log('\nBESTAAET');
