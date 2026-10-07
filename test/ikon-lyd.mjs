// IKON-LYD: hoejst én lyd pr. nyt spoergsmaal (punkt S).
//
// ⛔ 7/10 (panel R8, Astra): «genlevering, timeout og afbrudt forbindelse giver hoejst
//    ét signal pr. spoergsmaal». Proeven kompilerer ikonets egen Lyd.swift og koerer
//    forloebene gennem den samme LydHukommelse som ikonet - ingen skaerm, intet ikon,
//    ingen lyd. Og den binder ikonet til reglen: den eneste lyd i main.swift spilles
//    kun naar skalLyde svarer ja, og menuen kan slaa den fra.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KILDE = join(ROOT, 'helper', 'Sources', 'cmcp-status');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-ikon-lyd-'));
try {
  writeFileSync(join(ARB, 'main.swift'), `import Foundation
struct H: Decodable { let nonce: String; let lukket: Bool; let besvaret: Bool; let til: Bool }
let ind = try! JSONDecoder().decode([H].self, from: FileHandle.standardInput.readDataToEndOfFile())
var hk = LydHukommelse()
let ud = ind.map { hk.skalLyde(nonce: $0.nonce, lukket: $0.lukket, besvaret: $0.besvaret, til: $0.til) }
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ["lyde": ud, "standard": LYD_STANDARD]))
`);
  const BIN = join(ARB, 'lyd');
  execFileSync('swiftc', [join(KILDE, 'Lyd.swift'), join(ARB, 'main.swift'), '-o', BIN], { stdio: 'pipe', timeout: 180000 });
  const koer = (h) => JSON.parse(execFileSync(BIN, { input: JSON.stringify(h), encoding: 'utf8' }));
  const h = (nonce, { lukket = false, besvaret = false, til = true } = {}) => ({ nonce, lukket, besvaret, til });

  // Et spoergsmaal i ikonets liv: vist, leveret igen paa en ny forbindelse, udloebet.
  const r = koer([h('a'), h('a'), h('x', { lukket: true }), h('b'), h('c', { besvaret: true }), h('d', { til: false }), h('d')]).lyde;
  check('1 et nyt spoergsmaal giver lyd', r[0] === true, JSON.stringify(r));
  check('2 samme spoergsmaal leveret igen giver ingen lyd', r[1] === false);
  // Udloebet maales paa et spoergsmaal der IKKE fik lyd ved ankomst (fx slaaet fra dengang) -
  // ellers holder genleverings-reglen i stedet, og proeven maaler den forkerte regel.
  check('3 udloebet (orange slukkes) giver ingen lyd', r[2] === false);
  check('4 et andet nyt spoergsmaal giver sin egen lyd', r[3] === true);
  check('5 et besvaret spoergsmaal giver ingen lyd', r[4] === false);
  check('6 slaaet fra giver ingen lyd', r[5] === false);
  check('7 en lyd der ikke blev spillet (slaaet fra), taeller ikke som hoert', r[6] === true);
  check('8 hoejst én lyd pr. spoergsmaal over hele forloebet', r.filter(Boolean).length === 3, `${r.filter(Boolean).length} lyde for a, b, d`);

  // Standarden er Gustavs valg (R9). Indtil han har valgt: tilvalg.
  const { standard } = koer([]);
  check('9 standarden er tilvalg, indtil Gustav har valgt', standard === false, String(standard));

  // Ikonet bruger reglen: den eneste lyd staar under skalLyde, og menuen kan slaa den fra.
  const main = readFileSync(join(KILDE, 'main.swift'), 'utf8');
  const lyde = main.match(/NSSound\(/g) || [];
  check('10 ikonet har én lyd, og den spilles kun naar skalLyde svarer ja', lyde.length === 1
        && /if lydHukommelse\.skalLyde\(nonce: a\.s\.nonce, lukket: a\.lukket, besvaret: a\.besvaret, til: lydSlaaetTil\(\)\) \{\n\s*NSSound\(/.test(main),
        `${lyde.length} lyde i main.swift`);
  // Astra R10: mutanten «nyAnmodning = { _ in ikon.tik() }» overlevede - reglen og lydstedet
  // var bevist, men ikke at et nyt spoergsmaal NAAR lydstedet. Kaeden bindes her led for led.
  check('13 et nyt spoergsmaal naar lydstedet: socket -> nyAnmodning -> vis(a)',
        /anmodninger\.append\(a\)\n\s*nyAnmodning\(a\)/.test(main) && /^nyAnmodning = \{ a in ikon\.vis\(a\) \}$/m.test(main)
        && /func vis\(_ a: Anmodning\) \{\n\s*tik\(\)\n\s*if lydHukommelse\.skalLyde\(/.test(main));
  check('11 menuen har et punkt der slaar lyden til og fra', /"Play a sound when an agent needs you", action: #selector\(skiftLyd\)/.test(main)
        && /func skiftLyd\(\) \{ UserDefaults\.standard\.set\(!lydSlaaetTil\(\), forKey: "lyd"\) \}/.test(main));
  // README'en lover det standarden giver - begge README'er (claims 45 holder dem ens).
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const lover = standard ? /each new question plays one sound; switch it off in the icon's menu/i
                         : /Switch it on in the icon's menu, and each new\s+question plays one sound/;
  check('12 README lover den standard ikonet har', lover.test(readme), standard ? 'til' : 'tilvalg');
  // ...og CHANGELOG'ens afsnit om lyden (Opus R12: ellers bliver den usand uden at nogen ser det).
  const log = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const loverLog = standard ? /each new question plays one sound/i : /\*\*A sound, if you want one\.\*\* Switch it on in the icon's menu/;
  check('12b CHANGELOG lover den standard ikonet har', loverLog.test(log), standard ? 'til' : 'tilvalg');
} catch (e) {
  check('proeven koerte', false, String(e.stderr || e.message).slice(0, 200));
} finally {
  rmSync(ARB, { recursive: true, force: true });
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
