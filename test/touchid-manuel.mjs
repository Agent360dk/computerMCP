// MANUEL e2e: godkendelse fra menulinje-ikonet med en RIGTIG finger.
//
// Koeres IKKE af run-all.sh: den venter paa at et menneske trykker «Allow…»
// i ikonet og saetter fingeren paa. Alt andet i godkendelsen er proevet mod
// et falsk ikon i ikon-godkend.mjs; dette er det ene trin der kun kan maales
// med et menneske.
//
//   node test/touchid-manuel.mjs          (venter op til 10 minutter)
//
// Den rigtige state-mappe bruges med vilje, saa spoergsmaalet lander i det
// ikon mennesket allerede har. Agenten skriver i et usynligt proevevindue den
// selv ejer - intet af menneskets programmer roeres.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = process.env.CMCP_STATE_DIR || join(homedir(), '.local/state/computer-mcp');
const VENT_SEK = Number(process.env.CMCP_ASK_TIMEOUT || 600);
const ARB = mkdtempSync(join(tmpdir(), 'cmcp-touchid-'));
const navn = 'cmcptouchid' + Math.random().toString(36).slice(2, 6), BID = 'dk.agent360.cmcp.' + navn;
const pakke = join(ARB, navn + '.app');
mkdirSync(join(pakke, 'Contents/MacOS'), { recursive: true });
writeFileSync(join(pakke, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${BID}</string><key>CFBundleName</key><string>${navn}</string><key>CFBundleExecutable</key><string>${navn}</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`);
execFileSync('swiftc', ['-O', join(ROOT, 'test/fixture/proevemaal.swift'), '-o', join(pakke, 'Contents/MacOS', navn)]);
const attrap = spawn(join(pakke, 'Contents/MacOS', navn), { stdio: ['ignore', 'pipe', 'ignore'] });
const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
  env: { ...process.env, CMCP_STATE_DIR: STATE, CMCP_MODE: 'ask', CMCP_ASK_TIMEOUT: String(VENT_SEK) },
  stdio: ['pipe', 'pipe', 'pipe'] });
const ryd = () => { try { srv.kill('SIGTERM'); } catch {} try { attrap.kill(); } catch {} rmSync(ARB, { recursive: true, force: true }); };
process.on('SIGINT', () => { ryd(); process.exit(1); });
try {
  await new Promise(r => { attrap.stdout.on('data', d => /pid=/.test(d) && r()); setTimeout(r, 8000); });
  await new Promise(r => setTimeout(r, 2000));
  let buf = '', n = 0; const w = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'touchid-test', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  console.log(`VENTER PAA MENNESKET i op til ${VENT_SEK} s - ikonet er orange`, new Date().toISOString());
  const t0 = Date.now();
  const r = await rpc('tools/call', { name: 'computer_type', arguments: { app: BID, text: 'touchid-virker' } });
  console.log('svar efter', Math.round((Date.now() - t0) / 1000), 's:', r.result.isError ? 'AFVIST' : 'GODKENDT', '-', r.result.content[0].text.slice(0, 120));
  await new Promise(r => setTimeout(r, 600));
  const ins = await rpc('tools/call', { name: 'computer_inspect', arguments: { app: BID, format: 'json', limit: 30 } });
  const felt = (JSON.parse(ins.result.content[0].text).nodes.find(x => x.role === 'AXTextField') || {}).value ?? '';
  console.log('proevevinduets felt:', JSON.stringify(felt), felt === 'touchid-virker' ? '(teksten landede)' : '');
  const log = readFileSync(join(STATE, 'audit.jsonl'), 'utf8').trim().split('\n').slice(-40)
    .map(l => { try { return JSON.parse(l); } catch { return {}; } }).filter(l => l.asker === 'menubar');
  console.log('revisionslinje:', JSON.stringify(log.slice(-1).map(l => ({ decision: l.decision, asked: l.asked, reason: l.reason }))));
  const kilde = join(STATE, 'klik-kilde.jsonl');
  console.log('klik-kilde:', existsSync(kilde) ? readFileSync(kilde, 'utf8').trim().split('\n').slice(-1)[0] : 'ingen noteret');
} finally { ryd(); }
