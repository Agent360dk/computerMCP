// Hvad kunne mennesket se, da et spoergsmaal stod i menulinjen?
//
// ⛔ 7/10 (panel R8-R9, punkt P): «1 af 23 besvaret» stod som et faktum, men loggen
//    gemte intet om, hvorvidt nogen brugte maskinen, eller hvad der blev vist. Opus
//    maalte at 13 af de 14 spoergsmaal 30/9 kom FOER boksen kunne sige at et
//    spoergsmaal ventede, og to midt om natten. Intet menulinje-tiltag kan maales
//    uden det her - derfor foerst.
//
//    Hvert spoergsmaal faar derfor i loggen:
//    - idle_at_ask / idle_at_end: sekunder siden sidste tastatur/mus (hjaelperens
//      `idle`), eller «unreadable». ⛔ Astra R9: inputaktivitet, IKKE bevis paa at
//      et menneske var til stede.
//    - server: denne servers version. icon: version af det ikon der KOERER (ikke det
//      medsendte - de kan vaere forskellige). box: om boksen er slaaet til.
//    - surface_derived: «box+menu» eller «menu», AFLEDT af samme input som ikonet
//      bruger (indstillingen + om der findes sessioner) - ikke maalt i ikonet, og
//      navnet siger det.
//    Kun tal, versioner og til/fra: intet der kan baere en hemmelighed.
import { execFile } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { callHelper } from './helper.js';
import { SESSIONS_DIR, STATUS_IKON_ID, IKON_PID_FIL } from './status.js';

const SERVER = (() => {
  try { return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8')).version; }
  catch { return 'unknown'; }
})();

const koer = (bin, args, ms = 1500) => new Promise((r) =>
  execFile(bin, args, { timeout: ms }, (e, ud) => r(e ? null : String(ud).trim())));

export async function idleNu() {
  try {
    const m = await callHelper(['idle'], { timeout: 1500 });
    const v = Number(m?.idle);
    return Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : 'unreadable';
  } catch { return 'unreadable'; }
}

export async function ikonTilstand() {
  // Aldrig sat = standard = boksen er til (main.swift: `boks-fra` er false som standard).
  const fra = await koer('/usr/bin/defaults', ['read', STATUS_IKON_ID, 'boks-fra']);
  const box = fra === '1' ? 'off' : 'on';
  // ⛔ 7/10 (Astra R10): her stod det FOERSTE cmcp-status i proceslisten, og versionen
  //    blev laest fra filen paa disken. Var ikonet skiftet ud uden genstart, sagde maalingen
  //    den nye version om den gamle proces. Nu: det ikon der ejer DENNE tilstandsmappe (dets
  //    status.pid - samme ikon som fik spoergsmaalet), og er versionsfilen aendret efter at
  //    processen startede, siges det i stedet for et tal.
  let icon = 'not running';
  let pid = null;
  try { pid = readFileSync(IKON_PID_FIL, 'utf8').trim(); } catch { pid = null; }
  if (pid && /^\d+$/.test(pid)) {
    const ps = await koer('/bin/ps', ['-o', 'etime=,comm=', '-p', pid]);
    const m = ps?.match(/^\s*([\d:-]+)\s+(.+\/Contents\/MacOS\/cmcp-status)$/);
    if (m) {
      const indhold = dirname(dirname(m[2]));
      const v = await koer('/usr/bin/defaults', ['read', join(indhold, 'Info'), 'CFBundleShortVersionString']);
      const [dage, rest] = m[1].includes('-') ? m[1].split('-') : ['0', m[1]];
      const startet = Date.now() - (Number(dage) * 86400 + rest.split(':').reduce((a, x) => a * 60 + Number(x), 0)) * 1000;
      let skiftet = false;
      try { skiftet = statSync(join(indhold, 'Info.plist')).mtimeMs > startet + 2000; } catch { skiftet = false; }
      icon = !v ? 'unknown' : skiftet ? 'replaced since start' : v;
    }
  }
  let sessions = 0;
  try { sessions = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json')).length; } catch { sessions = 0; }
  return { server: SERVER, icon, box, sessions, surface_derived: box === 'on' && sessions > 0 ? 'box+menu' : 'menu' };
}

/// Startes naar spoergsmaalet stilles; afsluttes naar det er afgjort.
/// Ved et JA maales ingen ny idle: idle_at_end er «answered» (et menneske svarede netop).
/// Hver del venter hoejst 1,5 s (slut-idle og saa start-maalingen), saa et svar forsinkes
/// hoejst ca. 3 s (Opus R10: her stod «hoejst 1,5 s»).
const loft = (p, ms, v) => Promise.race([p, new Promise(r => setTimeout(() => r(v), ms))]);
export function maalSpoergsmaal() {
  const start = Promise.all([idleNu(), ikonTilstand()]);
  return async (besvaretJa) => {
    const slut = besvaretJa ? 'answered' : await loft(idleNu(), 1500, 'unreadable');
    const r = await loft(start, 1500, null);
    if (!r) return { idle_at_ask: 'unreadable', idle_at_end: slut, server: SERVER, icon: 'unknown', box: 'unknown', sessions: null, surface_derived: 'unknown' };
    const [ved, t] = r;
    return { idle_at_ask: ved, idle_at_end: slut, ...t };
  };
}
