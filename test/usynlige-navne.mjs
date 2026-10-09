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
const VIS = { ids: ['com.apple.SafariPlatformSupport.Helper', 'com.apple.SafariPlatformSupport.Helper', 'com.google.Chrome', 'com.google.Chrome'],
              navne: ['Autoudfyld (Agent360 IDE)', 'Autoudfyld (Google Chrome)', 'Google Chrome', 'Google Chrome'] };
// A2 · koerende programmer med id: [ids, navne, ønske, forventet, hvad]
const APPS = [
  [['dk.SAFE', 'com.apple.Passwords'], ['Harmless', 'dk.safe'], 'dk.safe', 0, 'bundle-id uden hensyn til store/smaa bogstaver foer navne (Astra R16)'],
  [['com.x.App', 'com.x.app'], ['A', 'B'], 'com.x.app', 1, 'et praecist bundle-id vinder over ét der kun passer uden store/smaa'],
  [[null, 'dk.y'], ['Y', 'Z'], 'Y', 0, 'et program uden id findes paa navnet'],
  [['net.whatsapp.WhatsApp', 'com.apple.finder'], [`${LRM}WhatsApp`, 'Finder'], 'WhatsApp', 0, 'Gustavs Mac'],
  [['dk.a'], ['A'], ` dk.a${BOM}`, 0, 'id med kanter'],
  [['dk.a', 'dk.b'], [`${LRM}X`, `X${RLM}`], 'X', null, 'tvetydigt navn'],
  // R18 (Opus, maalt live 9/10): visningstjenester - samme id, hvert sit navn. Leveringen gaar til
  // id'et, ikke processen, saa navnet er tvetydigt. To Chrome-vinduer med SAMME navn er ikke.
  [VIS.ids, VIS.navne, 'Autoudfyld (Google Chrome)', null, 'en visningstjeneste: id delt med et andet navn - afvist'],
  [VIS.ids, VIS.navne, 'Autoudfyld (Agent360 IDE)', null, 'ogsaa den anden visningstjeneste'],
  [VIS.ids, VIS.navne, 'Google Chrome', 2, 'to processer med samme id OG samme navn: den foerste, som foer'],
  // R19 (Opus): ruten UDEN det usynlige tegn - navnet findes saadan paa Gustavs Mac (maalt)
  [['com.apple.ThemeWidgetControlViewService', 'com.apple.ThemeWidgetControlViewService'],
   ['ThemeWidgetControlViewService (Finder)', `${LRM}ThemeWidgetControlViewService (WhatsApp)`],
   'ThemeWidgetControlViewService (WhatsApp)', null, 'en visningstjeneste fundet uden sit usynlige tegn: stadig afvist'],
  [VIS.ids, VIS.navne, 'com.apple.SafariPlatformSupport.Helper', 0, 'id\'et selv: den foerste proces med id\'et, som foer'],
];
// A3 · oversaettelsen ved hjaelperens indgang: [argv, opslag, forventet argv, hvad]
const OVERSAET = [
  [['h', 'find', '--app', 'WhatsApp', '--role', 'AXButton'], { WhatsApp: 'net.whatsapp.WhatsApp' }, [], { argv: ['h', 'find', '--app', 'net.whatsapp.WhatsApp', '--role', 'AXButton'], bundet: false }, 'navnet bliver til id'],
  [['h', 'find', '--app', '--role', 'AXButton'], { '--role': 'x' }, [], { argv: ['h', 'find', '--app', '--role', 'AXButton'], bundet: false }, '--app uden vaerdi roeres ikke'],
  [['h', 'find', '--app', 'Ukendt'], {}, [], { argv: ['h', 'find', '--app', 'Ukendt'], bundet: false }, 'intet opslag: uroert'],
  [['h', 'windows', '--app'], { '': 'x' }, [], { argv: ['h', 'windows', '--app'], bundet: false }, '--app sidst roeres ikke'],
  // R17: et maal porten har bundet (`=<id>`) - kun det praecise id, ellers intet
  [['h', 'type', '--app', '=net.whatsapp.WhatsApp'], {}, ['net.whatsapp.WhatsApp'], { argv: ['h', 'type', '--app', 'net.whatsapp.WhatsApp'], bundet: true }, 'bundet id der koerer: det praecise id, og resten af hjaelperen ved at det er bundet'],
  [['h', 'type', '--app', '=net.whatsapp.WhatsApp'], { '=net.whatsapp.WhatsApp': 'dk.andet', 'net.whatsapp.WhatsApp': 'dk.andet' }, [], null, 'bundet id der ikke koerer: intet - aldrig et navneopslag'],
  [['h', 'type', '--app', '=NET.whatsapp.WhatsApp'], {}, ['net.whatsapp.WhatsApp'], null, 'bundet id med andre store/smaa: intet'],
  [['h', 'type', '--app', '='], {}, [''], null, 'tomt bundet id: intet'],
];
// R17 · serverens side af det bundne maal: [apps (id, navn), oenske, forventet indeks]
// R18 · «pid:<n>» er reserveret til programmer uden id - ens i porten og hjaelperen
const PIDS = [
  [[{ bundleId: '', name: 'Probe', pid: 5 }], 'pid:5', 0, 'et program uden id findes paa sin proces'],
  [[{ bundleId: 'dk.x', name: 'pid:5', pid: 9 }], 'pid:5', null, 'et program der HEDDER «pid:5» naas ikke ad den vej'],
  [[{ bundleId: 'dk.x', name: 'X', pid: 5 }], 'pid:5', null, 'et program MED id naas ikke paa sin proces'],
];
const BUNDNE = [
  [[['dk.a', 'X'], ['dk.b', 'Y']], '=dk.b', 1, 'det praecise id'],
  [[['DK.A', 'X']], '=dk.a', null, 'andre store/smaa: intet'],
  [[['dk.z', 'dk.a']], '=dk.a', null, 'et program der HEDDER som id\'et: intet'],
  [[['dk.a', 'X']], '=', null, 'tomt: intet'],
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
struct O: Decodable { let argv: [String]; let opslag: [String: String]; let findes: [String] }
struct Ind: Decodable { let navne: [N]; let apps: [A]; let oversaet: [O]; let jsKoder: [Int] }
let ind = try! JSONDecoder().decode(Ind.self, from: FileHandle.standardInput.readDataToEndOfFile())
func tal(_ v: Navne.Valg) -> Any { if case .fundet(let i) = v { return i }; return NSNull() }
var trim: [Int] = [], cf: [Int] = [], smaa: [String] = []
var maxAlder = (0, 0)
for cp in 0...0x10FFFF where cp < 0xD800 || cp > 0xDFFF {
  let s = Unicode.Scalar(UInt32(cp))!
  if Navne.kant.contains(UInt32(cp)) { trim.append(cp) }
  if s.properties.generalCategory == .format { cf.append(cp) }
  let l = Navne.smaa([s]); if l != [s] { smaa.append(String(cp, radix: 16) + ":" + l.map { String($0.value, radix: 16) }.joined(separator: ",")) }
  if let a = s.properties.age, (a.major, a.minor) > maxAlder { maxAlder = (a.major, a.minor) }
}
let ud: [String: Any] = [
  "navne": ind.navne.map { tal(Navne.vaelg($0.navne, $0.want)) },
  "tvetydig": ind.navne.map { Navne.vaelg($0.navne, $0.want) == .tvetydig },
  "apps": ind.apps.map { tal(Navne.vaelgApp(ids: $0.ids, navne: $0.navne, want: $0.want)) },
  "oversaet": ind.oversaet.map { o -> Any in
    guard let r = Navne.oversaet(o.argv, slaaOp: { o.opslag[$0] }, findesPraecist: { o.findes.contains($0) }) else { return NSNull() }
    return ["argv": r.argv, "bundet": r.bundet] },
  "id": [Navne.id(bundleId: nil, pid: 5), Navne.id(bundleId: "", pid: 6), Navne.id(bundleId: "dk.a", pid: 7)],
  "trim": trim, "cf": cf, "smaa": smaa,
  // Tegn JS kender, men denne Swift-runtime ikke har i sine tabeller (Unicode-version, R17 Opus).
  "ukendteAfJs": ind.jsKoder.filter { Unicode.Scalar(UInt32($0)).map { $0.properties.age == nil } ?? true },
  "unicode": String(maxAlder.0) + "." + String(maxAlder.1)]
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ud))
`);
const BIN = join(ARB, 'navne');
execFileSync('swiftc', ['-O', join(KILDE, 'Navne.swift'), join(ARB, 'main.swift'), '-o', BIN], { stdio: 'pipe', timeout: 300000 });
const sw = JSON.parse(execFileSync(BIN, { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 300000, input: JSON.stringify({
  navne: NAVNE.map(([navne, want]) => ({ navne, want })),
  apps: APPS.map(([ids, navne, want]) => ({ ids, navne, want })),
  oversaet: OVERSAET.map(([argv, opslag, findes]) => ({ argv, opslag, findes })),
  jsKoder: [...jsCf, ...jsSmaa.map(e => parseInt(e.split(':')[0], 16))],
}) }));

NAVNE.forEach(([, , forventet, hvad], i) => {
  check(`1.${i + 1} serveren: ${hvad}`, jsNavne[i] === forventet, `fik ${jsNavne[i]}, ventede ${forventet}`);
  check(`2.${i + 1} hjaelperen: ${hvad}`, sw.navne[i] === forventet, `fik ${sw.navne[i]}, ventede ${forventet}`);
});
APPS.forEach(([, , , forventet, hvad], i) => {
  check(`1a.${i + 1} serveren (id+navn): ${hvad}`, jsApps[i] === forventet, `fik ${jsApps[i]}, ventede ${forventet}`);
  check(`2a.${i + 1} hjaelperen (id+navn): ${hvad}`, sw.apps[i] === forventet, `fik ${sw.apps[i]}, ventede ${forventet}`);
});
PIDS.forEach(([apps, want, forventet, hvad], i) => {
  const hit = findProgram(apps, want);
  check(`1c.${i + 1} serveren, pid: ${hvad}`, (hit ? apps.indexOf(hit) : null) === forventet, JSON.stringify(hit));
});
BUNDNE.forEach(([apps, want, forventet, hvad], i) => {
  const liste = apps.map(([bundleId, name]) => ({ bundleId, name }));
  const hit = findProgram(liste, want);
  check(`1b.${i + 1} serveren, bundet maal: ${hvad}`, (hit ? liste.indexOf(hit) : null) === forventet, JSON.stringify(hit));
});
check('2b et tvetydigt navn er sit eget svar i hjaelperen (ingen faldbag til disken)', sw.tvetydig[1] === true && sw.tvetydig[0] === false);
OVERSAET.forEach(([, , , forventet, hvad], i) =>
  check(`2c.${i + 1} oversaettelsen ved indgangen: ${hvad}`,
    JSON.stringify(sw.oversaet[i] && { argv: sw.oversaet[i].argv, bundet: sw.oversaet[i].bundet }) === JSON.stringify(forventet), JSON.stringify(sw.oversaet[i])));
const forskel = (a, b) => { const s = new Set(b.map(String)); const t = new Set(a.map(String));
  return [...a.filter(x => !s.has(String(x))), ...b.filter(x => !t.has(String(x)))].slice(0, 6); };
check(`3a trim: samme ${jsTrim.length} tegn i JS og Swift`, jsTrim.length === sw.trim.length && forskel(jsTrim, sw.trim).length === 0, JSON.stringify(forskel(jsTrim, sw.trim)));
// ⛔ CI 9/10 (a6673b4, som Opus forudsagde i R17): GitHubs Mac har Node med Unicode 17 og en
//    Swift-runtime med aeldre tabeller; 28 nye tegn (fx U+A7CE) faar smaa bogstaver i JS men ikke i
//    Swift. Reglen er den samme - runtimes kender forskellige tegn. Sammenlign derfor de tegn BEGGE
//    kender, og sig hvor mange der er udeladt. Konsekvensen er en KENDT GRAENSE for ubundne laeseveje;
//    skrivninger er bundet til det praecise id (bundet-maal.mjs).
const swUkendt = new Set(sw.ukendteAfJs);
const kendtJs = (cp) => !/\p{Cn}/u.test(String.fromCodePoint(cp));
const kp = (e) => typeof e === 'number' ? e : parseInt(String(e).split(':')[0], 16);
const begge = (e) => kendtJs(kp(e)) && !swUkendt.has(kp(e));
const jsCfB = jsCf.filter(begge), swCfB = sw.cf.filter(begge), jsSmaaB = jsSmaa.filter(begge), swSmaaB = sw.smaa.filter(begge);
const udeladt = (jsCf.length - jsCfB.length) + (sw.cf.length - swCfB.length) + (jsSmaa.length - jsSmaaB.length) + (sw.smaa.length - swSmaaB.length);
const vers = `Node Unicode ${process.versions.unicode}, Swift ${sw.unicode}`;
check(`3b usynlige tegn (Cf): samme ${jsCfB.length} tegn i JS og Swift (${vers})`, forskel(jsCfB, swCfB).length === 0, JSON.stringify(forskel(jsCfB, swCfB)));
check(`3c smaa bogstaver: samme ${jsSmaaB.length} tegn i JS og Swift (${vers})`, forskel(jsSmaaB, swSmaaB).length === 0, JSON.stringify(forskel(jsSmaaB, swSmaaB)));
check(`3d kun tegn den ene runtime ikke kender er udeladt (${udeladt}), og de er faa`, udeladt <= 200, String(udeladt));

// C · kaldestederne
const helperJs = readFileSync(join(ROOT, 'mcp-server', 'helper.js'), 'utf8');
const krop = (src, start) => { const i = src.indexOf(start); return i < 0 ? '' : src.slice(i, src.indexOf('\n}', i)); };
check('4 resolveBundleId (porten) bruger findProgram', /findProgram\(/.test(krop(helperJs, 'export async function resolveBundleId(')));
check('5 resolveApp (hvem er forrest) bruger findProgram', /findProgram\(/.test(krop(helperJs, 'export async function resolveApp(')));
const kilder = readdirSync(KILDE).filter(f => f.endsWith('.swift'));
const src = Object.fromEntries(kilder.map(f => [f, readFileSync(join(KILDE, f), 'utf8')]));
const ax = src['Accessibility.swift'], mainSwift = src['main.swift'];
check('6a AX.app er opslaget og intet andet', /static func app\(bundleId: String\) -> NSRunningApplication\? \{ appOpslag\(bundleId\)\.app \}/.test(ax));
check('6a2 opslaget vaelger med Navne.vaelgApp og returnerer netop det valgte - intet foer det (R17, Astra A17)',
  /static func appOpslag\(_ hvad: String\) -> \(app: NSRunningApplication\?, tvetydig: Bool\) \{\n\s+let alle = allApps\(\)\n\s+\/\/[^\n]*\n\s+if kunPraecistId \{ return \(alle\.first \{ \$0\.bundleIdentifier == hvad \}, false\) \}\n\s+\/\/[^\n]*\n\s+if hvad\.hasPrefix\("pid:"\) \{ return \(alle\.first \{ Navne\.id\(bundleId: \$0\.bundleIdentifier, pid: \$0\.processIdentifier\) == hvad \}, false\) \}\n\s+switch Navne\.vaelgApp\(ids: alle\.map \{ \$0\.bundleIdentifier \}, navne: alle\.map \{ \$0\.localizedName \}, want: hvad\) \{\n\s+case \.fundet\(let i\): return \(alle\[i\], false\)\n\s+case \.tvetydig: return \(nil, true\)\n\s+case \.intet: return \(nil, false\)/.test(ax));
check('6b programmer paa disken: praecist filnavn, ellers Navne.vaelg over HELE listen og netop det valgte (R17, Astra A18)',
  /if FileManager\.default\.fileExists\(atPath: k\.path\) \{ return k \}\n\s+\}\n(\s+\/\/[^\n]*\n)*\s+var fund: \[URL\] = \[\]\n\s+for m in mapper \{\n\s+for f in \(try\? FileManager\.default\.contentsOfDirectory\(atPath: m\)\) \?\? \[\] where f\.hasSuffix\("\.app"\) \{\n\s+fund\.append\(URL\(fileURLWithPath: m\)\.appendingPathComponent\(f\)\)\n\s+\}\n\s+\}\n\s+/.test(ax) && /guard case \.fundet\(let i\) = Navne\.vaelg\(fund\.map \{ \$0\.deletingPathExtension\(\)\.lastPathComponent \}, hvad\) else \{ return nil \}\n\s+return fund\[i\]/.test(ax));
check('6h et bundet maal holder hele vejen gennem hjaelperen: kun praecist id, ingen disk (R18, Astra)',
  /^AX\.kunPraecistId = oversatArgv\.bundet\nlet args = Args\(oversatArgv\.argv\)/m.test(mainSwift)
  && /if kunPraecistId \{ return \(alle\.first \{ \$0\.bundleIdentifier == hvad \}, false\) \}/.test(ax)
  && /if o\.tvetydig \|\| kunPraecistId \{ return \(nil, false\) \}/.test(ax)
  && /let opslag = appOpslag\(hvad\)\n\s+if kunPraecistId && opslag\.app == nil \{\n\s+return \(false,/.test(ax));
check('6c --app oversaettes ét sted, foer alle kommandoer, og et bundet maal der er vaek er en fejl',
  /^guard let oversatArgv = Navne\.oversaet\(CommandLine\.arguments, slaaOp: \{ AX\.app\(bundleId: \$0\)\.map \{ Navne\.id\(bundleId: \$0\.bundleIdentifier, pid: \$0\.processIdentifier\) \} \},\n\s+findesPraecist: \{ id in AX\.allApps\(\)\.contains \{ \$0\.bundleIdentifier == id \} \}\) else \{\n\s+Out\.fail\("the app the gate judged is no longer running - nothing was done", code: "app-gone"\)\n\}\nAX\.kunPraecistId = oversatArgv\.bundet\nlet args = Args\(oversatArgv\.argv\)/m.test(mainSwift));
const navneSammenligninger = kilder.flatMap(f => src[f].split('\n').map((l, i) => ({ f, n: i + 1, l })))
  .filter(({ f, l }) => f !== 'Navne.swift' && /(localizedName|applicationName)\??\.lowercased\(\)/.test(l));
check('6d ingen anden sammenligning af programnavne end adgangskode-tjekket (kun et ekstra afslag)',
  navneSammenligninger.length === 1 && navneSammenligninger[0].f === 'Capture.swift'
  && /let navngivet = content\.applications\.filter \{\n\s+\$0\.bundleIdentifier == bid \|\| \$0\.applicationName\.lowercased\(\) == bid\.lowercased\(\)\n\s+\}\n\s+let axNavngivet/.test(src['Capture.swift']),
  navneSammenligninger.map(x => `${x.f}:${x.n}`).join(', '));
check('6e opstarten stopper ved et tvetydigt navn - baade opslaget og selve starten',
  /let o = appOpslag\(hvad\)\n\s+if let k = o\.app \{ return \(k\.bundleIdentifier, true\) \}\n\s+\/\/[^\n]*\n\s+if o\.tvetydig \|\| kunPraecistId \{ return \(nil, false\) \}/.test(ax)
  && /let opslag = appOpslag\(hvad\)\n\s+if kunPraecistId && opslag\.app == nil \{[\s\S]{0,160}\n\s+if opslag\.tvetydig \{/.test(ax));
check('2d et program uden id faar sin proces som id (pid:<n>)', JSON.stringify(sw.id) === '["pid:5","pid:6","dk.a"]', JSON.stringify(sw.id));
check('6g alle filtre sammenligner gennem AX.passer, og opslaget kender pid:',
  /static func passer\(_ a: NSRunningApplication, _ scope: String\) -> Bool \{\n\s+Navne\.id\(bundleId: a\.bundleIdentifier, pid: a\.processIdentifier\) == scope\n\s+\}/.test(ax)
  && (ax.match(/return AX\.passer\(a, scope\)/g) || []).length === 3 && /if let scope = args\.str\("app"\), !AX\.passer\(a, scope\) \{ continue \}/.test(mainSwift)
  && (src['Capture.swift'].match(/AX\.passer\(\$0, bid\)/g) || []).length === 3
  && /if hvad\.hasPrefix\("pid:"\) \{ return \(alle\.first \{ Navne\.id\(bundleId: \$0\.bundleIdentifier, pid: \$0\.processIdentifier\) == hvad \}, false\) \}/.test(ax)
  && /slaaOp: \{ AX\.app\(bundleId: \$0\)\.map \{ Navne\.id\(bundleId: \$0\.bundleIdentifier, pid: \$0\.processIdentifier\) \} \}/.test(mainSwift));
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
h.saetSvar({ apps: { apps: [
  { name: 'Browser', bundleId: 'dk.same', pid: 101, active: false },
  { name: 'Browser', bundleId: 'dk.same', pid: 100, active: true },
] } });
const p2 = await resolveApp('Browser');
check('8b «er det programmet mennesket bruger?» gaelder alle processer med id\'et - to vinduer, den aktive SIDST (R17, Opus P2)', p2?.active === true, JSON.stringify(p2));
h.saetSvar({ apps: { apps: [
  { name: 'Other', bundleId: 'dk.same', pid: 100, active: true },
  { name: 'Wanted', bundleId: 'dk.same', pid: 101, active: false },
] } });
const p2c = await resolveApp('Wanted');
check('8d samme id, ANDET navn: navnet er tvetydigt og afvises (R18, Opus)', p2c === null, JSON.stringify(p2c));
const p2b = await resolveApp('=dk.same');
check('8c et bundet id slaas op praecist og er aktivt, naar én proces med id\'et er', p2b?.bundleId === 'dk.same' && p2b?.active === true, JSON.stringify(p2b));

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
