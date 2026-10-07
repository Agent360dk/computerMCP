// EFTER npm: REGISTRET OG DOKUMENTATIONS-PR'EN, I ENHVER TILSTAND.
//
// ⛔ 7/10 (panel R2-R8, punkt E): tools/faerdiggoer-udgivelsen.sh fortsatte efter et
//    fejlet login til publish, koerte en kildeaendrende beviskoersel, glemte
//    npm-README'en og navngav grenen anderledes end release.sh. tools/dok-pr.sh
//    (fra genoptag-dok.sh, panel R4-R5) laver nu PR'en ud fra den faktiske tilstand.
//
// Koeres i en klon i tmp med lokal bare-origin og attrapper for npm, curl (registret),
// mcp-publisher og gh. gh-attrappen sender AEGTE JSON gennem `jq -r "<-q>"`: en tom
// liste er `[]`, ikke en tom streng (den forskel kostede en falsk «PR'en findes», R4).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const V = JSON.parse(readFileSync(join(ROOT, 'mcp-server', 'package.json'), 'utf8')).version;
const GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const GREN = `release-${V}-dok`;

function opsaet(navn) {
  const D = mkdtempSync(join(tmpdir(), `cmcp-efter-${navn}-`));
  const K = join(D, 'repo'), BARE = join(D, 'origin.git'), BIN = join(D, 'bin'), LOG = join(D, 'kald.log');
  mkdirSync(BIN);
  execFileSync(GIT, ['clone', '-q', '--no-hardlinks', ROOT, K]);
  for (const f of ['tools/dok-pr.sh', 'tools/faerdiggoer-udgivelsen.sh', 'scripts/sync-tal.py'])
    writeFileSync(join(K, f), readFileSync(join(ROOT, f)));
  const g = (...a) => execFileSync(GIT, a, { cwd: K, stdio: 'pipe', encoding: 'utf8' });
  g('add', '-A', 'tools', 'scripts');
  g('-c', 'user.name=p', '-c', 'user.email=p@example.invalid', 'commit', '-qm', 'proeve: arbejdstraeets vaerktoejer', '--allow-empty');
  g('checkout', '-q', '-B', 'main');
  execFileSync(GIT, ['clone', '-q', '--bare', K, BARE]);
  g('remote', 'set-url', 'origin', BARE); g('fetch', '-q', 'origin'); g('branch', '-q', '-u', 'origin/main');
  const stub = (n, krop) => { writeFileSync(join(BIN, n), `#!/bin/sh\necho "${n} $*" >> ${LOG}\n${krop}\n`); chmodSync(join(BIN, n), 0o755); };
  return { D, K, BARE, BIN, LOG, g, stub };
}
function koer(o, script, { npmV = V, registret = V, login = 'exit 0', prJson = '[]', gitFejl = '' } = {}, ekstra = []) {
  writeFileSync(join(o.D, 'registret'), registret);
  o.stub('npm', `case "$1" in view) echo ${npmV} ;; *) exit 0 ;; esac`);
  o.stub('curl', `printf '{"servers":[{"server":{"name":"io.github.Agent360dk/computer-mcp","version":"%s"},"_meta":{"io.modelcontextprotocol.registry/official":{"isLatest":true}}}]}' "$(cat ${join(o.D, 'registret')})"`);
  o.stub('mcp-publisher', `case "$1" in login) ${login} ;; publish) echo ${V} > ${join(o.D, 'registret')} ;; esac`);
  o.stub('gh', `if [ "$1 $2" = "pr list" ]; then q=""; while [ $# -gt 0 ]; do [ "$1" = "-q" ] && q="$2"; shift; done; printf '%s' '${prJson}' | jq -r "$q"; fi`);
  writeFileSync(join(o.BIN, 'git'), `#!/bin/sh\nif [ "$1" = "ls-remote" ] && [ -n "${gitFejl}" ]; then exit ${gitFejl || 0}; fi\nexec ${GIT} "$@"\n`);
  chmodSync(join(o.BIN, 'git'), 0o755);
  const r = spawnSync('bash', [script, ...ekstra], { cwd: o.K, encoding: 'utf8', timeout: 300000,
    env: { ...process.env, PATH: `${o.BIN}:${process.env.PATH}`, GIT_AUTHOR_NAME: 'p', GIT_AUTHOR_EMAIL: 'p@example.invalid',
           GIT_COMMITTER_NAME: 'p', GIT_COMMITTER_EMAIL: 'p@example.invalid' } });
  return { rc: r.status, ud: (r.stdout || '') + (r.stderr || ''), kald: existsSync(o.LOG) ? readFileSync(o.LOG, 'utf8') : '' };
}
const paaOrigin = (o, sti) => spawnSync(GIT, ['--git-dir', o.BARE, 'show', `${GREN}:${sti}`], { encoding: 'utf8' });
const grenFiler = (o) => spawnSync(GIT, ['--git-dir', o.BARE, 'diff', '--name-only', 'main', GREN], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);

