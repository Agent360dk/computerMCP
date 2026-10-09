// USYNLIGE NAVNE: «WhatsApp» skal finde «‎WhatsApp» - i porten OG i leveringen,
// og de to skal ALTID vaelge det samme program.
//
// ⛔ 9/10 (F1 paa Gustavs Mac): WhatsApp ligger som /Applications/‎WhatsApp.app og
//    hedder «‎WhatsApp» naar den koerer. `app: "WhatsApp"` blev «ukendt maal».
// ⛔ R16 (Astra + Opus, MAALT): foerste rettelse brugte Swifts egne regler (trim med
//    U+0085/U+200B, smaa bogstaver paa hele strengen, kanonisk ==), saa porten og
//    hjaelperen kunne vaelge forskellige programmer - «Computer MCP\u0085» var ukendt
//    for porten og menulinje-ikonet for hjaelperen. Proeven er derfor tre ting:
//      A. samme tabeller gennem serverens findProgram og hjaelperens Navne (Swift)
//      B. de tre tegn-regler (trim, usynlige tegn, smaa bogstaver) sammenlignet for
//         HVERT Unicode-tegn mellem JS og Swift
//      C. kaldestederne bundet: hjaelperen slaar kun navne op gennem Navne, og
//         ellers sammenlignes kun id'er
//    Ingen skaerm, intet program startes.
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

const LRM = '‎', RLM = '‏', ZWSP = '​', NEL = '\u0085', BOM = '﻿';
// A1 · navne alene: [navne, hvad agenten skriver, forventet indeks (null = intet), hvad maales]
const NAVNE = [
  [['Finder', `${LRM}WhatsApp`], 'WhatsApp', 1, 'usynligt tegn foran navnet'],
  [[`${LRM}WhatsApp`, `WhatsApp${RLM}`], 'WhatsApp', null, 'to passer uden de usynlige tegn: intet vaelges'],
  [['WhatsApp', `${LRM}WhatsApp`], 'WhatsApp', 0, 'et praecist navn vinder over et der kun passer uden usynlige tegn'],
  [[`${LRM}WhatsApp`, 'WhatsApp'], 'WhatsApp', 1, 'samme, omvendt raekkefoelge'],
  [['WhatsApp', `${LRM}WhatsApp`], `${LRM}WhatsApp`, 1, 'det usynlige navn kopieret ordret vaelger sig selv'],
  [[`${LRM}WhatsApp`], LRM, null, 'kun usynlige tegn finder intet'],
  [[`${LRM}WhatsApp`], 'WhatsAp', null, 'et andet navn finder intet'],
  [['Notes'], 'notes', 0, 'store/smaa bogstaver som foer'],
  [[`Whats${ZWSP}App`], 'whatsapp', 0, 'usynligt tegn inde i navnet'],
  [['Notes', 'Noter'], 'Note', null, 'et forkortet navn finder intet'],
  [['Computer MCP'], `Computer MCP${NEL}`, null, 'U+0085 i kanten fjernes ikke (Opus R16)'],
  [[`${ZWSP}Passwords`, 'Passwords'], `${ZWSP}Passwords`, 0, 'U+200B i kanten fjernes ikke (Astra R16)'],
  [[`${NEL}Notes`, 'Notes'], `${NEL}Notes`, 0, 'U+0085 foran: det praecise navn'],
  [[`${BOM}Notes`, 'Notes'], `${BOM}Notes`, 1, 'U+FEFF i kanten fjernes (som JS trim)'],
  [['ος', 'οσ'], 'ΟΣ', 1, 'smaa bogstaver tegn for tegn (ingen graesk slut-sigma)'],
  [['é', 'é'], 'é', 1, 'sammenligning paa tegn, ikke kanonisk lighed'],
  [['  Notes'], 'Notes', 0, 'mellemrum foran navnet: passer uden usynlige tegn og kanter'],
  [['Notes'], '   ', null, 'kun mellemrum finder intet'],
];
// A2 · koerende programmer med id: [ids, navne, ønske, forventet, hvad]
const APPS = [
  [['dk.SAFE', 'com.apple.Passwords'], ['Harmless', 'dk.safe'], 'dk.safe', 0, 'bundle-id uden hensyn til store/smaa bogstaver foer navne (Astra R16)'],
  [['com.x.App', 'com.x.app'], ['A', 'B'], 'com.x.app', 1, 'et praecist bundle-id vinder over ét der kun passer uden store/smaa'],
  [[null, 'dk.y'], ['Y', 'Z'], 'Y', 0, 'et program uden id findes paa navnet'],
  [['net.whatsapp.WhatsApp', 'com.apple.finder'], [`${LRM}WhatsApp`, 'Finder'], 'WhatsApp', 0, 'Gustavs Mac'],
  [['dk.a'], ['A'], ` dk.a${BOM}`, 0, 'id med kanter'],
  [['dk.a', 'dk.b'], [`${LRM}X`, `X${RLM}`], 'X', null, 'tvetydigt navn'],
];
// A3 · oversaettelsen ved hjaelperens indgang: [argv, opslag, forventet argv, hvad]
const OVERSAET = [
  [['h', 'find', '--app', 'WhatsApp', '--role', 'AXButton'], { WhatsApp: 'net.whatsapp.WhatsApp' }, ['h', 'find', '--app', 'net.whatsapp.WhatsApp', '--role', 'AXButton'], 'navnet bliver til id'],
  [['h', 'find', '--app', '--role', 'AXButton'], { '--role': 'x' }, ['h', 'find', '--app', '--role', 'AXButton'], '--app uden vaerdi roeres ikke'],
  [['h', 'find', '--app', 'Ukendt'], {}, ['h', 'find', '--app', 'Ukendt'], 'intet opslag: uroert'],
  [['h', 'windows', '--app'], { '': 'x' }, ['h', 'windows', '--app'], '--app sidst roeres ikke'],
];

