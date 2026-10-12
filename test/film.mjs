// FILM: en skaermoptagelse af det en proeve goer, saa et menneske kan SE beviset.
//
// ⛔ HVORFOR DEN FINDES (1/10-2026)
//    Gustav: «film hvordan den fungerer, saa du sikrer at alle use cases leverer».
//    Et JSON-svar siger at det virkede; en film viser det - ogsaa det ingen proeve
//    spurgte om (et vindue der blinkede frem, en dialog der stod og ventede).
//
// ⛔ KUN PAA EN FREMMED MASKINE (CMCP_FREMMED_MASKINE=1) og kun naar en mappe er
//    givet (CMCP_FILM=<mappe>). Paa menneskets Mac optages ALDRIG - det er hans
//    skaerm, ikke vores bevismateriale.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const vent = (ms) => new Promise(r => setTimeout(r, ms));

export function filmMappe() {
  if (process.env.CMCP_FREMMED_MASKINE !== '1' || !process.env.CMCP_FILM) return null;
  mkdirSync(process.env.CMCP_FILM, { recursive: true });
  return process.env.CMCP_FILM;
}

let ffmpeg = null;
function findFfmpeg() {
  if (ffmpeg !== null) return ffmpeg;
  for (const p of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) if (existsSync(p)) return (ffmpeg = p);
  try { return (ffmpeg = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim()); } catch { return (ffmpeg = ''); }
}

/// Starter en optagelse af hovedskaermen. `stop()` afslutter den og giver stien,
/// eller null hvis der ikke kom en brugbar film ud (saa siger rapporten det).
export function startFilm(navn) {
  const mappe = filmMappe();
  const ff = mappe && findFfmpeg();
  if (!mappe || !ff) return { sti: null, stop: async () => null, grund: mappe ? 'ffmpeg mangler' : 'ikke en fremmed maskine' };
  const sti = join(mappe, `${navn.replace(/[^\w.-]+/g, '-')}.mp4`);
  const p = spawn(ff, ['-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-capture_cursor', '1',
    '-framerate', '10', '-i', 'Capture screen 0:none', '-vf', 'scale=1280:-2', '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-y', sti], { stdio: ['pipe', 'ignore', 'pipe'] });
  let fejl = '';
  p.stderr.on('data', d => { fejl += d; });
  const slut = new Promise(r => p.on('close', r));
  return {
    sti,
    async stop() {
      try { p.stdin.write('q'); p.stdin.end(); } catch {}
      const t = setTimeout(() => { try { p.kill('SIGINT'); } catch {} }, 8000);
      await slut; clearTimeout(t);
      await vent(200);
      return existsSync(sti) && statSync(sti).size > 10_000 ? sti : null;
    },
    fejl: () => fejl.slice(0, 300),
  };
}
