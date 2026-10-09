// UDGIVELSESSCRIPTET SIGER SANDHEDEN VED HVERT EKSTERNT TRIN.
//
// ⛔ 7/10 (panel R2+R8, punkt E): fire beskeder i scripts/release.sh kunne lyve i det
//    vaerste oejeblik - en GitHub-fejl laest som «CI har ikke koert», en fejlet
//    ls-remote laest som «maerket er ledigt», faelden armeret gennem deprecate (et
//    afbrudt deprecate skrev «udgivelsen skete ikke» efter en lykket publish), og en
//    reservelinje til deprecate der ikke kunne koeres.
//
// Proeven koerer det RIGTIGE release.sh i en klon i tmp:
//   - byg og suite er erstattet af stubbe (de er bevist andetsteds); den rigtige
//     universelle binaer fra vendor/ bruges, saa arkitektur- og versionstjek er aegte
//   - origin er en lokal bare-kopi; gh, npm og mcp-publisher er attrapper der logger
//   - en git-indpakning lader KUN `ls-remote` fejle, naar et scenarie beder om det
// Intet naar GitHub, npm eller registret.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

if (!existsSync(join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper'))) {
  console.log('SPR. fejlmatricen - mcp-server/vendor/cmcp-helper mangler (koer scripts/build-release.sh); umaalt, ikke bestaaet');
  process.exit(0);
}
const V = JSON.parse(readFileSync(join(ROOT, 'mcp-server', 'package.json'), 'utf8')).version;
const GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

function scenarie(navn, { gh = {}, npm = {}, git = {} } = {}) {
  const D = mkdtempSync(join(tmpdir(), `cmcp-rel-${navn}-`));
  const BARE = join(D, 'origin.git'), K = join(D, 'repo'), BIN = join(D, 'bin'), LOG = join(D, 'kald.log');
  mkdirSync(BIN);
  execFileSync(GIT, ['clone', '-q', '--no-hardlinks', ROOT, K]);
  // Proeven skal maale release.sh som det staar i arbejdstraeet, ogsaa foer commit.
  cpSync(join(ROOT, 'scripts', 'release.sh'), join(K, 'scripts', 'release.sh'));
  writeFileSync(join(K, 'scripts', 'build-release.sh'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(K, 'test', 'run-all.sh'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(K, 'scripts', 'build-release.sh'), 0o755); chmodSync(join(K, 'test', 'run-all.sh'), 0o755);
  const gitK = (...a) => execFileSync(GIT, a, { cwd: K, stdio: 'pipe', encoding: 'utf8' });
  gitK('-c', 'user.name=p', '-c', 'user.email=p@example.invalid', 'commit', '-qam', 'proeve: stubbe');
  gitK('checkout', '-q', '-B', 'main');           // kun i klonen i tmp
  execFileSync(GIT, ['clone', '-q', '--bare', K, BARE]);
  gitK('remote', 'set-url', 'origin', BARE); gitK('fetch', '-q', 'origin');
  gitK('branch', '-q', '-u', 'origin/main');
  for (const t of gitK('tag', '-l').split('\n').filter(Boolean)) gitK('tag', '-d', t);
  cpSync(join(ROOT, 'mcp-server', 'vendor'), join(K, 'mcp-server', 'vendor'), { recursive: true });
  const fp = execFileSync('/bin/sh', ['-c', 'cat mcp-server/policy.js test/failclosed.mjs | shasum -a 256 | cut -c1-16'], { cwd: K, encoding: 'utf8' }).trim();
  writeFileSync(join(K, '.dialog-kvittering'), `${fp} 2026-10-07T00:00:00Z\n`);

  const stub = (navn, krop) => { writeFileSync(join(BIN, navn), `#!/bin/sh\necho "${navn} $*" >> ${LOG}\n${krop}\n`); chmodSync(join(BIN, navn), 0o755); };
  stub('gh', `case "$1 $2" in
  "run list") ${gh.runList ?? 'echo success'} ;;
  "release view") exit 1 ;;
  "release create") ${gh.releaseCreate ?? 'exit 0'} ;;
  "pr create") echo https://github.com/x/y/pull/99 ;;
  *) exit 0 ;;
esac`);
  stub('npm', `case "$1" in
  whoami) echo proever ;;
  publish) ${npm.publish ?? 'exit 0'} ;;
  deprecate) ${npm.deprecate ?? 'exit 0'} ;;
  *) exec /usr/bin/env -u PATH npm "$@" ;;
esac`);
  stub('mcp-publisher', 'exit 0');
  writeFileSync(join(BIN, 'git'), `#!/bin/sh\nif [ "$1" = "ls-remote" ] && [ -n "${git.lsRemoteFejl ?? ''}" ]; then exit ${git.lsRemoteFejl ?? 0}; fi\nexec ${GIT} "$@"\n`);
  chmodSync(join(BIN, 'git'), 0o755);

  const r = spawnSync('bash', ['scripts/release.sh', V], { cwd: K, encoding: 'utf8', timeout: 300000,
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, GIT_AUTHOR_NAME: 'p', GIT_AUTHOR_EMAIL: 'p@example.invalid',
           GIT_COMMITTER_NAME: 'p', GIT_COMMITTER_EMAIL: 'p@example.invalid' } });
  const kald = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '';
  const fjernTag = spawnSync(GIT, ['ls-remote', '--tags', BARE, `refs/tags/v${V}`], { encoding: 'utf8' }).stdout.trim();
  return { rc: r.status, ud: (r.stdout || '') + (r.stderr || ''), kald, fjernTag, publiceret: readFileSync(join(K, 'PUBLICERET'), 'utf8').trim() };
}

// S1: GitHub svarer ikke paa CI-forespoergslen -> UKENDT, intet maerket.
const s1 = scenarie('ci', { gh: { runList: 'exit 1' } });
check('S1 gh fejler ved CI-tjek: stopper og siger UKENDT (ikke «ikke koert»)', s1.rc !== 0 && /UKENDT/.test(s1.ud) && !/har ikke koert/.test(s1.ud) && !s1.fjernTag,
      (s1.ud.match(/⛔[^\n]*/) || ['(ingen ⛔)'])[0].slice(0, 100));

// S2: ls-remote fejler (net) -> UKENDT, ikke «ledigt»; intet maerket.
const s2 = scenarie('lsremote', { git: { lsRemoteFejl: 128 } });
check('S2 ls-remote fejler: stopper og siger UKENDT, intet maerke', s2.rc !== 0 && /UKENDT, ikke ledigt/.test(s2.ud) && !s2.fjernTag && !/npm publish/.test(s2.kald),
      (s2.ud.match(/⛔[^\n]*/) || ['(ingen ⛔)'])[0].slice(0, 100));

// S3: publish lykkes, deprecate afbrydes (Ctrl-C under browserventetiden) -> ALDRIG «udgivelsen skete ikke».
//    Et rigtigt Ctrl-C rammer hele procesgruppen: barnet doer AF signalet, og bash ogsaa
//    (en barneproces der blot afslutter med 130, faar bash til at koere videre).
const s3 = scenarie('deprecate-afbrudt', { npm: { deprecate: 'kill -INT $PPID; kill -INT $$' } });
check('S3 forudsaetning: scriptet blev faktisk afbrudt under deprecate', s3.rc !== 0 && /npm publish/.test(s3.kald) && !/gh pr create/.test(s3.kald), `rc=${s3.rc}`);
check('S3 publish lykkedes, deprecate afbrudt: PUBLICERET staar paa den nye version', s3.publiceret === V, `PUBLICERET=${s3.publiceret}`);
check('S3 ...og scriptet paastaar ikke at udgivelsen ikke skete', !/udgivelsen skete ikke/.test(s3.ud), (s3.ud.match(/[^\n]*skete ikke[^\n]*/) || ['-'])[0].slice(0, 90));

// S4: deprecate fejler -> reservelinjen kan koeres ordret (citeret, hele beskeden).
const s4 = scenarie('deprecate-fejl', { npm: { deprecate: 'exit 1' } });
const linje = (s4.ud.match(/^\s+npm deprecate '.*$/m) || [''])[0].trim();
check('S4 deprecate fejler: reservelinjen er citeret og bærer hele beskeden', /^npm deprecate '@agent360\/computer-mcp@<0\.2\.1' 'Upgrade to [\d.]+: earlier versions could return an unredacted screenshot when redaction failed\.'$/.test(linje), linje.slice(0, 120));
// S6 (panel R13-R14, fejl a): advarslen rammer kun versionerne FOER 0.2.1 - aldrig «<V».
//    Med V = 0.2.2 ville «<V» advare om 0.2.1, der netop rettede fejlen.
const dep = (s4.kald.match(/^npm deprecate .*$/m) || [''])[0];
check('S6 advarslen rammer kun versioner foer 0.2.1, uanset hvilken version der udgives', /@agent360\/computer-mcp@<0\.2\.1 /.test(dep)
      && (V === '0.2.1' || !dep.includes(`@<${V}`)), dep.slice(0, 100));

// S5: alt lykkes -> maerke paa origin, publish, deprecate, PR og register i den raekkefoelge.
const s5 = scenarie('alt-groent');
const raek = ['gh release create', 'npm publish', 'npm deprecate', 'gh pr create', 'mcp-publisher publish'].map(k => s5.kald.indexOf(k));
check('S5 alt groent: rc 0, maerke paa origin, raekkefoelgen release -> publish -> deprecate -> PR -> register',
      s5.rc === 0 && !!s5.fjernTag && raek.every(i => i >= 0) && raek.every((v, i) => i === 0 || v > raek[i - 1]), `rc=${s5.rc} ${raek.join(',')}`);

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