const { findProgram } = await import(join(ROOT, 'mcp-server', 'helper.js'));
const jsNavne = NAVNE.map(([navne, want]) => {
  const apps = navne.map((name, i) => ({ name, bundleId: `dk.proeve.${i}` }));
  const hit = findProgram(apps, want); return hit ? apps.indexOf(hit) : null;
});
const jsApps = APPS.map(([ids, navne, want]) => {
  const apps = ids.map((bundleId, i) => ({ bundleId: bundleId ?? '', name: navne[i] }));
  const hit = findProgram(apps, want); return hit ? apps.indexOf(hit) : null;
});

// B · tegn-reglerne i JS, for hvert Unicode-tegn
const alleTegn = function* () { for (let cp = 0; cp <= 0x10FFFF; cp++) if (cp < 0xD800 || cp > 0xDFFF) yield cp; };
const jsTrim = [], jsCf = [], jsSmaa = [];
for (const cp of alleTegn()) {
  const c = String.fromCodePoint(cp);
  if ((c + 'x').trim() === 'x') jsTrim.push(cp);
  if (/\p{Cf}/u.test(c)) jsCf.push(cp);
  const l = c.toLowerCase(); if (l !== c) jsSmaa.push(`${cp.toString(16)}:${Array.from(l, x => x.codePointAt(0).toString(16)).join(',')}`);
}

// A + B · hjaelperens Navne.swift, kompileret for sig
const ARB = mkdtempSync(join(tmpdir(), 'cmcp-usynlige-navne-'));
writeFileSync(join(ARB, 'main.swift'), `import Foundation
struct N: Decodable { let navne: [String]; let want: String }
struct A: Decodable { let ids: [String?]; let navne: [String?]; let want: String }
struct O: Decodable { let argv: [String]; let opslag: [String: String] }
struct Ind: Decodable { let navne: [N]; let apps: [A]; let oversaet: [O] }
let ind = try! JSONDecoder().decode(Ind.self, from: FileHandle.standardInput.readDataToEndOfFile())
func tal(_ v: Navne.Valg) -> Any { if case .fundet(let i) = v { return i }; return NSNull() }
var trim: [Int] = [], cf: [Int] = [], smaa: [String] = []
for cp in 0...0x10FFFF where cp < 0xD800 || cp > 0xDFFF {
  let s = Unicode.Scalar(UInt32(cp))!
  if Navne.kant.contains(UInt32(cp)) { trim.append(cp) }
  if s.properties.generalCategory == .format { cf.append(cp) }
  let l = Navne.smaa([s]); if l != [s] { smaa.append(String(cp, radix: 16) + ":" + l.map { String($0.value, radix: 16) }.joined(separator: ",")) }
}
let ud: [String: Any] = [
  "navne": ind.navne.map { tal(Navne.vaelg($0.navne, $0.want)) },
  "tvetydig": ind.navne.map { Navne.vaelg($0.navne, $0.want) == .tvetydig },
  "apps": ind.apps.map { tal(Navne.vaelgApp(ids: $0.ids, navne: $0.navne, want: $0.want)) },
  "oversaet": ind.oversaet.map { o in Navne.oversaet(o.argv) { o.opslag[$0] } },
  "trim": trim, "cf": cf, "smaa": smaa]
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ud))
`);
const BIN = join(ARB, 'navne');
execFileSync('swiftc', ['-O', join(KILDE, 'Navne.swift'), join(ARB, 'main.swift'), '-o', BIN], { stdio: 'pipe', timeout: 300000 });
const sw = JSON.parse(execFileSync(BIN, { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000, input: JSON.stringify({
  navne: NAVNE.map(([navne, want]) => ({ navne, want })),
  apps: APPS.map(([ids, navne, want]) => ({ ids, navne, want })),
  oversaet: OVERSAET.map(([argv, opslag]) => ({ argv, opslag })),
}) }));

