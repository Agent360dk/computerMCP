// FORREST-LOGGEN: hvad der stod forrest, læst i macOS' egen log - ikke gættet.
//
// ⛔ HVORFOR DEN FINDES (1/10-2026, konsulent-panelet)
//    Den gamle vagt i parallel.mjs spurgte NSWorkspace.frontmostApplication i en
//    langlivet osascript-løkke. Den værdi opdateres kun når processens run-loop
//    kører (Apple: «if you repeatedly poll … without allowing the run loop to run,
//    it will continue to return false»). Målt på Gustavs Mac 1/10: vagten skrev
//    1 linje pr. runde, mens macOS' log havde 26 skift - og den kaldte en runde
//    grøn, hvor Skak stod forrest i 10 sekunder.
//
//    Her læses to kilder i systemets log, med årsag:
//      launchservicesd  SETFRONT: pid=… oldFrontPid=…        (HVEM blev forrest)
//      WindowServer     <id>[Årsag]: … the front process      (HVORFOR)
//    Årsagerne målt 1/10: SetManagedDisplayCurrentSpace (mennesket skiftede
//    skrivebord), SetFrontProcess (et program bad om det), DoDeferredOrdering
//    (programmet ordnede selv et vindue frem, fx et gem-panel).
//
// ⛔ Instrumentet beviser selv at det ser: en puls via `logger` hvert 2. sekund
//    skal nå strømmen, og antallet af skift i strømmen skal være det samme som
//    `log show` finder for samme tidsrum bagefter. Ellers er målingen UMÅLT.
import { spawn, execFileSync } from 'node:child_process';

const PRED_SKIFT = '(subsystem == "com.apple.processmanager" AND eventMessage CONTAINS "SETFRONT")';
const PRED_AARSAG = '(process == "WindowServer" AND category == "Focus" AND eventMessage CONTAINS "the front process")';
const PULS = 'cmcp-vagt-puls';
const vent = (ms) => new Promise(r => setTimeout(r, ms));

/// Én hændelse fra loggen (ndjson-linje fra `log stream`/`log show --style ndjson`)
/// → {t, slags:'skift'|'aarsag'|'puls', pid, fra, aarsag}. Ukendt → null.
export function tolk(linje) {
  let e; try { e = JSON.parse(linje); } catch { return null; }
  const m = e.eventMessage || '';
  const t = Date.parse(String(e.timestamp || '').replace(' ', 'T').replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
  let r;
  if ((r = /SETFRONT: pid=(\d+).*oldFrontPid=(-?\d+)/.exec(m))) return { t, slags: 'skift', pid: +r[1], fra: +r[2] };
  if ((r = /\[([A-Za-z]+)\]: \[DataSource\] Making .* the front process/.exec(m))) return { t, slags: 'aarsag', aarsag: r[1] };
  if (m.includes(PULS)) return { t, slags: 'puls' };
  return null;
}

/// Parrer hvert skift med WindowServers årsag (nærmeste inden for 150 ms).
export function parSkift(haendelser) {
  const aarsager = haendelser.filter(h => h.slags === 'aarsag');
  return haendelser.filter(h => h.slags === 'skift').map(s => {
    let bedst = null;
    for (const a of aarsager) if (Math.abs(a.t - s.t) <= 150 && (!bedst || Math.abs(a.t - s.t) < Math.abs(bedst.t - s.t))) bedst = a;
    return { ...s, aarsag: bedst?.aarsag || 'ukendt' };
  });
}

/// Dommen over en række skift. `agentPid(pid)` siger om pid'en er et af agenternes programmer.
///   1. Et agent-program kom forrest af andet end menneskets skrivebordsskift.
///   2. Forgrunden blev trukket TILBAGE (SetFrontProcess til det program der stod forrest
///      lige før) inden for 1,5 s efter at mennesket selv skiftede skrivebord.
export function doem(skift, agentPid) {
  const fejl = [];
  skift.forEach((s, i) => {
    if (agentPid(s.pid) && s.aarsag !== 'SetManagedDisplayCurrentSpace')
      fejl.push({ t: s.t, slags: 'agent-program forrest', pid: s.pid, aarsag: s.aarsag });
    const forrige = skift[i - 1];
    if (s.aarsag === 'SetFrontProcess' && forrige && forrige.aarsag === 'SetManagedDisplayCurrentSpace'
        && s.t - forrige.t <= 1500 && s.pid === forrige.fra)
      fejl.push({ t: s.t, slags: 'trak forgrunden tilbage fra mennesket', pid: s.pid, aarsag: s.aarsag, efterMs: s.t - forrige.t });
  });
  return fejl;
}

const hhmmss = (t) => new Date(t).toTimeString().slice(0, 8);

/// Start strømmen. stop() giver {skift, puls, umaalt?:grund}.
export function startForrestLog() {
  const t0 = Date.now();
  const p = spawn('/usr/bin/log', ['stream', '--style', 'ndjson', '--predicate',
    `${PRED_SKIFT} OR ${PRED_AARSAG} OR (process == "logger" AND eventMessage CONTAINS "${PULS}")`],
    { stdio: ['ignore', 'pipe', 'ignore'] });
  const h = []; let buf = '';
  p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const x = tolk(buf.slice(0, i)); buf = buf.slice(i + 1); if (x) h.push(x); } });
  let n = 0;
  const ur = setInterval(() => { try { spawn('logger', [`${PULS} ${++n}`], { stdio: 'ignore' }); } catch {} }, 2000);
  return {
    async stop() {
      clearInterval(ur);
      try { spawn('logger', [`${PULS} slut`], { stdio: 'ignore' }); } catch {}
      await vent(2500);
      try { p.kill(); } catch {}
      const t1 = Date.now();
      const skift = parSkift(h);
      const puls = h.filter(x => x.slags === 'puls').length;
      let umaalt = null;
      if (puls < Math.max(1, Math.floor((t1 - t0) / 2000) - 2)) umaalt = `strømmen svarede ikke: ${puls} puls(er) på ${((t1 - t0) / 1000).toFixed(0)} s`;
      // Kalibrering: arkivet skal have præcis de samme skift som strømmen så.
      if (!umaalt) {
        const fmt = (t) => { const d = new Date(t); const z = (x, n = 2) => String(x).padStart(n, '0');
          return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`; };
        try {
          const ud = execFileSync('/usr/bin/log', ['show', '--style', 'ndjson', '--start', fmt(t0 - 1000), '--end', fmt(t1),
            '--predicate', PRED_SKIFT], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000 });
          const arkiv = ud.split('\n').map(tolk).filter(x => x?.slags === 'skift' && x.t >= t0 && x.t <= t1 - 2500).length;
          const strom = skift.filter(s => s.t >= t0 && s.t <= t1 - 2500).length;
          if (arkiv !== strom) umaalt = `strømmen så ${strom} skift, arkivet har ${arkiv} for samme tidsrum`;
        } catch (e) { umaalt = `arkivet kunne ikke læses: ${String(e.message).slice(0, 120)}`; }
      }
      return { skift, puls, umaalt, t0, hhmmss };
    },
  };
}
