// IKON-BOKS: boksen i hjoernet viser hvad agenterne goer, staar paa den skaerm
// mennesket arbejder paa, og et spoergsmaal kan besvares i den - med Touch ID.
//
// ⛔ 9/10 (F1 paa Gustavs Mac): et spoergsmaal udloeb, fordi boksen stod i hjoernet af
//    den ANDEN skaerm (x=4794) og kun sagde «Needs you: click the orange menu bar icon».
//    Gustav: «flydende komponent i hoejre hjoerne ... saa man kan se hvad der sker» og
//    «saa kan jeg ogsaa goere hvad du beder mig om» (+ «1 ja»: Allow maa staa i boksen).
//
//    Proeven starter ALDRIG ikonet og viser intet: den kompilerer Tekst.swift for sig,
//    laeser det rigtige ikons --dump-question, og binder ikonets kode til reglerne.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KILDE = join(ROOT, 'helper', 'Sources', 'cmcp-status');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

// 1-3 · Tekst.swift for sig: indhold og valg af skaerm
const ARB = mkdtempSync(join(tmpdir(), 'cmcp-ikon-boks-'));
writeFileSync(join(ARB, 'main.swift'), `import Foundation
import CoreGraphics
struct Ag: Decodable { let navn: String; let maal: String?; let nu: String }
struct V: Decodable { let antal: Int; let klient: String?; let tekst: String; let menuKnapper: [String] }
struct I: Decodable { let arbejder: [Ag]; let tilsluttede: Int; let venter: V? }
struct R: Decodable { let x: Double; let y: Double; let w: Double; let h: Double }
struct S: Decodable { let vindue: R?; let mus: [Double]; let skaerme: [R] }
struct Ind: Decodable { let indhold: [I]; let skaerm: [S]; let cocoa: [R] }
let ind = try! JSONDecoder().decode(Ind.self, from: FileHandle.standardInput.readDataToEndOfFile())
let r = { (a: R) in CGRect(x: a.x, y: a.y, width: a.w, height: a.h) }
let ud: [String: Any] = [
  "indhold": ind.indhold.map { i -> [String: Any] in
    let b = boksIndhold(arbejder: i.arbejder.map { (navn: $0.navn, maal: $0.maal, nu: $0.nu) }, tilsluttede: i.tilsluttede,
                        venter: i.venter.map { (antal: $0.antal, klient: $0.klient, tekst: $0.tekst, menuKnapper: $0.menuKnapper) })
    return ["titel": b.titel, "orange": b.orange, "linjer": b.linjer, "knapper": b.knapper] },
  "skaerm": ind.skaerm.map { s in boksSkaerm(forrestVindue: s.vindue.map(r), mus: CGPoint(x: s.mus[0], y: s.mus[1]), skaerme: s.skaerme.map(r)) },
  "cocoa": ind.cocoa.map { c in let x = cocoaRamme(r(c), hovedHoejde: 1112); return [x.minX, x.minY, x.width, x.height] },
  "max": BOKS_MAX_TEGN]
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ud))
`);
const BIN = join(ARB, 'boks');
execFileSync('swiftc', [join(KILDE, 'Tekst.swift'), join(ARB, 'main.swift'), '-o', BIN], { stdio: 'pipe', timeout: 300000 });
const ALLOW_MENU = 'Allow… (confirm with Touch ID)';
const lang = 'Send the quarterly numbers to the board. '.repeat(8);   // > 280 tegn
// Gustavs to skaerme: MacBook 1710x1112 forrest (hovedskaerm), ultrabred 3440x1440 til hoejre.
const MAC = { x: 0, y: 0, w: 1710, h: 1112 }, BRED = { x: 1710, y: -200, w: 3440, h: 1440 };
const ind = {
  indhold: [
    { arbejder: [{ navn: 'Claude · c753', maal: 'com.apple.Notes', nu: 'Press «Format» in Noter' }, { navn: 'Codex · 9f1', maal: null, nu: 'idle' }], tilsluttede: 12, venter: null },
    { arbejder: Array.from({ length: 5 }, (_, i) => ({ navn: `a${i}`, maal: null, nu: 'x' })), tilsluttede: 5, venter: null },
    { arbejder: [], tilsluttede: 3, venter: { antal: 1, klient: 'Claude', tekst: 'Press cmd+backspace in Noter', menuKnapper: [ALLOW_MENU, 'Deny'] } },
    { arbejder: [], tilsluttede: 3, venter: { antal: 3, klient: 'Claude', tekst: lang, menuKnapper: [ALLOW_MENU, 'Deny'] } },
    { arbejder: [], tilsluttede: 1, venter: { antal: 1, klient: null, tekst: 'Type your password in Safari', menuKnapper: ['Take me there', 'Done — I did it', "I won't do this"] } },
    { arbejder: [], tilsluttede: 1, venter: { antal: 1, klient: 'Claude', tekst: 'Use your screen for 2 minutes', menuKnapper: ['Deny'] } },
    { arbejder: [], tilsluttede: 1, venter: { antal: 1, klient: 'Claude‮', tekst: 'x'.repeat(280), menuKnapper: [ALLOW_MENU, 'Deny'] } },
  ],
  skaerm: [
    { vindue: { x: 1800, y: 100, w: 1400, h: 900 }, mus: [100, 100], skaerme: [MAC, BRED] },   // vinduet paa den brede, musen paa Mac'en
    { vindue: { x: 100, y: 100, w: 800, h: 600 }, mus: [4000, 500], skaerme: [MAC, BRED] },   // omvendt
    { vindue: null, mus: [4000, 500], skaerme: [MAC, BRED] },                                  // intet vindue: musen
    { vindue: null, mus: [-5000, -5000], skaerme: [MAC, BRED] },                               // intet: den foerste
    { vindue: { x: 9000, y: 9000, w: 10, h: 10 }, mus: [4000, 500], skaerme: [MAC, BRED] },    // vindue uden for alle: musen
  ],
  cocoa: [{ x: 0, y: 0, w: 100, h: 50 }, { x: 1800, y: 34, w: 1200, h: 800 }],
};
const s = JSON.parse(execFileSync(BIN, { input: JSON.stringify(ind), encoding: 'utf8' }));
const [n2, n5, q1, qLang, qSelv, qLaan, qGraense] = s.indhold;
check('1a to agenter: titlen siger hvor mange der arbejder, og hvor mange der er tilsluttet', n2.titel === 'Computer MCP - 2 agents working · 12 connected' && !n2.orange, n2.titel);
check('1b hver agent: navn, program og hvad den goer nu', n2.linjer[0] === '● Claude · c753 · com.apple.Notes' && n2.linjer[1].trim() === 'Press «Format» in Noter' && n2.linjer[2] === '● Codex · 9f1', JSON.stringify(n2.linjer));
check('1c hoejst tre agenter, resten som et tal', n5.linjer.filter(l => l.startsWith('●')).length === 3 && n5.linjer.at(-1) === '+2 more working', JSON.stringify(n5.linjer));
check('1d «Follow» naar nogen arbejder', JSON.stringify(n2.knapper) === '["Follow"]');
check('2a et spoergsmaal: orange, hvem der spoerger, og HELE teksten', q1.orange && q1.titel === 'Claude needs you' && q1.linjer.join(' ') === 'Press cmd+backspace in Noter', JSON.stringify(q1));
check('2b ...med menuens knapper: Allow (Touch ID) og Deny', JSON.stringify(q1.knapper) === '["Allow (Touch ID)","Deny"]', JSON.stringify(q1.knapper));
check(`2c over ${s.max} tegn: ingen Allow i boksen, og den siger hvor hele teksten er`,
  !qLang.knapper.includes('Allow (Touch ID)') && qLang.knapper.includes('Deny')
  && qLang.linjer.some(l => /\(\d+ characters - the whole text is in the menu bar icon\)/.test(l)), JSON.stringify(qLang));
