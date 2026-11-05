// Start en engangs-Chrome UDEN at tage personens forreste vindue.
//
// ⛔ 5/11 kl. ~07.40: prøverne startede Chrome direkte (spawn), og en ny Chrome-proces henter sig selv
//    frem. Kl. 06.35-06.47 arbejdede personen i sit eget Chrome, mens prøvevinduerne åbnede. Nu: `open -g -n`
//    (LaunchServices i baggrunden, ny instans), og prøven MÅLER bagefter at det forreste program er det samme.
import { execFileSync } from 'node:child_process';

const forrest = () => { try { return execFileSync('/usr/bin/lsappinfo', ['front'], { encoding: 'utf8' }).trim(); } catch { return '?'; } };
const forrestNavn = () => { try { return execFileSync('/usr/bin/lsappinfo', ['info', '-only', 'name', forrest()], { encoding: 'utf8' }).trim(); } catch { return '?'; } };

/// Starter Chrome med de givne argumenter (profilen SKAL vaere en egen --user-data-dir).
/// Svarer { pid, stop(), forrestFoer, forrestEfter() }.
export async function startChrome(args) {
  const profil = args.find((a) => a.startsWith('--user-data-dir='));
  if (!profil) throw new Error('startChrome kraever en egen --user-data-dir');
  const foer = forrest();
  execFileSync('/usr/bin/open', ['-g', '-n', '-a', 'Google Chrome', '--args', ...args]);
  let pid = 0;
  for (let i = 0; i < 40 && !pid; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { pid = Number(execFileSync('/usr/bin/pgrep', ['-o', '-f', profil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')], { encoding: 'utf8' }).trim().split('\n')[0]) || 0; } catch { /* ikke startet endnu */ }
  }
  const stop = () => {
    try { execFileSync('/usr/bin/pkill', ['-f', profil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')]); } catch { /* allerede vaek */ }
  };
  // ASN, ikke navn: personens eget Chrome og test-Chrome hedder begge «Google Chrome».
  return { pid, stop, forrestFoer: foer, forrestEfter: forrest, forrestNavn };
}