// F1 npm har ikke versionen: intet sker.
{ const o = opsaet('f1'); const r = koer(o, 'tools/faerdiggoer-udgivelsen.sh', { npmV: '0.1.0', registret: '0.1.0' });
  check('F1 npm mangler versionen: stop foer registret', r.rc !== 0 && !/mcp-publisher/.test(r.kald), `rc=${r.rc}`); }

// F2 login fejler: ingen publish, ingen PR.
{ const o = opsaet('f2'); const r = koer(o, 'tools/faerdiggoer-udgivelsen.sh', { registret: '0.1.0', login: 'exit 1' });
  check('F2 login fejler: STOP - ingen publish og ingen PR', r.rc !== 0 && /mcp-publisher login/.test(r.kald) && !/mcp-publisher publish/.test(r.kald) && !/gh pr create/.test(r.kald),
        (r.ud.match(/⛔[^\n]*/) || ['-'])[0].slice(0, 80)); }

// F3 alt lykkes fra bunden: register, ny gren med npm-README'en, PR, main ren.
{ const o = opsaet('f3'); const r = koer(o, 'tools/faerdiggoer-udgivelsen.sh', { registret: '0.1.0' });
  const filer = grenFiler(o);
  check('F3 alt groent: rc 0, registret opdateret, PR oprettet', r.rc === 0 && /mcp-publisher publish/.test(r.kald) && /gh pr create/.test(r.kald), `rc=${r.rc}`);
  check("F3 ...grenen hedder som release.sh's og baerer npm-README'en", filer.includes('mcp-server/README.md') && filer.includes('PUBLICERET'), `${filer.length} filer`);
  check("F3 ...forbeholdet er vaek fra forsiden og npm-README'en", !/currently serves/.test(paaOrigin(o, 'docs/index.html').stdout) && !/not published yet/.test(paaOrigin(o, 'mcp-server/README.md').stdout));
  check('F3 ...arbejdstraeet staar rent paa main bagefter', o.g('status', '--porcelain').trim() === '' && o.g('branch', '--show-current').trim() === 'main', o.g('status', '--porcelain').trim().slice(0, 120) + ' @ ' + o.g('branch', '--show-current').trim());
  check('F3 ...ingen kildeaendrende beviskoersel', !/bevis\.sh/.test(r.kald) && !filer.includes('mcp-server/audit.js'));
  // Panel R11 (B5): pluginnet og markedet foelger PUBLICERET og loeftes HER, efter publish.
  let pl = {}, mk = {}; try { pl = JSON.parse(paaOrigin(o, 'plugin/.claude-plugin/plugin.json').stdout); mk = JSON.parse(paaOrigin(o, '.claude-plugin/marketplace.json').stdout); } catch {}
  check("F3 ...dok-PR'en loefter pluginnet og markedet til den udgivne version", pl.version === V
        && JSON.stringify(pl.mcpServers?.['computer-mcp']?.args) === JSON.stringify(['-y', `@agent360/computer-mcp@${V}`])
        && mk.plugins?.[0]?.version === V && filer.includes('plugin/.claude-plugin/plugin.json'), `${pl.version} / ${mk.plugins?.[0]?.version} / ${V}`); }

// F4 PR'en findes allerede (registret ogsaa): intet skubbes.
{ const o = opsaet('f4'); const r = koer(o, 'tools/faerdiggoer-udgivelsen.sh', { prJson: '[{"number":12,"state":"OPEN"}]' });
  check('F4 PR findes: intet login, intet nyt PR', r.rc === 0 && !/mcp-publisher login/.test(r.kald) && !/gh pr create/.test(r.kald) && /findes allerede/.test(r.ud), `rc=${r.rc}`); }

// F5 grenen findes kun paa origin (PR-oprettelsen fejlede sidst): skub + PR, ingen regenerering paa main.
{ const o = opsaet('f5');
  o.g('checkout', '-q', '-b', GREN); writeFileSync(join(o.K, 'PUBLICERET'), V + '\n');
  execFileSync('python3', ['scripts/sync-tal.py'], { cwd: o.K, stdio: 'pipe' });
  o.g('add', '-A'); o.g('-c', 'user.name=p', '-c', 'user.email=p@example.invalid', 'commit', '-qm', 'dok'); o.g('push', '-q', 'origin', GREN);
  o.g('checkout', '-q', 'main'); o.g('branch', '-q', '-D', GREN);
  const r = koer(o, 'tools/dok-pr.sh');
  check('F5 gren kun paa origin: PR oprettes, main roeres ikke', r.rc === 0 && /gh pr create/.test(r.kald) && o.g('status', '--porcelain').trim() === '', `rc=${r.rc} ${r.ud.slice(-300).replace(/\s+/g, ' ')}`); }