check('2d flere spoergsmaal: boksen siger hvor mange flere', qLang.linjer.at(-1) === '+2 more in the menu bar icon', qLang.linjer.at(-1));
check('2e goer-selv: menuens egne knapper, ingen Allow', JSON.stringify(qSelv.knapper) === JSON.stringify(['Take me there', 'Done — I did it', "I won't do this"]) && qSelv.titel === 'An agent needs you', JSON.stringify(qSelv));
check('2f et laan i koe: kun Deny, som i menuen', JSON.stringify(qLaan.knapper) === '["Deny"]');
check(`2g paa graensen (${s.max} tegn): Allow staar, intet tegn mangler, og usynlige tegn i navnet er vasket`,
  qGraense.knapper.includes('Allow (Touch ID)') && qGraense.linjer.join('').length === 280 && !qGraense.titel.includes('‮'), qGraense.titel);
check('3a skaermen med det forreste vindue - ikke musens', s.skaerm[0] === 1 && s.skaerm[1] === 0, JSON.stringify(s.skaerm));
check('3b intet vindue: musens skaerm; ingen af delene: den foerste', s.skaerm[2] === 1 && s.skaerm[3] === 0 && s.skaerm[4] === 1, JSON.stringify(s.skaerm));
check('3c vinduets ramme omregnes fra oeverst-venstre til Cocoas nederst-venstre',
  JSON.stringify(s.cocoa) === JSON.stringify([[0, 1062, 100, 50], [1800, 278, 1200, 800]]), JSON.stringify(s.cocoa));

