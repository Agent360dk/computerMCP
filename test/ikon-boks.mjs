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
struct V: Decodable { let antal: Int; let klient: String?; let tekst: String; let fakta: [String]; let menuKnapper: [String] }
struct Hd: Decodable { let knap: String; let knapNonce: String?; let visteNonce: String?; let aktive: Bool }
struct Ak: Decodable { let siden: Double; let iGang: Bool }
struct Ti: Decodable { let ok: Bool; let laan: Bool }
struct L: Decodable { let klient: String?; let min: Int }
struct I: Decodable { let arbejder: [Ag]; let tilsluttede: Int; let venter: V?; let laan: L? }
struct R: Decodable { let x: Double; let y: Double; let w: Double; let h: Double }
struct S: Decodable { let vindue: R?; let mus: [Double]; let skaerme: [R] }
struct H: Decodable { let synlig: R; let bredde: Double }
struct Ind: Decodable { let indhold: [I]; let skaerm: [S]; let cocoa: [R]; let hjoerne: [H]; let handling: [Hd]; let aktive: [Ak]; let touchId: [Ti] }
let raa = FileHandle.standardInput.readDataToEndOfFile()
let ind = try! JSONDecoder().decode(Ind.self, from: raa)
// CGWindowList-lister som macOS giver dem: NSNumber og NSDictionary (via JSONSerialization).
let raaJson = try! JSONSerialization.jsonObject(with: raa) as! [String: Any]
let lister = raaJson["vinduer"] as! [[String: Any]]
let r = { (a: R) in CGRect(x: a.x, y: a.y, width: a.w, height: a.h) }
let ud: [String: Any] = [
  "indhold": ind.indhold.map { i -> [String: Any] in
    let b = boksIndhold(arbejder: i.arbejder.map { (navn: $0.navn, maal: $0.maal, nu: $0.nu) }, tilsluttede: i.tilsluttede,
                        venter: i.venter.map { (antal: $0.antal, klient: $0.klient, tekst: $0.tekst, fakta: $0.fakta, menuKnapper: $0.menuKnapper) },
                        laan: i.laan.map { (klient: $0.klient, minutter: $0.min) })
    return ["titel": b.titel, "orange": b.orange, "linjer": b.linjer, "knapper": b.knapper] },
  "skaerm": ind.skaerm.map { s in boksSkaerm(forrestVindue: s.vindue.map(r), mus: CGPoint(x: s.mus[0], y: s.mus[1]), skaerme: s.skaerme.map(r)) },
  "cocoa": ind.cocoa.map { c in let x = cocoaRamme(r(c), hovedHoejde: 1112); return [x.minX, x.minY, x.width, x.height] },
  "hjoerne": ind.hjoerne.map { h in let p = boksHjoerne(synlig: r(h.synlig), bredde: CGFloat(h.bredde)); return [p.x, p.y] },
  "vinduer": lister.map { l -> Any in
    let pid = (l["pid"] as! NSNumber).int32Value
    guard let v = forrestVinduesRamme(l["liste"] as! [[String: Any]], pid: pid) else { return NSNull() }
    return [v.minX, v.minY, v.width, v.height] },
  "handling": ind.handling.map { h -> String in
    switch boksHandling(knap: h.knap, knapNonce: h.knapNonce, visteNonce: h.visteNonce, aktive: h.aktive) {
    case .foelg: return "foelg"; case .tillad(let n): return "tillad:" + n; case .afvis(let n): return "afvis:" + n
    case .gjort(let n): return "gjort:" + n; case .hentFrem(let n): return "hentFrem:" + n; case .tagTilbage: return "tagTilbage"; case .intet: return "intet" } },
  "aktive": ind.aktive.map { boksKnapperAktive(sidenNytSpoergsmaal: $0.siden, touchIdIGang: $0.iGang) },
  "pause": BOKS_PAUSE,
  "touchId": ind.touchId.map { t -> String in switch touchIdUdfald(ok: t.ok, erLaan: t.laan) { case .laan: return "laan"; case .svar(let v): return v ? "ja" : "nej" } },
  "max": BOKS_MAX_TEGN]
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ud))
`);
const BIN = join(ARB, 'boks');
execFileSync('swiftc', [join(KILDE, 'Tekst.swift'), join(ARB, 'main.swift'), '-o', BIN], { stdio: 'pipe', timeout: 300000 });
const ALLOW_MENU = 'Allow… (confirm with Touch ID)';
const SCOPE = 'If you allow it, the agent may work in com.apple.Terminal for the rest of this session.';
const lang = 'Send the quarterly numbers to the board. '.repeat(8);   // > 280 tegn
// Gustavs to skaerme: MacBook 1710x1112 forrest (hovedskaerm), ultrabred 3440x1440 til hoejre.
const MAC = { x: 0, y: 0, w: 1710, h: 1112 }, BRED = { x: 1710, y: -200, w: 3440, h: 1440 };
const ind = {
  indhold: [
    { arbejder: [{ navn: 'Claude · c753', maal: 'com.apple.Notes', nu: 'Press «Format» in Noter' }, { navn: 'Codex · 9f1', maal: null, nu: 'idle' }], tilsluttede: 12, venter: null },
    { arbejder: Array.from({ length: 5 }, (_, i) => ({ navn: `a${i}`, maal: null, nu: 'x' })), tilsluttede: 5, venter: null },
    { arbejder: [], tilsluttede: 3, venter: { antal: 1, klient: 'Claude', tekst: 'Press cmd+backspace in Noter', fakta: ['If you allow it, this one action only.', 'Lands in: com.apple.Notes'], menuKnapper: [ALLOW_MENU, 'Deny'] } },
    { arbejder: [], tilsluttede: 3, venter: { antal: 3, klient: 'Claude', tekst: lang, fakta: [], menuKnapper: [ALLOW_MENU, 'Deny'] } },
    { arbejder: [], tilsluttede: 1, venter: { antal: 1, klient: null, tekst: 'Type your password in Safari', fakta: [], menuKnapper: ['Take me there', 'Done — I did it', "I won't do this"] } },
    { arbejder: [], tilsluttede: 1, venter: { antal: 1, klient: 'Claude', tekst: 'Use your screen for 2 minutes', fakta: [], menuKnapper: ['Deny'] } },
    { arbejder: [], tilsluttede: 1, venter: { antal: 1, klient: 'Claude‮', tekst: 'x'.repeat(280), fakta: [], menuKnapper: [ALLOW_MENU, 'Deny'] } },
    { arbejder: [], tilsluttede: 1, venter: { antal: 1, klient: 'Claude', tekst: 'Type 42 characters', fakta: [SCOPE, 'Lands in: com.apple.Terminal'], menuKnapper: [ALLOW_MENU, 'Deny'] } },
    { arbejder: [], tilsluttede: 1, venter: null, laan: { klient: 'Claude', min: 2 } },
    { arbejder: [], tilsluttede: 1, venter: { antal: 1, klient: 'Codex', tekst: 'Press Send in Mail', fakta: [], menuKnapper: [ALLOW_MENU, 'Deny'] }, laan: { klient: 'Claude', min: 7 } },
    { arbejder: [{ navn: 'Claude · c753', maal: 'com.apple.Notes', nu: 'Type in Noter' }], tilsluttede: 4, venter: null, laan: { klient: 'Claude‮', min: 1 } },
  ],
  skaerm: [
    { vindue: { x: 1800, y: 100, w: 1400, h: 900 }, mus: [100, 100], skaerme: [MAC, BRED] },   // vinduet paa den brede, musen paa Mac'en
    { vindue: { x: 100, y: 100, w: 800, h: 600 }, mus: [4000, 500], skaerme: [MAC, BRED] },   // omvendt
    { vindue: null, mus: [4000, 500], skaerme: [MAC, BRED] },                                  // intet vindue: musen
    { vindue: null, mus: [-5000, -5000], skaerme: [MAC, BRED] },                               // intet: den foerste
    { vindue: { x: 9000, y: 9000, w: 10, h: 10 }, mus: [4000, 500], skaerme: [MAC, BRED] },    // vindue uden for alle: musen
  ],
  cocoa: [{ x: 0, y: 0, w: 100, h: 50 }, { x: 1800, y: 34, w: 1200, h: 800 }],
  handling: [
    { knap: 'Allow (Touch ID)', knapNonce: 'n1', visteNonce: 'n1', aktive: true },
    { knap: 'Allow (Touch ID)', knapNonce: 'n0', visteNonce: 'n1', aktive: true },
    { knap: 'Allow (Touch ID)', knapNonce: 'n1', visteNonce: 'n1', aktive: false },
    { knap: 'Deny', knapNonce: 'n1', visteNonce: 'n1', aktive: true },
    { knap: "I won't do this", knapNonce: 'n1', visteNonce: 'n1', aktive: true },
    { knap: 'Done — I did it', knapNonce: 'n1', visteNonce: 'n1', aktive: true },
    { knap: 'Take me there', knapNonce: 'n1', visteNonce: 'n1', aktive: true },
    { knap: 'Follow', knapNonce: null, visteNonce: null, aktive: false },
    { knap: 'Allow (Touch ID)', knapNonce: null, visteNonce: null, aktive: true },
    { knap: 'Allow… (confirm with Touch ID)', knapNonce: 'n1', visteNonce: 'n1', aktive: true },
    { knap: 'Take the screen back now', knapNonce: null, visteNonce: 'n1', aktive: false },
    { knap: 'Take the screen back now', knapNonce: 'n0', visteNonce: null, aktive: false },
  ],
  touchId: [{ ok: false, laan: false }, { ok: false, laan: true }, { ok: true, laan: false }, { ok: true, laan: true }],
  aktive: [{ siden: 0.5, iGang: false }, { siden: 1.0, iGang: false }, { siden: 5, iGang: true }, { siden: 5, iGang: false }],
  hjoerne: [{ synlig: { x: 0, y: 0, w: 1710, h: 1077 }, bredde: 360 }, { synlig: { x: 1710, y: -200, w: 3440, h: 1415 }, bredde: 360 }],
  vinduer: (() => {
    const v = (pid, lag, X) => ({ kCGWindowOwnerPID: pid, kCGWindowLayer: lag, kCGWindowBounds: { X, Y: 40, Width: 500, Height: 300 } });
    return [
      { pid: 7, liste: [v(5, 0, 10), v(7, 25, 20), v(7, 0, 30), v(7, 0, 40)] },   // menulinje-lag springes over; det forreste almindelige
      { pid: 5, liste: [v(5, 0, 10), v(7, 0, 30)] },
      { pid: 9, liste: [v(5, 0, 10)] },                                             // det forreste program har intet vindue
    ];
  })(),
};
const s = JSON.parse(execFileSync(BIN, { input: JSON.stringify(ind), encoding: 'utf8' }));
const [n2, n5, q1, qLang, qSelv, qLaan, qGraense, qTerm, lStille, lSpoerg, lArb] = s.indhold;
check('1a to agenter: titlen siger hvor mange der arbejder, og hvor mange der er tilsluttet', n2.titel === 'Computer MCP - 2 agents working · 12 connected' && !n2.orange, n2.titel);
check('1b hver agent: navn, program og hvad den goer nu', n2.linjer[0] === '● Claude · c753 · com.apple.Notes' && n2.linjer[1].trim() === 'Press «Format» in Noter' && n2.linjer[2] === '● Codex · 9f1', JSON.stringify(n2.linjer));
check('1c hoejst tre agenter, resten som et tal', n5.linjer.filter(l => l.startsWith('●')).length === 3 && n5.linjer.at(-1) === '+2 more working', JSON.stringify(n5.linjer));
check('1d «Follow» naar nogen arbejder', JSON.stringify(n2.knapper) === '["Follow"]');
check('2a et spoergsmaal: orange, hvem der spoerger, og HELE teksten', q1.orange && q1.titel === 'Claude needs you' && q1.linjer[0] === 'Press cmd+backspace in Noter', JSON.stringify(q1));
check('2h ...og HVOR det lander og HVOR LAENGE et ja gaelder - menuens fakta, hele (R17, Opus 4c)',
  q1.linjer.includes('If you allow it, this one action only.') && q1.linjer.includes('Lands in: com.apple.Notes')
  && qTerm.linjer.slice(1, -1).join(' ') === SCOPE && qTerm.linjer.at(-1) === 'Lands in: com.apple.Terminal'
  && JSON.stringify(qTerm.knapper) === '["Allow (Touch ID)","Deny"]', JSON.stringify(qTerm.linjer));
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
check('3d boksen staar inde paa skaermen, oeverst til hoejre', JSON.stringify(s.hjoerne) === JSON.stringify([[1334, 1065], [4774, 1203]]), JSON.stringify(s.hjoerne));
check('3e det forreste programs forreste almindelige vindue - ikke et andet programs, ikke et menulinje-lag',
  JSON.stringify(s.vinduer) === JSON.stringify([[30, 40, 500, 300], [10, 40, 500, 300], null]), JSON.stringify(s.vinduer));
check('3c vinduets ramme omregnes fra oeverst-venstre til Cocoas nederst-venstre',
  JSON.stringify(s.cocoa) === JSON.stringify([[0, 1062, 100, 50], [1800, 278, 1200, 800]]), JSON.stringify(s.cocoa));

check('6a knapperne: Allow -> Touch ID-vejen paa KNAPPENS spoergsmaal; Deny og «I won\'t» er nej; Done er gjort; Take me there henter frem',
  JSON.stringify(s.handling.slice(0, 7)) === JSON.stringify(['tillad:n1', 'intet', 'intet', 'afvis:n1', 'afvis:n1', 'gjort:n1', 'hentFrem:n1']), JSON.stringify(s.handling));
check('6b Follow virker altid; uden spoergsmaal eller med en ukendt knap sker intet',
  JSON.stringify(s.handling.slice(7, 10)) === JSON.stringify(['foelg', 'intet', 'intet']), JSON.stringify(s.handling.slice(7)));
check('6e «Take the screen back now» virker ALTID: uden pause, uden Touch ID-vent og uanset hvilket spoergsmaal boksen viser (R22)',
  JSON.stringify(s.handling.slice(10)) === JSON.stringify(['tagTilbage', 'tagTilbage']), JSON.stringify(s.handling.slice(10)));
check('7a et STILLE laan staar i boksen: orange, hvem, hvor laenge, og stopknappen (R22: laanet kunne kun ses i menuen)',
  lStille.orange && lStille.titel === 'Claude is using your screen' && /^2 min left/.test(lStille.linjer[0])
  && JSON.stringify(lStille.knapper) === '["Take the screen back now"]', JSON.stringify(lStille));
check('7b et laan OG et spoergsmaal: spoergsmaalet beholder titel og knapper, laanet staar oeverst, og stopknappen er foerst',
  lSpoerg.titel === 'Codex needs you' && lSpoerg.linjer[0] === 'Claude is using your screen — 7 min left' && lSpoerg.linjer[1] === 'Press Send in Mail'
  && JSON.stringify(lSpoerg.knapper) === '["Take the screen back now","Allow (Touch ID)","Deny"]', JSON.stringify(lSpoerg));
check('7c et laan mens agenter arbejder: stopknappen foerst, Follow bagefter; usynlige tegn i navnet vasket',
  lArb.titel === 'Claude is using your screen' && lArb.linjer.includes('● Claude · c753 · com.apple.Notes')
  && JSON.stringify(lArb.knapper) === '["Take the screen back now","Follow"]', JSON.stringify(lArb));
check('6d Touch ID: et nej er et nej - ogsaa for et skaerm-laan; kun et ja til et laan bliver et laan',
  JSON.stringify(s.touchId) === '["nej","nej","ja","laan"]', JSON.stringify(s.touchId));
check(`6c knapperne venter ${s.pause} s efter et nyt spoergsmaal og er fra mens Touch ID er oppe`,
  JSON.stringify(s.aktive) === '[false,true,false,true]', JSON.stringify(s.aktive));

// 4 · det rigtige ikon: --dump-question bygger boksen med samme funktion som den rigtige boks
const ikon = [join(ROOT, 'helper', '.build', 'release', 'cmcp-status'), join(ROOT, 'mcp-server', 'vendor', 'ComputerMCPStatus.app', 'Contents', 'MacOS', 'cmcp-status')].find(p => existsSync(p));
if (!ikon) console.log('SPR. 4 intet bygget ikon');
else {
  const vis = (q) => JSON.parse(execFileSync(ikon, ['--dump-question'], { encoding: 'utf8', input: JSON.stringify({ nonce: 'n', session: 's', client: 'Claude', scope: 'If you allow it, this one action only.', target: 'com.apple.Notes', expires: 0, ...q }) })).box;
  const b = vis({ text: 'Press cmd+backspace in Noter' });
  check('4a ikonet: spoergsmaalet i boksen med hvor det lander og omfanget, og Allow (Touch ID) og Deny',
    b.title === 'Claude needs you' && b.lines.includes('Lands in: com.apple.Notes') && b.lines.includes('If you allow it, this one action only.')
    && JSON.stringify(b.buttons) === '["Allow (Touch ID)","Deny"]', JSON.stringify(b));
  const l = vis({ text: 'Use your screen for 2 minutes: F1', kind: 'screen', minutes: 2, simulateActiveLoan: { client: 'anden', minutesLeft: 3 } });
  check('4b ikonet: et andet laan er aktivt - boksen har kun Deny', JSON.stringify(l.buttons) === '["Deny"]', JSON.stringify(l));
  const raw = JSON.parse(execFileSync(ikon, ['--dump-question'], { encoding: 'utf8', input: JSON.stringify({ nonce: 'n', session: 's', client: 'Claude', scope: 'x', target: 'y', expires: 0, text: 'Use your screen for 2 minutes', kind: 'screen', minutes: 2 }) }));
  check('4c ikonet: mens laanet varer, viser boksen hvem, hvor laenge og stopknappen - bygget af den rigtige boksIndhold',
    raw.boxWhileLent && raw.boxWhileLent.title === 'Claude is using your screen' && /^2 min left/.test(raw.boxWhileLent.lines[0])
    && JSON.stringify(raw.boxWhileLent.buttons) === '["Take the screen back now"]', JSON.stringify(raw.boxWhileLent));
}

// 5 · ikonets kode er bundet til reglerne
const m = readFileSync(join(KILDE, 'main.swift'), 'utf8');
const krop = (start) => { const i = m.indexOf(start); return i < 0 ? '' : m.slice(i, m.indexOf('\n    }\n', i)); };
const knapKrop = krop('func boksKnapTrykket(');
check('5a boksens Allow er menuens tilladNonce - samme vej, med sit eget kildemaerke',
  /case \.tillad\(let n\): tilladNonce\(n, kilde: "allow-box"\)/.test(knapKrop) && /case \.afvis\(let n\): afvisNonce\(n, kilde: "deny-box"\)/.test(knapKrop)
  && /case \.gjort\(let n\): gjortNonce\(n, kilde: "done-box"\)/.test(knapKrop) && /case \.hentFrem\(let n\): hentFremNonce\(n\)/.test(knapKrop), knapKrop.slice(0, 300));
check('5b menuens Allow gaar samme vej', /@objc func tillad\(_ sender: NSMenuItem\) \{ tilladNonce\(sender\.representedObject as\? String, kilde: "allow"\) \}/.test(m));
const tillad = krop('func tilladNonce(');
check('5c et ja kraever Touch ID: intet svar foer bekraeftMenneske, og et ja i boksen kun naar HELE teksten stod der',
  /if kilde == "allow-box" && renTekst\(a\.s\.text\)\.count > BOKS_MAX_TEGN \{ return \}\n\s+boks\.touchIdIGang = true\n\s+bekraeftMenneske\(a\) \{/.test(tillad)
  && !/svar\(ok: true|svarLaan/.test(tillad.slice(0, tillad.indexOf('bekraeftMenneske(a)'))), tillad.slice(0, 300));
check('5c2 svaret er Touch ID-svaret, gennem touchIdUdfald og intet andet (R18, Astra)',
  /bekraeftMenneske\(a\) \{ \[weak self\] ok in\n\s+self\?\.boks\.touchIdIGang = false\n\s+\/\/[^\n]*\n\s+switch touchIdUdfald\(ok: ok, erLaan: a\.s\.kind == "screen"\) \{\n\s+case \.laan:/.test(tillad)
  && /case \.svar\(let v\):\n\s+a\.svar\(ok: v\)\n/.test(tillad) && !/svar\(ok: true/.test(tillad));
check('5c3 et spoergsmaal findes kun paa sit eget engangsnummer', /func aaben\(_ nonce: String\?\) -> Anmodning\? \{\n\s+guard let n = nonce else \{ return nil \}\n\s+return anmodninger\.first \{ \$0\.s\.nonce == n && !\$0\.besvaret \}\n\s+\}/.test(m));
check('5d boksens tryk afgoeres af boksHandling med den viste nonce og om knapperne er aktive',
  /switch boksHandling\(knap: knap, knapNonce: n, visteNonce: boks\.nonce, aktive: boks\.knapperAktive\(\)\) \{/.test(knapKrop));
check('5k Touch ID: knapperne slaas fra foer arket og til igen naar det svarer',
  /boks\.touchIdIGang = true\n\s+bekraeftMenneske\(a\) \{ \[weak self\] ok in\n\s+self\?\.boks\.touchIdIGang = false/.test(m));
check('5l pausen: et nyt spoergsmaal saetter tiden, og knapperne foelger knapperAktive',
  /if ny != nonce && ny != nil \{\n\s+nytSpoergsmaal = Date\(\)/.test(m) && /let aktiv = nonce == nil \|\| knapperAktive\(\)/.test(m));
check('5m boksen viser det FOERSTE aabne spoergsmaal og bruger dets nonce', /let foerste = aabne\.first/.test(m) && /nonce: foerste\?\.s\.nonce, sessioner: aktive/.test(m));
check('5e hver knap baerer sit eget spoergsmaal (R17, Astra)',
  /vist = ind; nonce = ny/.test(m)
  && /b\.identifier = NSUserInterfaceItemIdentifier\("boks-" \+ \(ny \?\? ""\)\)/.test(m)
  && /knapTrykket\(b\.title, id\.count > 5 \? String\(id\.dropFirst\(5\)\) : nil\)/.test(m));
check('5f boksen faar menuens knapper OG fakta for spoergsmaalet', /let mm = spoergsmaalMenu\(a\.s, aktivtAndetLaan: andetLaan\(a\)\)\n\s+return \(antal: aabne\.count, klient: a\.s\.client, tekst: a\.s\.text, fakta: mm\.fakta, menuKnapper: mm\.knapper\)/.test(m)
  && /let mm = spoergsmaalMenu\(a\.s, aktivtAndetLaan: andetLaan\(a\)\)/.test(m));
check('5g placeringen: skaermen med det forreste vindue, hjoernet fra boksHjoerne',
  /let i = boksSkaerm\(forrestVindue: forrestVindue\(\), mus: NSEvent\.mouseLocation, skaerme: skaerme\.map \{ \$0\.frame \}\)\n\s+let f = skaerme\[i\]\.visibleFrame\n\s+setFrameTopLeftPoint\(boksHjoerne\(synlig: f, bredde: frame\.width\)\)/.test(m));
check('5j det forreste vindue er det forreste PROGRAMS (forrestVinduesRamme med dets pid)',
  /guard let pid = NSWorkspace\.shared\.frontmostApplication\?\.processIdentifier,[\s\S]{0,300}let r = forrestVinduesRamme\(liste, pid: pid\)\n\s+else \{ return nil \}\n\s+return cocoaRamme\(r, hovedHoejde: hovedHoejde\)/.test(m));
check('5h flyttes med: ny skaerm-opsaetning, og naar mennesket skifter skaerm', /didChangeScreenParametersNotification[\s\S]{0,200}boks\.placer\(\)/.test(m) && /else if boks\.skalFlyttes\(\) \{ boks\.placer\(\) \}/.test(m));
check('5i boksen tager aldrig tastaturet og beder om ikke at blive delt (sharingType none - om optagelser respekterer det, er UMAALT)',
  /override var canBecomeKey: Bool \{ false \}/.test(m) && /sharingType = \.none/.test(m) && /\.nonactivatingPanel/.test(m));

const tikKrop = krop('func tik() {');
check('5n laanet holder boksen fremme - ogsaa stille og ogsaa naar boksen er slaaet fra - og gaar ind i boksIndhold (R22)',
  /guard let l = aktivtLaan, !l\.lukket, let til = laanTil else \{ return nil \}/.test(tikKrop)
  && /if laan == nil && \(s\.isEmpty \|\| boksSlaaetFra \|\| !arbejder\) \{/.test(tikKrop)
  && /boksIndhold\(arbejder: arbejdende, tilsluttede: s\.count, venter: venter, laan: laan\)/.test(tikKrop), tikKrop.slice(0, 200));
check('5o boksens stopknap er menuens: samme tagTilbageNu, eget kildemaerke, intet Touch ID',
  /case \.tagTilbage: tagTilbageNu\(kilde: "take-back-box"\)/.test(knapKrop)
  && /@objc func tagTilbage\(\) \{ tagTilbageNu\(kilde: "take-back"\) \}/.test(m)
  && /func tagTilbageNu\(kilde: String\) \{\n\s+noterKilde\(kilde\)\n\s+aktivtLaan\?\.afslutLaan\(\)/.test(m));
check('5p stopknappen slaas aldrig fra - hverken af pausen eller af Touch ID-arket', /b\.isEnabled = aktiv \|\| b\.title == TAG_TILBAGE/.test(m));
check('5q boksen ligger paa statuslinjens lag, ikke det almindelige svaevelag (isFloatingPanel nulstiller level - maalt R22, Opus)',
  /isFloatingPanel = true\n\s+level = \.statusBar/.test(m) && !/level = \.statusBar\n\s+isFloatingPanel = true/.test(m));

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
