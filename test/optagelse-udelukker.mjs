// Adgangskode-managere holdes UDE af selve optagelsen - bevist uden ét billede.
//
// ⛔ HVORFOR DEN FINDES (24/9-2026)
//    Optagelsen skete FOER sloeringsscanningen, og scanningen tager sekunder.
//    En adgangskode-manager der blev skjult, flyttet eller lukket i det hul, var
//    i billedet men ikke i scanningen - og kom usvaertet med. En agent kunne
//    selv aabne hullet: `computer_screenshot` samtidig med
//    `computer_menu Finder > «Skjul andre»`, begge tilladt i standardtilstanden.
//    To raadgivere, uafhaengigt enige: hold dem ude af selve optagelsen.
//
// ⛔ OG DEN FINDES PAA EN MAADE DER ALDRIG TAGER ET BILLEDE AF MENNESKETS SKAERM.
//    Samme dag koerte jeg `--plan` mod en aeldre binaer. Den kendte ikke flaget,
//    ignorerede det i stilhed og optog skaermen. Derfor, i den her fil:
//      1. binaeren SPOERGES foerst (`version` -> capabilities). Kan den ikke
//         `--plan`, kaldes `screenshot` slet ikke.
//      2. HVERT kald baerer `--plan` - ogsaa dem der tester afvisninger. Saa kan
//         selv en oedelagt binaer der kender `--plan`, aldrig optage.
//      3. Skrives der nogensinde en fil, slettes den og proeven stopper.
//
// UMAALT her, sagt hoejt: at ScreenCaptureKit FAKTISK udelader programmets
// pixels, naar det staar i `excludingApplications`. Det er Apples kontrakt.
// Et pixel-bevis kraever en optagelse - paa en CI-Mac eller med Gustavs ja.
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const H = [process.env.CMCP_HELPER, join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper'),
           join(ROOT, 'helper', '.build', 'release', 'cmcp-helper')].find(p => p && existsSync(p));
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

// 0. Spoerg binaeren. Uden `screenshot-plan` stopper vi FOER noget kan optages.
const v = JSON.parse(execFileSync(H, ['version'], { encoding: 'utf8' }));
if (!(v.capabilities || []).includes('screenshot-plan')) {
  console.log('DUMP 0 binaeren kan ikke --plan - stopper foer screenshot kaldes: ' + JSON.stringify(v));
  process.exit(1);
}
check('0 binaeren kan --plan (spurgt foerst, med et kald der aldrig optager)', true);

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-ude-'));
const NAVN = 'cmcpude' + Math.random().toString(36).slice(2, 7), BID = 'dk.agent360.cmcp.' + NAVN;
const PAKKE = join(ARB, NAVN + '.app');
mkdirSync(join(PAKKE, 'Contents', 'MacOS'), { recursive: true });
writeFileSync(join(PAKKE, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${BID}</string><key>CFBundleName</key><string>${NAVN}</string>
<key>CFBundleExecutable</key><string>${NAVN}</string><key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/></dict></plist>`);
execFileSync('swiftc', ['-O', join(ROOT, 'test/fixture/proevemaal.swift'),
                        '-o', join(PAKKE, 'Contents', 'MacOS', NAVN)], { stdio: 'pipe' });
const attrap = spawn(join(PAKKE, 'Contents', 'MacOS', NAVN), { stdio: ['ignore', 'pipe', 'ignore'] });
await new Promise(r => { attrap.stdout.on('data', b => /pid=/.test(String(b)) && r()); setTimeout(r, 8000); });
const ud = join(ARB, 'MAA-ALDRIG-FINDES.png');
const ryd = () => { try { attrap.kill(); } catch {} rmSync(ARB, { recursive: true, force: true }); };
const plan = (...a) => {
  const r = spawnSync(H, ['screenshot', '--plan', '--out', ud, ...a], { encoding: 'utf8' });
  if (existsSync(ud)) {
    rmSync(ud, { force: true });
    console.log('DUMP en fil blev skrevet af «screenshot --plan ' + a.join(' ') + '» - slettet, stopper');
    ryd(); process.exit(1);
  }
  let j = {}; try { j = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
  return { j, kode: r.status };
};

// Vent til attrappen er i systemets programliste (ikke et fast tidspunkt).
let p1;
for (let i = 0; i < 40; i++) {
  p1 = plan('--deny', BID);
  if ((p1.j.excluded_apps || []).includes(BID)) break;
  await new Promise(r => setTimeout(r, 500));
}
check('1 et program paa spaerrelisten holdes UDE af optagelsen',
      (p1.j.excluded_apps || []).includes(BID) && p1.j.captured === false,
      JSON.stringify(p1.j.excluded_apps));

// 2. Kalibrering den anden vej: ikke paa listen -> ikke udelukket.
const p2 = plan();
check('2 ...og et program der IKKE er paa listen, holdes ikke ude (maaler listen, ikke alt)',
      !(p2.j.excluded_apps || []).includes(BID), JSON.stringify(p2.j.excluded_apps));

// 3. En adgangskode-manager fotograferes aldrig som eget maal.
const p3 = plan('--app', BID, '--deny', BID);
check('3 --app <spaerret program> afvises - det filter kan intet udelukke',
      p3.kode !== 0 && p3.j.code === 'app-is-denied', `kode ${p3.j.code}, exit ${p3.kode}`);

// 4. Et fejlstavet flag afvises. Parret med --plan, saa en mutant uden det
//    strikse tjek returnerer en plan - ikke et billede.
const p4 = plan('--plna');
check('4 et ukendt flag paa screenshot afvises i stedet for at blive ignoreret',
      p4.kode !== 0 && p4.j.code === 'bad-args', `kode ${p4.j.code}, exit ${p4.kode}`);

ryd();
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
