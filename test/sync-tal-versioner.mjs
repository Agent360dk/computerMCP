// FORBEHOLDET NAEVNER DEN UDGIVNE VERSIONS EGET TAL - aldrig et fast «12».
//
// ⛔ 7/10 (panel R8, punkt G): `sync-tal.py` skrev «0.1.0, which has 12 tools» fast
//    tre steder. I 0.2.2-cyklussen (PUBLICERET=0.2.1) ville forsiden have sagt
//    «0.2.1, which has 12 tools» - forkert, paa det trin hvor en ny bruger beslutter
//    sig. Tallet laeses nu fra den udgivne versions git-maerke; ukendt = intet tal.
//
// Koeres i en lokal klon (med maerker), saa intet i arbejdstraeet aendres.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const D = mkdtempSync(join(tmpdir(), 'cmcp-synctal-'));
const K = join(D, 'r');
try {
  execFileSync('git', ['clone', '--quiet', '--shared', ROD, K]);
  // Proeven skal maale den sync-tal der ligger i arbejdstraeet, ogsaa foer commit.
  copyFileSync(join(ROD, 'scripts', 'sync-tal.py'), join(K, 'scripts', 'sync-tal.py'));
  const pakke = JSON.parse(readFileSync(join(K, 'mcp-server', 'package.json'), 'utf8')).version;
  const koer = (udgivet) => {
    writeFileSync(join(K, 'PUBLICERET'), udgivet + '\n');
    execFileSync('python3', ['scripts/sync-tal.py'], { cwd: K, stdio: 'pipe' });
    return {
      forside: readFileSync(join(K, 'docs', 'index.html'), 'utf8'),
      readme: readFileSync(join(K, 'README.md'), 'utf8'),
      llms: readFileSync(join(K, 'docs', 'llms.txt'), 'utf8'),
      install: readFileSync(join(K, 'docs', 'docs', 'install-claude-code', 'index.html'), 'utf8'),
    };
  };
  const forbehold = (t) => (t.match(/FORBEHOLD -->([\s\S]*?)<!-- \/FORBEHOLD|# FORBEHOLD([\s\S]*?)# \/FORBEHOLD/) || [])
    .slice(1).filter(Boolean).join('');

  // 1. 0.1.0 har intet maerke - det maalte tal (12) staar, ordret som i dag.
  const a = koer('0.1.0');
  check('0.1.0: forbeholdet siger 12 vaerktoejer', /serves <b>0\.1\.0<\/b>, which has 12 tools/.test(a.forside),
        forbehold(a.forside).slice(0, 120).replace(/\s+/g, ' '));

  // 2. v0.2.0 findes som maerke: tallet laeses derfra (28), ikke 12 og ikke kildens.
  //    CI-checkouts er flade og uden maerker - saa hentes det ene maerke fra GitHub.
  //    Kan det ikke hentes, er punktet UMAALT (sprunget over), aldrig groent.
  let harTag = true;
  try { execFileSync('git', ['rev-parse', '-q', '--verify', 'refs/tags/v0.2.0'], { cwd: K, stdio: 'pipe' }); }
  catch {
    try { execFileSync('git', ['fetch', '--quiet', '--depth=1', 'https://github.com/Agent360dk/computerMCP.git', 'tag', 'v0.2.0'], { cwd: K, stdio: 'pipe', timeout: 60000 }); }
    catch { harTag = false; }
  }
  if (!harTag) { console.log('SPR. 0.2.0-punkterne - maerket v0.2.0 kunne ikke hentes (umaalt, ikke bestaaet)'); }
  const b = harTag ? koer('0.2.0') : null;
  if (harTag) {
  const fb = forbehold(b.forside) + forbehold(b.readme) + forbehold(b.llms);
  check('0.2.0: tallet kommer fra maerket v0.2.0 (28)', /0\.2\.0<\/b>, which has 28 tools/.test(b.forside)
        && /\*\*0\.2\.0\*\*, which has 28 tools/.test(b.readme) && /serves 0\.2\.0, which has 28 tools/.test(b.llms),
        fb.slice(0, 140).replace(/\s+/g, ' '));
  check('0.2.0: intet «12 tools» i forbeholdet', !/\b12 tools\b|\btwelve\b/.test(fb));
  // Installationssiderne faar forbeholdet FOER tallene rettes overalt - her er det
  // beskyttelsen af versionsforbeholdet, der holder «28» fra at blive kildens tal.
  check('0.2.0: installationssiden siger ogsaa 28 (ikke kildens tal)', /<b>0\.2\.0<\/b>, which has 28 tools/.test(b.install),
        (b.install.match(/currently serves[\s\S]{0,60}/) || [''])[0].replace(/\s+/g, ' '));
  }

  // 3. Ukendt version (intet maerke, ikke kendt): intet tal - aldrig 12.
  const c = koer('0.0.9');
  const fc = forbehold(c.forside) + forbehold(c.readme) + forbehold(c.llms);
  check('ukendt version: forbeholdet staar, uden tal', /0\.0\.9/.test(fc) && /an earlier version/.test(fc));
  check('ukendt version: intet «12 tools»', !/\b12 tools\b|\btwelve\b/.test(fc));

  // 4. Udgivet == kilden: intet forbehold paa forsiden.
  const e = koer(pakke);
  check('udgivet == kilden: forbeholdet er vaek', !/currently serves|not published yet/.test(forbehold(e.forside) + forbehold(e.readme)));

  // 5. Idempotent: anden koersel med samme PUBLICERET aendrer intet.
  koer(harTag ? '0.2.0' : '0.1.0');
  const foer = execFileSync('git', ['status', '--porcelain'], { cwd: K, encoding: 'utf8' });
  const foerIndhold = readFileSync(join(K, 'docs', 'index.html'), 'utf8') + readFileSync(join(K, 'README.md'), 'utf8');
  koer(harTag ? '0.2.0' : '0.1.0');
  const efter = execFileSync('git', ['status', '--porcelain'], { cwd: K, encoding: 'utf8' });
  const efterIndhold = readFileSync(join(K, 'docs', 'index.html'), 'utf8') + readFileSync(join(K, 'README.md'), 'utf8');
  check('anden koersel aendrer intet', foer === efter && foerIndhold === efterIndhold);
} finally {
  rmSync(D, { recursive: true, force: true });
}

console.log();
if (fails.length) { console.log(`DUMPET: ${fails.length}`); process.exit(1); }
console.log('BESTAAET');