NAVNE.forEach(([, , forventet, hvad], i) => {
  check(`1.${i + 1} serveren: ${hvad}`, jsNavne[i] === forventet, `fik ${jsNavne[i]}, ventede ${forventet}`);
  check(`2.${i + 1} hjaelperen: ${hvad}`, sw.navne[i] === forventet, `fik ${sw.navne[i]}, ventede ${forventet}`);
});
APPS.forEach(([, , , forventet, hvad], i) => {
  check(`1a.${i + 1} serveren (id+navn): ${hvad}`, jsApps[i] === forventet, `fik ${jsApps[i]}, ventede ${forventet}`);
  check(`2a.${i + 1} hjaelperen (id+navn): ${hvad}`, sw.apps[i] === forventet, `fik ${sw.apps[i]}, ventede ${forventet}`);
});
check('2b et tvetydigt navn er sit eget svar i hjaelperen (ingen faldbag til disken)', sw.tvetydig[1] === true && sw.tvetydig[0] === false);
OVERSAET.forEach(([, , forventet, hvad], i) =>
  check(`2c.${i + 1} oversaettelsen ved indgangen: ${hvad}`, JSON.stringify(sw.oversaet[i]) === JSON.stringify(forventet), JSON.stringify(sw.oversaet[i])));
const forskel = (a, b) => { const s = new Set(b.map(String)); const t = new Set(a.map(String));
  return [...a.filter(x => !s.has(String(x))), ...b.filter(x => !t.has(String(x)))].slice(0, 6); };
check(`3a trim: samme ${jsTrim.length} tegn i JS og Swift`, jsTrim.length === sw.trim.length && forskel(jsTrim, sw.trim).length === 0, JSON.stringify(forskel(jsTrim, sw.trim)));
check(`3b usynlige tegn (Cf): samme ${jsCf.length} tegn i JS og Swift`, forskel(jsCf, sw.cf).length === 0, JSON.stringify(forskel(jsCf, sw.cf)));
check(`3c smaa bogstaver: samme ${jsSmaa.length} tegn i JS og Swift`, forskel(jsSmaa, sw.smaa).length === 0, JSON.stringify(forskel(jsSmaa, sw.smaa)));

