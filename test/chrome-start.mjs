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
/// Sekunder siden personen sidst rørte mus eller tastatur (HIDIdleTime, uden hjaelperen).
export function inaktivSek() {
  try { const m = execFileSync('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4'], { encoding: 'utf8' }).match(/"HIDIdleTime" = (\d+)/);
        return m ? Number(m[1]) / 1e9 : 0; } catch { return 0; }
}
/// ⛔ MAALT 5/11 kl. 08.21: Chrome henter sig selv frem trods `open -g` (forreste proces skiftede i 8 af 8
///    koersler). En proeve maa derfor kun starte en Chrome, naar personen IKKE arbejder - og den spoerger
///    lige foer starten, ikke kun foer hele suiten.
export const MIN_INAKTIV = 60;

/// ⛔ 5/11 (Opus R4-5 + maalt 09.45): rørte personen mus eller tastatur UNDER proeven, kan deres vinduer have
///    daekket proevens, og Chrome bygger ikke en side i et vindue der ikke har vaeret forrest. Et roedt resultat
///    beviser da intet om koden. Kaldes til sidst: svarer sandt, hvis personen har vaeret aktiv siden `startMs`.
export function forstyrretSiden(startMs) { return inaktivSek() < (Date.now() - startMs) / 1000 - 1; }
/// Slutlinjen: roedt + forstyrret = SPRUNGET (bevist intet), ellers den aerlige dom.
export function slutDom(fejl, n, startMs) {
  if (fejl && forstyrretSiden(startMs)) {
    console.log(`SPRUNGET OVER: ${n} (personen kom tilbage undervejs - ${fejl} roede tjek beviser intet om koden) - bevist intet, ikke bestaaet`);
    return 0;
  }
  console.log(fejl ? `\n${fejl} DUMPET` : '\nBESTAAET');
  return fejl ? 1 : 0;
}

export async function startChrome(args) {
  const profilArg = args.find((a) => a.startsWith('--user-data-dir='));
  if (!profilArg) throw new Error('startChrome kraever en egen --user-data-dir');
  // ⛔ MAALT 5/11 kl. 08.2x: moenstret startede med «--user-data-dir=», og pgrep/pkill laeste det som et
  //    ukendt flag - oprydningen lukkede INTET, og naeste proeve maalte forrige proeves vinduer. Kun stien.
  const profil = profilArg.slice('--user-data-dir='.length);
  const moenster = profil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const foer = forrest();
  execFileSync('/usr/bin/open', ['-g', '-n', '-a', 'Google Chrome', '--args', ...args]);
  let pid = 0;
  for (let i = 0; i < 40 && !pid; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { pid = Number(execFileSync('/usr/bin/pgrep', ['-o', '-f', moenster], { encoding: 'utf8' }).trim().split('\n')[0]) || 0; } catch { /* ikke startet endnu */ }
  }
  const stop = () => {
    // R9 (Astra): ogsaa oprydningens proceskald har en frist (5 s); et tidsudloeb maaler intet og taeller ikke som lukket.
    try { execFileSync('/usr/bin/pkill', ['-f', moenster], { timeout: 5000 }); } catch { /* allerede vaek, eller fejl - maales nedenfor */ }
    // Maal at den er vaek - en oprydning der ikke virker, var hele fejlen 08.2x.
    // R8 (Astra, MAALT): enhver pgrep-fejl talte som «lukket». Kun status 1 betyder «ingen tilbage»; en fejl (2, 3) maaler intet.
    for (let i = 0; i < 20; i++) { try { execFileSync('/usr/bin/pgrep', ['-f', moenster], { timeout: 5000 }); } catch (e) { if (e.status === 1) return true; } execFileSync('/bin/sleep', ['0.25']); }
    try { execFileSync('/usr/bin/pkill', ['-9', '-f', moenster], { timeout: 5000 }); } catch { /* vaek */ }
    return false;
  };
  // ASN, ikke navn: personens eget Chrome og test-Chrome hedder begge «Google Chrome».
  return { pid, stop, forrestFoer: foer, forrestEfter: forrest, forrestNavn };
}
