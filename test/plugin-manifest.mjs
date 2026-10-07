// CLAUDE CODE-PLUGINNET PEGER PAA DEN VERSION NPM SERVERER.
//
// ⛔ 7/10 (panel R8-R9, punkt K): én kommando i den klient brugerne sidder i
//    (`/plugin marketplace add Agent360dk/computerMCP`). Pluginnet starter serveren med
//    `npx -y @agent360/computer-mcp@<V>`. Peger det paa en anden version end pakken,
//    faar brugeren en server, sitet ikke beskriver. Proeven binder de tre sammen og
//    koerer Claude Codes egen validator, hvor den findes.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
// ⛔ 7/10 (panel R10-R11, B5): pluginnet fulgte PAKKENS version, og markedet paa main pegede
//    derfor paa en version npm ikke havde, fra fletning til udgivelse - en installation der
//    ikke kunne starte. Nu foelger det PUBLICERET (sync-tal.py), og dok-PR'en loefter det.
const V = readFileSync(join(ROOT, 'PUBLICERET'), 'utf8').trim();
const marked = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
const plugin = JSON.parse(readFileSync(join(ROOT, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));

const indgang = marked.plugins?.find(p => p.name === 'computer-mcp');
check('markedet har pluginnet og peger paa mappen i repoet', indgang?.source === './plugin', JSON.stringify(indgang?.source));
check('markedets version = PUBLICERET (det npm serverer)', indgang?.version === V, `${indgang?.version} / ${V}`);
check('pluginnets version = PUBLICERET', plugin.version === V, `${plugin.version} / ${V}`);
const srv = plugin.mcpServers?.['computer-mcp'];
check('serveren startes med npx laast til netop den version npm serverer', srv?.command === 'npx'
      && JSON.stringify(srv?.args) === JSON.stringify(['-y', `@agent360/computer-mcp@${V}`]), JSON.stringify(srv?.args));

const har = spawnSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' }).stdout.trim();
if (!har) {
  console.log('SPR. Claude Codes validator - `claude` findes ikke paa denne maskine (umaalt, ikke bestaaet)');
} else {
  for (const sti of ['.', 'plugin']) {
    const r = spawnSync('claude', ['plugin', 'validate', sti], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    check(`claude plugin validate ${sti}`, r.status === 0, ((r.stdout || '') + (r.stderr || '')).trim().split('\n').pop());
  }
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
