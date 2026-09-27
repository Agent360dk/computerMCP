// GIV-TILBAGE: henter et program sig selv frem af et tryk eller et menupunkt,
// skal svaret sige det, og forgrunden gives tilbage til mennesket.
//
// ⛔ HVORFOR DEN FINDES (27/9-2026)
//    Brugsscenarierne på GitHubs macOS-kører: «File > New Finder Window» i
//    baggrunden hev Finder frem over det program «mennesket» arbejdede i.
//    `menu-click` og `press` målte intet, så svaret var tavst. Produktets løfte
//    er at det ikke tager skærmen; når et program alligevel henter sig selv
//    frem, er det mindste at sige det og give forgrunden tilbage.
//
// ⛔ KØRER KUN PÅ EN FREMMED MASKINE (CMCP_FREMMED_MASKINE=1).
//    Prøven FÅR med vilje et program til at tage forgrunden. På Gustavs Mac
//    ville det tage hans skærm - også hvis rettelsen virker, i et kvart sekund.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREMMED_MASKINE } from './falsk-hjaelper.mjs';

if (!FREMMED_MASKINE) {
  console.log('SPRUNGET OVER: tager med vilje forgrunden - koer med CMCP_FREMMED_MASKINE=1 paa en maskine der ikke er Gustavs (bevist intet - ikke bestaaet)');
  process.exit(0);
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HJAELPER = [process.env.CMCP_HELPER, join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper')].find(p => p && existsSync(p));
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const koer = (...a) => { try { return JSON.parse(execFileSync(HJAELPER, a, { encoding: 'utf8', timeout: 60000 })); }
                          catch (e) { try { return JSON.parse(String(e.stdout)); } catch { return { ok: false, error: String(e.stdout || e.message).slice(0, 200) }; } } };
const vent = (ms) => new Promise(r => setTimeout(r, ms));
const forrest = () => (koer('apps').apps || []).find(a => a.active)?.bundleId;

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-giv-'));
const navn = 'cmcpgiv' + Math.random().toString(36).slice(2, 7);
const BID = 'dk.agent360.cmcp.' + navn;
const pakke = join(ARB, navn + '.app');
mkdirSync(join(pakke, 'Contents', 'MacOS'), { recursive: true });
writeFileSync(join(pakke, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${BID}</string>
<key>CFBundleExecutable</key><string>${navn}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>`);
execFileSync('swiftc', ['-O', join(ROOT, 'test', 'fixture', 'proevemaal.swift'), '-o', join(pakke, 'Contents', 'MacOS', navn)], { stdio: 'pipe', timeout: 180000 });
const b = spawn(join(pakke, 'Contents', 'MacOS', navn), { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, CMCP_PROEVE_HENT_FREM: '1' } });
try {
  await new Promise(r => { b.stdout.on('data', d => /pid=/.test(String(d)) && r()); setTimeout(r, 15000); });
  for (let i = 0; i < 40 && !(koer('find', '--app', BID, '--title', 'hent-frem').count > 0); i++) await vent(500);
  const menneske = forrest();
  check('0 forudsaetning: et andet program end attrappen er forrest', !!menneske && menneske !== BID, String(menneske));

  // 1. En almindelig knap: intet skifter, og svaret siger det.
  const r1 = koer('press', '--app', BID, '--title', 'klik-maal');
  check('1 et tryk der ikke henter noget frem, siger took_screen: false', r1.ok && r1.took_screen === false, JSON.stringify(r1).slice(0, 160));

  // 2. Knappen der henter programmet frem.
  const r2 = koer('press', '--app', BID, '--title', 'hent-frem');
  const svar2 = JSON.stringify({ ok: r2.ok, took_screen: r2.took_screen, gave_back: r2.gave_back, why: r2.why, error: r2.error });
  check('2 et tryk der henter programmet frem, siger took_screen: true', r2.ok && r2.took_screen === true, svar2);
  check('2b ...og at forgrunden blev givet tilbage', r2.gave_back === true, svar2);
  await vent(300);
  check('2c det program mennesket var i, er forrest igen', forrest() === menneske, `${forrest()} (var ${menneske})`);
} finally {
  try { b.kill(); } catch {}
  rmSync(ARB, { recursive: true, force: true });
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