// 4 · det rigtige ikon: --dump-question bygger boksen med samme funktion som den rigtige boks
const ikon = [join(ROOT, 'helper', '.build', 'release', 'cmcp-status'), join(ROOT, 'mcp-server', 'vendor', 'ComputerMCPStatus.app', 'Contents', 'MacOS', 'cmcp-status')].find(p => existsSync(p));
if (!ikon) console.log('SPR. 4 intet bygget ikon');
else {
  const vis = (q) => JSON.parse(execFileSync(ikon, ['--dump-question'], { encoding: 'utf8', input: JSON.stringify({ nonce: 'n', session: 's', client: 'Claude', scope: 'If you allow it, this one action only.', target: 'com.apple.Notes', expires: 0, ...q }) })).box;
  const b = vis({ text: 'Press cmd+backspace in Noter' });
  check('4a ikonet: spoergsmaalet i boksen med Allow (Touch ID) og Deny', b.title === 'Claude needs you' && JSON.stringify(b.buttons) === '["Allow (Touch ID)","Deny"]', JSON.stringify(b));
  const l = vis({ text: 'Use your screen for 2 minutes: F1', kind: 'screen', minutes: 2, simulateActiveLoan: { client: 'anden', minutesLeft: 3 } });
  check('4b ikonet: et andet laan er aktivt - boksen har kun Deny', JSON.stringify(l.buttons) === '["Deny"]', JSON.stringify(l));
}

// 5 · ikonets kode er bundet til reglerne
const m = readFileSync(join(KILDE, 'main.swift'), 'utf8');
const krop = (start) => { const i = m.indexOf(start); return i < 0 ? '' : m.slice(i, m.indexOf('\n    }\n', i)); };
const knapKrop = krop('func boksKnapTrykket(');
check('5a boksens Allow er menuens tilladNonce - samme vej, med sit eget kildemaerke',
  /case "Allow \(Touch ID\)": tilladNonce\(n, kilde: "allow-box"\)/.test(knapKrop), knapKrop.slice(0, 200));
check('5b menuens Allow gaar samme vej', /@objc func tillad\(_ sender: NSMenuItem\) \{ tilladNonce\(sender\.representedObject as\? String, kilde: "allow"\) \}/.test(m));
const tillad = krop('func tilladNonce(');
check('5c et ja kraever Touch ID: intet svar foer bekraeftMenneske, og et ja i boksen kun naar HELE teksten stod der',
  /if kilde == "allow-box" && renTekst\(a\.s\.text\)\.count > BOKS_MAX_TEGN \{ return \}\n\s+bekraeftMenneske\(a\) \{/.test(tillad)
  && !/svar\(ok: true|svarLaan/.test(tillad.slice(0, tillad.indexOf('bekraeftMenneske(a)'))), tillad.slice(0, 300));
check('5d hver knap boksen kan vise, har en handling', ['Follow', 'Allow (Touch ID)', 'Done — I did it', 'Take me there', 'Deny', "I won't do this"]
  .every(k => knapKrop.includes(`"${k}"`)));
check('5e knapperne svarer paa det spoergsmaal boksen viste (nonce saettes sammen med teksten)', /vist = ind; nonce = ny/.test(m) && /let n = boks\.nonce/.test(knapKrop));
check('5f boksen faar menuens knapper for spoergsmaalet', /menuKnapper: spoergsmaalMenu\(a\.s, aktivtAndetLaan: andetLaan\(a\)\)\.knapper/.test(m)
  && /let mm = spoergsmaalMenu\(a\.s, aktivtAndetLaan: andetLaan\(a\)\)/.test(m));
check('5g placeringen: skaermen med det forreste vindue', /let i = boksSkaerm\(forrestVindue: forrestVindue\(\), mus: NSEvent\.mouseLocation, skaerme: skaerme\.map \{ \$0\.frame \}\)\n\s+let f = skaerme\[i\]\.visibleFrame/.test(m));
check('5h flyttes med: ny skaerm-opsaetning, og naar mennesket skifter skaerm', /didChangeScreenParametersNotification[\s\S]{0,200}boks\.placer\(\)/.test(m) && /else if boks\.skalFlyttes\(\) \{ boks\.placer\(\) \}/.test(m));
check('5i boksen tager aldrig tastaturet og er ikke med i agenternes skaermbilleder',
  /override var canBecomeKey: Bool \{ false \}/.test(m) && /sharingType = \.none/.test(m) && /\.nonactivatingPanel/.test(m));

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
