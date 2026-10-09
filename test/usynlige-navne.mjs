// USYNLIGE NAVNE: «WhatsApp» skal finde «‎WhatsApp» - i porten OG i leveringen.
//
// ⛔ 9/10 (F1 paa Gustavs Mac): WhatsApp ligger som /Applications/‎WhatsApp.app og
//    hedder «‎WhatsApp» naar den koerer (CFBundleDisplayName). `computer_launch
//    {app:"WhatsApp", background:true}` blev «ukendt maal» og afvist, og ethvert skrivende
//    kald i en koerende WhatsApp ligesaa. Rettelsen er ÉN regel paa to sprog: serverens
//    findProgram (helper.js) og hjaelperens Navne.vaelg (Navne.swift). Proeven koerer
//    begge mod SAMME tabel, saa de ikke kan glide fra hinanden - porten skal vurdere det
//    program leveringen rammer (18/9).
//
//    Ingen skaerm, intet program startes. Kun paa en Mac med WhatsApp maales den rigtige
//    hjaelper ogsaa (punkt 9); ellers siges det.
import './ryd-op.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskHjaelper } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KILDE = join(ROOT, 'helper', 'Sources', 'cmcp-helper');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const LRM = '‎', RLM = '‏', ZWSP = '​';
// [navne, hvad agenten skriver, forventet indeks (null = intet entydigt), hvad tilfaeldet maaler]
const TABEL = [
  [['Finder', `${LRM}WhatsApp`], 'WhatsApp', 1, 'usynligt tegn foran navnet'],
  [[`${LRM}WhatsApp`, `WhatsApp${RLM}`], 'WhatsApp', null, 'to passer uden de usynlige tegn: intet vaelges'],
  [['WhatsApp', `${LRM}WhatsApp`], 'WhatsApp', 0, 'et praecist navn vinder over et der kun passer uden usynlige tegn'],
  [[`${LRM}WhatsApp`], LRM, null, 'kun usynlige tegn finder intet'],
  [[`${LRM}WhatsApp`], 'WhatsAp', null, 'et andet navn finder intet'],
  [['Notes'], 'notes', 0, 'store/smaa bogstaver som foer'],
  [[`${LRM}WhatsApp`], `${LRM}WhatsApp`, 0, 'navnet kopieret ordret fra computer_apps'],
  [[`Whats${ZWSP}App`], 'whatsapp', 0, 'usynligt tegn inde i navnet'],
  [['Notes', 'Noter'], 'Note', null, 'et forkortet navn finder intet'],
];

// 1-2 · serverens regel
const { findProgram } = await import(join(ROOT, 'mcp-server', 'helper.js'));
const jsSvar = TABEL.map(([navne, want]) => {
  const apps = navne.map((name, i) => ({ name, bundleId: `dk.proeve.${i}` }));
  const hit = findProgram(apps, want);
  return hit ? apps.indexOf(hit) : null;
});
TABEL.forEach(([, , forventet, hvad], i) =>
  check(`1.${i + 1} serveren: ${hvad}`, jsSvar[i] === forventet, `fik ${jsSvar[i]}, ventede ${forventet}`));

// 2 · hjaelperens regel: Navne.swift kompileret for sig, samme tabel
const ARB = mkdtempSync(join(tmpdir(), 'cmcp-usynlige-navne-'));
writeFileSync(join(ARB, 'main.swift'), `import Foundation
struct T: Decodable { let navne: [String]; let want: String }
let ind = try! JSONDecoder().decode([T].self, from: FileHandle.standardInput.readDataToEndOfFile())
let ud: [Any] = ind.map { t in Navne.vaelg(t.navne, t.want).map { $0 as Any } ?? NSNull() }
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ud))
`);
const BIN = join(ARB, 'navne');
execFileSync('swiftc', [join(KILDE, 'Navne.swift'), join(ARB, 'main.swift'), '-o', BIN], { stdio: 'pipe', timeout: 180000 });
const swiftSvar = JSON.parse(execFileSync(BIN, { input: JSON.stringify(TABEL.map(([navne, want]) => ({ navne, want }))), encoding: 'utf8' }));
TABEL.forEach(([, , forventet, hvad], i) =>
  check(`2.${i + 1} hjaelperen: ${hvad}`, swiftSvar[i] === forventet, `fik ${swiftSvar[i]}, ventede ${forventet}`));
