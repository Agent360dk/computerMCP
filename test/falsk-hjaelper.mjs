// En hjaelper der ikke kan roere skaermen.
//
// ⛔ FUNDET AF RAADGIVEREN 19/9. Tre af proeverne beder om en AEGTE handling og
//    regner med at porten afviser den: `failclosed.mjs` klikker i (5,5) - som
//    er Apple-menuen - `server-e2e.mjs` klikker i (10,10), og `concurrent.mjs`
//    sender escape to gange. Saa laenge porten er groen, naar intet frem.
//
//    Men proeverne findes jo netop for det tilfaelde hvor porten IKKE er groen.
//    En roed port under en proevekoersel ville altsaa aabne Apple-menuen paa
//    den skaerm mennesket sidder og arbejder ved - og det er praecis den
//    klasse afbrydelse Gustav har bedt fire gange om at slippe for.
//
//    Seam'en fandtes allerede (`CMCP_HELPER`, brugt i paastand 8). Den bruges
//    nu i ALLE port-proever: bryder porten sammen, lander handlingen i en
//    tekstfil i stedet for paa skaermen, og proeven kan stadig se at den kom.
import { writeFileSync, chmodSync, mkdtempSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export function lavFalskHjaelper(navn = 'cmcp-falsk') {
  const dir = mkdtempSync(join(tmpdir(), navn + '-'));
  // Den rigtige hjaelper - opslag sendes videre dertil, saa proeverne stadig
  // maaler virkeligheden. Findes den ikke, svarer attrappen selv.
  const ROD = new URL('..', import.meta.url).pathname;
  const rigtig = [join(ROD, 'mcp-server', 'vendor', 'cmcp-helper'),
                  join(ROD, 'helper', '.build', 'release', 'cmcp-helper')]
                 .find(p => existsSync(p)) || '/usr/bin/false';
  const spor = join(dir, 'kaldt.jsonl');
  const js = join(dir, 'h.mjs');
  // ⛔ Foerste udgave slugte ALT og faeldede syv aegte tjek i server-e2e:
  //    proeven spoerger om skaermbilleder, vinduer og rettigheder, og fik
  //    {ok:true} tilbage. En attrap der svarer forkert paa det den ikke skal
  //    beskytte imod, er ikke en beskyttelse - den er en ny fejlkilde.
  //
  //    Derfor: OPSLAG sendes videre til den rigtige hjaelper og svarer sandt.
  //    Kun HANDLINGER - dem der kan roere skaermen - sluges og noteres.
  writeFileSync(js, `
import { appendFileSync } from 'fs';
import { spawnSync } from 'child_process';
const argv = process.argv.slice(2);
const kommando = argv[0] || '';
const HANDLING = new Set(['click','press','type','key','move','scroll','menu',
                          'window','launch','quit','activate','paste','space']);
appendFileSync(${JSON.stringify(spor)}, JSON.stringify({ argv, ts: Date.now() }) + '\\n');
if (HANDLING.has(kommando)) {
  process.stdout.write(JSON.stringify({ ok: true, note: 'attrap - intet blev udfoert' }) + '\\n');
  process.exit(0);
}
// alt andet er et opslag: lad den rigtige hjaelper svare sandt
const ind = ${JSON.stringify(rigtig)};
const r = spawnSync(ind, argv, { encoding: 'utf8', input: '' });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status === null ? 1 : r.status);
`);
  const wrapper = join(dir, 'w.sh');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
  chmodSync(wrapper, 0o755);
  return {
    sti: wrapper,
    /// Hvad naaede frem til hjaelperen? Tom liste = porten holdt.
    kald() {
      if (!existsSync(spor)) return [];
      return readFileSync(spor, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    },
    /// Naaede en HANDLING frem? (opslag som `frontmost` er harmloese)
    handlingerNaaedeFrem() {
      const handling = new Set(['click', 'press', 'type', 'key', 'move', 'scroll',
                                'menu', 'window', 'launch', 'quit', 'activate', 'paste', 'space']);
      return this.kald().filter(k => handling.has(k.argv[0]));
    }
  };
}
