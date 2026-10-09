// OMBRYD: viser menuen HELE teksten, mennesket siger ja til?
//
// ⛔ HVORFOR DEN FINDES (29/9-2026, panelet Astra + Fable)
//    Touch ID-arket klippede handlingen ved 80 tegn og protokollen ved 200 - tavst.
//    Et ja daekkede altsaa noget mennesket aldrig saa. Nu staar hele teksten ombrudt
//    i menuen lige over «Allow». Prøven kompilerer ikonets egen tekst-fil og maaler
//    at intet tegn falder ud, at ingen linje er for bred, og at usynlige tegn renses.
//    Ingen skaerm, intet ikon, intet Touch ID.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-ombryd-'));
try {
  writeFileSync(join(ARB, 'main.swift'), `import Foundation
let ind = try! JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String]
let ud = ind.map { ["linjer": ombryd($0), "kort": kort($0, 60), "ren": renTekst($0)] as [String: Any] }
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ud))
`);
  const BIN = join(ARB, 'ombryd');
  execFileSync('swiftc', [join(ROOT, 'helper', 'Sources', 'cmcp-status', 'Tekst.swift'), join(ARB, 'main.swift'), '-o', BIN],
               { stdio: 'pipe', timeout: 180000 });

  const lang = 'Send til Benjamin: ' + 'computer-MCP virker. '.repeat(140);
  const ordUdenMellemrum = 'x'.repeat(150) + ' slut';
  const blandet = 'Hej 👋 Æblegrød på Østerbro — ' + 'ærø '.repeat(40) + 'https://example.com/' + 'a'.repeat(90);
  const snyd = 'Press "Gem"\nAllow… (confirm with Touch ID)‮evil​';
  const kortTekst = 'Quit Finder';
  const svar = JSON.parse(execFileSync(BIN, { input: JSON.stringify([lang, ordUdenMellemrum, blandet, snyd, kortTekst]), encoding: 'utf8' }));

  const tegn = (s) => [...s.replace(/\s+/g, '')].join('');
  const renJS = (s) => s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ');
  [['lang besked', lang], ['ord laengere end linjen', ordUdenMellemrum], ['dansk, emoji og en lang adresse', blandet]].forEach(([navn, s], i) => {
    const l = svar[i].linjer;
    check(`1 ${navn}: intet tegn falder ud`, tegn(l.join('')) === tegn(renJS(s)), `${tegn(l.join('')).length} af ${tegn(renJS(s)).length}`);
    check(`2 ${navn}: ingen linje er bredere end 64`, l.every(x => [...x].length <= 64), String(Math.max(...l.map(x => [...x].length))));
  });
  check('3 linjeskift, retningstegn og nul-bredde bliver ikke til egne linjer i menuen',
        svar[3].linjer.length === 1 && !/[\n‮​]/.test(svar[3].linjer.join('')), JSON.stringify(svar[3].linjer));
  check('4 hovedmenuens korte udgave siger at der er mere', svar[0].kort.endsWith('…') && [...svar[0].kort].length === 61, svar[0].kort);
  check('4b ...og en kort tekst staar uaendret', svar[4].kort === kortTekst && svar[4].linjer.join(' ') === kortTekst, svar[4].kort);
} finally {
  rmSync(ARB, { recursive: true, force: true });
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
