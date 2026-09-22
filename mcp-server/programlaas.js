// Én agent ad gangen i hvert program.
//
// ⛔ MAALT 22/9, foerste gang to agenter blev sat til at skrive samtidig:
//    - i HVER SIT program landede begge tekster rent
//    - i SAMME program blev de flettet tegn for tegn (67 skift paa 200 tegn)
//    (Jeg skrev foerst at 40 tegn ogsaa forsvandt. Det var maaleinstrumentet:
//    hjaelperen klipper feltvaerdier ved 200 tegn.)
//    Hver server troede det gik godt. Ingen fejl, ingen afvisning - bare
//    forkert tekst i et rigtigt program. Med 13 samtidige servere paa én
//    maskine er det ikke et haandtilfaelde.
//
// Laasen er en fil pr. program i state-mappen, skabt med O_EXCL, saa den
// virker paa tvaers af processer. Den holdes kun mens handlingen koerer, og
// den braekkes kun hvis ejeren er doed - ikke efter en tid, for en lang
// tekst kan tage laengere end nogen graense vi ville gaette paa.
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DIR = join(process.env.CMCP_STATE_DIR || join(homedir(), '.local', 'state', 'computer-mcp'), 'laase');

const sov = ms => new Promise(r => setTimeout(r, ms));

function ejerLever(sti) {
  try {
    const ejer = Number(readFileSync(sti, 'utf8').trim());
    if (!Number.isInteger(ejer) || ejer <= 0) return false;
    try { process.kill(ejer, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  } catch { return true; }   // kan ikke laeses lige nu: antag at den lever, og vent
}

/// Koer `fn` mens ingen anden agent handler i `program`.
/// Returnerer { ok: true, vaerdi } eller { ok: false } hvis ventetiden udloeb.
export async function medProgramLaas(program, fn, maksVentMs = 60_000) {
  const navn = String(program || '_global').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  const sti = join(DIR, navn + '.lock');
  if (!existsSync(DIR)) { try { mkdirSync(DIR, { recursive: true, mode: 0o700 }); } catch {} }
  const start = Date.now();
  for (;;) {
    try {
      const fd = openSync(sti, 'wx', 0o600);
      try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') return { ok: true, vaerdi: await fn() };   // kan ikke laase: gaa videre som foer
      if (!ejerLever(sti)) { try { unlinkSync(sti); } catch {} continue; }
      if (Date.now() - start > maksVentMs) return { ok: false };
      await sov(40);
    }
  }
  try {
    return { ok: true, vaerdi: await fn() };
  } finally {
    try { if (readFileSync(sti, 'utf8').trim() === String(process.pid)) unlinkSync(sti); } catch {}
  }
}
