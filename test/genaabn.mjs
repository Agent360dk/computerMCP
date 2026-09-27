// GENÅBN: et program der kører UDEN vindue, skal kunne åbnes i baggrunden.
//
// ⛔ HVORFOR DEN FINDES (27/9-2026)
//    Brugsscenarierne på Gustavs Mac: Aktivitetsovervågning og Spotify kørte, men
//    mennesket havde lukket vinduerne. `launch --background` svarede «was already
//    running - left where it was», og der var intet vindue at nå. Et menneske
//    klikker på Dock-ikonet, og det henter programmet frem. Vi beder programmet om
//    det samme, «vis dig», uden at aktivere det. MÅLT på attrappen: vinduet kom,
//    programmet blev ikke aktivt, og det forreste program var det samme.
//    Et program der allerede HAR et vindue, røres ikke.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HJAELPER = [process.env.CMCP_HELPER, join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper')].find(p => p && existsSync(p));
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const koer = (...a) => { try { return JSON.parse(execFileSync(HJAELPER, a, { encoding: 'utf8', timeout: 60000 })); }
                          catch (e) { try { return JSON.parse(String(e.stdout)); } catch { return { ok: false, error: String(e.stdout || e.message).slice(0, 200) }; } } };
const vent = (ms) => new Promise(r => setTimeout(r, ms));

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-genaabn-'));
const BIN = join(ARB, 'bin');
execFileSync('swiftc', ['-O', join(ROOT, 'test', 'fixture', 'proevemaal.swift'), '-o', BIN], { stdio: 'pipe', timeout: 180000 });
const boern = [];
// En rigtig .app med bundle-ID: kun sådan har programmet en identitet at blive åbnet ved.
async function start(env) {
  const navn = 'cmcpgen' + Math.random().toString(36).slice(2, 7);
  const bid = 'dk.agent360.cmcp.' + navn;
  const pakke = join(ARB, navn + '.app');
  mkdirSync(join(pakke, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(pakke, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bid}</string>
<key>CFBundleExecutable</key><string>${navn}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>`);
  execFileSync('cp', [BIN, join(pakke, 'Contents', 'MacOS', navn)]);
  const b = spawn(join(pakke, 'Contents', 'MacOS', navn), { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...env } });
  boern.push(b);
  await new Promise(r => { b.stdout.on('data', d => /pid=/.test(String(d)) && r()); setTimeout(r, 15000); });
  await vent(1500);
  return bid;
}
const vinduer = (bid) => koer('windows', '--app', bid);

try {
  // 1. Et program uden vindue: forudsætningen skal holde, ellers måler resten intet.
  const uden = await start({ CMCP_PROEVE_UDEN_VINDUE: '1' });
  const foer = vinduer(uden);
  check('1 forudsætning: programmet kører og har intet vindue', foer.ok && foer.count === 0, JSON.stringify(foer).slice(0, 120));
  const r = koer('launch', '--app', uden, '--background');
  check('1b launch --background beder det åbne et vindue', r.ok && /without a window/.test(r.result || ''), JSON.stringify(r).slice(0, 180));
  check('1c ...uden at tage skærmen', r.took_screen === false, JSON.stringify(r).slice(0, 180));
  let efter = vinduer(uden);
  for (let i = 0; i < 20 && !(efter.count > 0); i++) { await vent(300); efter = vinduer(uden); }
  check('1d vinduet findes nu for tilgængeligheds-laget', efter.count > 0 && efter.windows.some(w => w.title === 'genaabnet'), JSON.stringify(efter).slice(0, 160));

  // 2. Et program der allerede har et vindue, røres ikke: intet nyt vindue, samme svar som før.
  const med = await start({});
  const m0 = vinduer(med);
  const r2 = koer('launch', '--app', med, '--background');
  const m1 = vinduer(med);
  check('2 et program med vindue efterlades hvor det er', r2.ok && /left where it was/.test(r2.result || '') && m1.count === m0.count && m0.count > 0,
        `${JSON.stringify(r2).slice(0, 120)} · vinduer ${m0.count} -> ${m1.count}`);
} finally {
  for (const b of boern) { try { b.kill(); } catch {} }
  rmSync(ARB, { recursive: true, force: true });
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