// F6 synkroniseringen doede halvvejs (PUBLICERET skrevet, siderne ikke): naeste koersel retter det.
{ const o = opsaet('f6'); writeFileSync(join(o.K, 'PUBLICERET'), V + '\n');
  const r = koer(o, 'tools/dok-pr.sh');
  check('F6 halv synkronisering: grenen faar ogsaa siderne', r.rc === 0 && !/currently serves/.test(paaOrigin(o, 'docs/index.html').stdout) && grenFiler(o).includes('docs/index.html'), `rc=${r.rc}`); }

// F7 origin kan ikke naas: stop, intet skrevet.
{ const o = opsaet('f7'); const r = koer(o, 'tools/dok-pr.sh', { gitFejl: '128' });
  check('F7 origin nede: stop, intet skrevet', r.rc !== 0 && /kan ikke n(å|aa) origin/.test(r.ud) && o.g('status', '--porcelain').trim() === '', (r.ud.match(/⛔[^\n]*/) || ['-'])[0].slice(0, 80)); }

// F9 (Astra R10) committet fejler én gang efter at grenen er oprettet; naeste koersel
//    faerdiggoer committet i stedet for at stoppe med «ingen aendringer».
{ const o = opsaet('f9');
  mkdirSync(join(o.D, 'kroge'));
  o.g('config', 'core.hooksPath', join(o.D, 'kroge'));
  writeFileSync(join(o.D, 'kroge', 'pre-commit'), '#!/bin/sh\nexit 1\n'); chmodSync(join(o.D, 'kroge', 'pre-commit'), 0o755);
  const foer = koer(o, 'tools/dok-pr.sh');
  check('forudsaetning F9: foerste koersel fejler i committet', foer.rc !== 0 && o.g('branch', '--show-current').trim() === GREN, `rc=${foer.rc}`);
  writeFileSync(join(o.D, 'kroge', 'pre-commit'), '#!/bin/sh\nexit 0\n');
  const toer = koer(o, 'tools/dok-pr.sh', {}, ['--toer']);
  check('F9 toerkoerslen viser det manglende commit og stopper ikke', toer.rc === 0 && /git commit/.test(toer.ud), `rc=${toer.rc}`);
  const r = koer(o, 'tools/dok-pr.sh');
  check('F9 genoptaget efter fejlet commit: committet faerdiggjort, skubbet, PR oprettet', r.rc === 0 && /gh pr create/.test(r.kald)
        && grenFiler(o).includes('PUBLICERET'), `rc=${r.rc} ${(r.ud.match(/⛔[^\n]*/) || [''])[0].slice(0, 80)}`); }

// F10/F11 (Astra R11, MÅLT): en andens STAGED kildekode maa aldrig komme med paa dok-grenen -
//    hverken ved genoptagelse efter et fejlet commit (F10) eller paa den nye gren (F11) - og
//    den skal stadig ligge staged bagefter.
const fremmed = (o) => { writeFileSync(join(o.K, 'mcp-server', 'index.js'), readFileSync(join(o.K, 'mcp-server', 'index.js'), 'utf8') + '\n// fremmed\n');
  o.g('add', 'mcp-server/index.js'); };
{ const o = opsaet('f10');
  mkdirSync(join(o.D, 'kroge'));
  o.g('config', 'core.hooksPath', join(o.D, 'kroge'));
  writeFileSync(join(o.D, 'kroge', 'pre-commit'), '#!/bin/sh\nexit 1\n'); chmodSync(join(o.D, 'kroge', 'pre-commit'), 0o755);
  koer(o, 'tools/dok-pr.sh');
  writeFileSync(join(o.D, 'kroge', 'pre-commit'), '#!/bin/sh\nexit 0\n');
  fremmed(o);
  const r = koer(o, 'tools/dok-pr.sh');
  check('F10 genoptagelse: kun vores filer paa dok-grenen, den fremmede aendring stadig staged', r.rc === 0 && /gh pr create/.test(r.kald)
        && !grenFiler(o).includes('mcp-server/index.js') && o.g('diff', '--cached', '--name-only').includes('mcp-server/index.js'),
        `rc=${r.rc} gren: ${grenFiler(o).join(',').slice(0, 80)}`); }
{ const o = opsaet('f11'); fremmed(o);
  const r = koer(o, 'tools/dok-pr.sh');
  check('F11 ny gren: kun vores filer paa dok-grenen, den fremmede aendring stadig staged', r.rc === 0 && /gh pr create/.test(r.kald)
        && !grenFiler(o).includes('mcp-server/index.js') && o.g('diff', '--cached', '--name-only').includes('mcp-server/index.js'),
        `rc=${r.rc} gren: ${grenFiler(o).join(',').slice(0, 80)}`); }

// F8 GitHubs tomme liste `[]` er IKKE «PR'en findes».
{ const o = opsaet('f8'); const r = koer(o, 'tools/dok-pr.sh', { prJson: '[]' });
  check('F8 tom PR-liste ([]): ingen falsk «findes», PR oprettes', !/findes allerede/.test(r.ud) && /gh pr create/.test(r.kald), `rc=${r.rc}`); }

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