check('3 serveren og hjaelperen svarer ens paa hele tabellen', JSON.stringify(jsSvar) === JSON.stringify(swiftSvar),
  `server ${JSON.stringify(jsSvar)} · hjaelper ${JSON.stringify(swiftSvar)}`);

// 4-6 · reglen er den der BRUGES: begge serveropslag og begge hjaelperopslag kalder den
const helperJs = readFileSync(join(ROOT, 'mcp-server', 'helper.js'), 'utf8');
const krop = (src, start) => { const i = src.indexOf(start); return i < 0 ? '' : src.slice(i, src.indexOf('\n}', i)); };
check('4 resolveBundleId (porten) bruger findProgram', /findProgram\(/.test(krop(helperJs, 'export async function resolveBundleId(')));
check('5 resolveApp (hvem er forrest) bruger findProgram', /findProgram\(/.test(krop(helperJs, 'export async function resolveApp(')));
const ax = readFileSync(join(KILDE, 'Accessibility.swift'), 'utf8');
const swiftKrop = (start) => { const i = ax.indexOf(start); return i < 0 ? '' : ax.slice(i, ax.indexOf('\n    }\n', i)); };
check('6a et koerende program slaas op med Navne.vaelg (AX.app)', /Navne\.vaelg\(/.test(swiftKrop('static func app(bundleId: String)')));
check('6b et lukket program paa disken slaas op med Navne.vaelg (programURL)', /Navne\.vaelg\(/.test(swiftKrop('static func programURL(')));

// 7-8 · gennem serverens rigtige opslag, med en attrap der svarer som Gustavs Mac
const h = lavFalskHjaelper('cmcp-usynlige');
process.env.CMCP_HELPER = h.sti;
const { resolveBundleId, resolveApp } = await import(join(ROOT, 'mcp-server', 'helper.js'));
h.saetSvar({ apps: { apps: [
  { name: 'Finder', bundleId: 'com.apple.finder', pid: 3301, active: false },
  { name: `${LRM}WhatsApp`, bundleId: 'net.whatsapp.WhatsApp', pid: 3303, active: false },
] } });
const bid = await resolveBundleId('WhatsApp');
check('7 porten ser net.whatsapp.WhatsApp for app "WhatsApp"', bid === 'net.whatsapp.WhatsApp', String(bid));
const ra = await resolveApp('WhatsApp');
check('8 resolveApp ser samme program', ra?.bundleId === 'net.whatsapp.WhatsApp', JSON.stringify(ra));

// 9 · den rigtige hjaelper paa en Mac hvor WhatsApp ligger med det usynlige tegn
const harWhatsApp = ['/Applications'].some(m => { try { return readdirSync(m).includes(`${LRM}WhatsApp.app`); } catch { return false; } });
const hjaelper = [join(ROOT, 'helper', '.build', 'release', 'cmcp-helper'), join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper')].find(p => existsSync(p));
if (harWhatsApp && hjaelper) {
  let r; try { r = JSON.parse(execFileSync(hjaelper, ['resolve-app', '--app', 'WhatsApp'], { encoding: 'utf8', timeout: 15000 })); } catch (e) { r = { fejl: String(e.stdout || e.message).slice(0, 200) }; }
  check(`9 den rigtige hjaelper finder /Applications/${LRM}WhatsApp.app ud fra "WhatsApp"`, r.bundleId === 'net.whatsapp.WhatsApp', JSON.stringify(r));
} else {
  console.log(`SPR. 9 den rigtige hjaelper - ${harWhatsApp ? 'ingen bygget hjaelper' : 'WhatsApp ligger ikke med det usynlige tegn paa denne Mac'}`);
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