// C · kaldestederne
const helperJs = readFileSync(join(ROOT, 'mcp-server', 'helper.js'), 'utf8');
const krop = (src, start) => { const i = src.indexOf(start); return i < 0 ? '' : src.slice(i, src.indexOf('\n}', i)); };
check('4 resolveBundleId (porten) bruger findProgram', /findProgram\(/.test(krop(helperJs, 'export async function resolveBundleId(')));
check('5 resolveApp (hvem er forrest) bruger findProgram', /findProgram\(/.test(krop(helperJs, 'export async function resolveApp(')));
const kilder = readdirSync(KILDE).filter(f => f.endsWith('.swift'));
const src = Object.fromEntries(kilder.map(f => [f, readFileSync(join(KILDE, f), 'utf8')]));
const ax = src['Accessibility.swift'], mainSwift = src['main.swift'];
check('6a AX.app er opslaget og intet andet', /static func app\(bundleId: String\) -> NSRunningApplication\? \{ appOpslag\(bundleId\)\.app \}/.test(ax));
check('6a2 opslaget vaelger med Navne.vaelgApp og returnerer netop det valgte',
  /Navne\.vaelgApp\(ids: alle\.map \{ \$0\.bundleIdentifier \}, navne: alle\.map \{ \$0\.localizedName \}, want: hvad\) \{\n\s+case \.fundet\(let i\): return \(alle\[i\], false\)\n\s+case \.tvetydig: return \(nil, true\)\n\s+case \.intet: return \(nil, false\)/.test(ax));
check('6b programmer paa disken: Navne.vaelg og netop det valgte', /guard case \.fundet\(let i\) = Navne\.vaelg\(fund\.map \{ \$0\.deletingPathExtension\(\)\.lastPathComponent \}, hvad\) else \{ return nil \}\n\s+return fund\[i\]/.test(ax));
check('6c --app oversaettes ét sted, foer alle kommandoer', /^let args = Args\(Navne\.oversaet\(CommandLine\.arguments\) \{ AX\.app\(bundleId: \$0\)\?\.bundleIdentifier \}\)/m.test(mainSwift));
const navneSammenligninger = kilder.flatMap(f => src[f].split('\n').map((l, i) => ({ f, n: i + 1, l })))
  .filter(({ f, l }) => f !== 'Navne.swift' && /(localizedName|applicationName)\??\.lowercased\(\)/.test(l));
check('6d ingen anden sammenligning af programnavne end adgangskode-tjekket (kun et ekstra afslag)',
  navneSammenligninger.length === 1 && navneSammenligninger[0].f === 'Capture.swift'
  && /let navngivet = content\.applications\.filter \{\n\s+\$0\.bundleIdentifier == bid \|\| \$0\.applicationName\.lowercased\(\) == bid\.lowercased\(\)\n\s+\}\n\s+let axNavngivet/.test(src['Capture.swift']),
  navneSammenligninger.map(x => `${x.f}:${x.n}`).join(', '));
check('6e opstarten stopper ved et tvetydigt navn - baade opslaget og selve starten',
  /let o = appOpslag\(hvad\)\n\s+if let k = o\.app \{ return \(k\.bundleIdentifier, true\) \}\n\s+if o\.tvetydig \{ return \(nil, false\) \}/.test(ax)
  && /let opslag = appOpslag\(hvad\)\n\s+if opslag\.tvetydig \{/.test(ax));
check('6f leveringen (modtager) bruger kun opslaget', /guard let app = AX\.app\(bundleId: navn\) else \{/.test(mainSwift));

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

// 9-11 · den rigtige hjaelper
const hjaelper = [join(ROOT, 'helper', '.build', 'release', 'cmcp-helper'), join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper')].find(p => existsSync(p));
const j = (a) => { try { return JSON.parse(execFileSync(hjaelper, a, { encoding: 'utf8', timeout: 15000 })); } catch (e) { try { return JSON.parse(String(e.stdout)); } catch { return { fejl: String(e.message).slice(0, 160) }; } } };
if (!hjaelper) console.log('SPR. 9-11 ingen bygget hjaelper');
else {
  const koerende = (j(['apps', '--all']).apps || []).map(a => a.bundleId);
  // 11 · R2 (Opus): bindingen maalt paa et program der koerer paa enhver Mac
  if (koerende.includes('com.apple.finder')) {
    check('11a resolve-app --app Finder: navnet er oversat til id ved indgangen', j(['resolve-app', '--app', 'Finder']).app === 'com.apple.finder');
    check('11b resolve-app --app finder: smaa bogstaver', j(['resolve-app', '--app', 'finder']).app === 'com.apple.finder');
    check(`11c resolve-app --app "Finder\\u0085": U+0085 fjernes ikke - intet fundet`, j(['resolve-app', '--app', `Finder${NEL}`]).bundleId == null);
  } else console.log('SPR. 11 Finder koerer ikke');
  const harWhatsApp = (() => { try { return readdirSync('/Applications').includes(`${LRM}WhatsApp.app`); } catch { return false; } })();
  if (harWhatsApp) {
    const r = j(['resolve-app', '--app', 'WhatsApp']);
    check(`9 den rigtige hjaelper finder /Applications/${LRM}WhatsApp.app ud fra "WhatsApp"`, r.bundleId === 'net.whatsapp.WhatsApp', JSON.stringify(r).slice(0, 160));
  } else console.log('SPR. 9 WhatsApp ligger ikke med det usynlige tegn paa denne Mac');
  if (koerende.includes('net.whatsapp.WhatsApp')) {
    const vn = j(['windows', '--app', 'WhatsApp']), vi = j(['windows', '--app', 'net.whatsapp.WhatsApp']);
    check('10a windows --app WhatsApp = samme vinduer som med id', vn.count >= 1 && vn.count === vi.count, `navn ${vn.count} · id ${vi.count}`);
    const fn = j(['find', '--app', 'WhatsApp', '--role', 'AXButton', '--limit', '3']), fi = j(['find', '--app', 'net.whatsapp.WhatsApp', '--role', 'AXButton', '--limit', '3']);
    check('10b find --app WhatsApp = samme fund som med id', fn.count >= 1 && fn.count === fi.count, `navn ${fn.count} · id ${fi.count}`);
  } else console.log('SPR. 10 WhatsApp koerer ikke - find og vinduer med navnet er ikke maalt');
}

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
