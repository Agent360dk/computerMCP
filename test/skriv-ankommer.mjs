// SKRIV-ANKOMMER: når tekst til et program, der IKKE er forrest, faktisk frem?
//
// ⛔ HVORFOR DEN FINDES (27/9-2026)
//    Chat 88 skrev i Finders søgefelt med `type --app`; produktet svarede «skrevet»,
//    og intet kom frem. Tastetryk til et programs egen kø lander kun, hvis programmet
//    har et nøglevindue - og det har et program i baggrunden ofte ikke. e2e-forloeb
//    var rød 2 af 5 gange på netop «teksten ankom» 25/9.
//    Nu skrives der i programmets fokuserede felt gennem tilgængeligheds-laget, og
//    feltet læses tilbage. Et kodeordsfelt tager aldrig den vej.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HJAELPER = [process.env.CMCP_HELPER, join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper')].find(p => p && existsSync(p));
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const koer = (...a) => { try { return JSON.parse(execFileSync(HJAELPER, a, { encoding: 'utf8', timeout: 60000 })); }
                          catch (e) { try { return JSON.parse(String(e.stdout)); } catch { return { ok: false, error: String(e.stdout || e.message).slice(0, 200) }; } } };

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-skriv-'));
const MAAL = join(ARB, 'bin');
execFileSync('swiftc', ['-O', join(ROOT, 'test', 'fixture', 'proevemaal.swift'), '-o', MAAL], { stdio: 'pipe', timeout: 180000 });
const boern = [];
async function start(env) {
  const navn = 'cmcpskriv' + Math.random().toString(36).slice(2, 8);
  const sti = join(ARB, navn); execFileSync('cp', [MAAL, sti]);
  const b = spawn(sti, { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...env } }); boern.push(b);
  await new Promise((res) => { b.stdout.on('data', (d) => { if (/pid=/.test(String(d))) res(); }); setTimeout(res, 15000); });
  const frist = Date.now() + 60000;
  while (Date.now() < frist) { if ((koer('find', '--app', navn, '--role', 'AXTextField', '--limit', '5').matches || []).length) break; await new Promise(r => setTimeout(r, 500)); }
  return navn;
}
const feltet = (navn) => ((koer('find', '--app', navn, '--role', 'AXTextField', '--limit', '5').matches || [])[0] || {}).name || '';

try {
  const navn = await start({});
  // 1. Fem gange i træk: hver tekst skal stå i feltet bagefter.
  let alle = true, sidst = null;
  for (let i = 0; i < 5; i++) {
    const t = `ankom${i}-` + Math.random().toString(36).slice(2, 6);
    sidst = koer('type', '--app', navn, '--text', t);
    if (!(sidst.ok && sidst.verified === true && feltet(navn).includes(t))) { alle = false; break; }
  }
  check('1 tekst til et program der ikke er forrest når frem, fem gange i træk', alle, JSON.stringify(sidst).slice(0, 180));
  check('1b ...gennem tilgængeligheds-laget, uden at tage skærmen', sidst?.method === 'accessibility' && sidst?.took_screen === false, JSON.stringify(sidst).slice(0, 180));

  // 2. Den gamle vej kan stadig vælges, og den siger ærligt, at den ikke er efterprøvet.
  const r2 = koer('type', '--app', navn, '--keystrokes', '--text', 'x');
  check('2 --keystrokes sender tastetryk og siger «ikke efterprøvet»', r2.ok && r2.method === 'keystrokes' && r2.verified === false, JSON.stringify(r2).slice(0, 160));

  // 3. Et kodeordsfelt med fokus får INTET - hverken gennem tilgængeligheds-laget
  //    eller som tastetryk. Før 29/9 faldt `type` tilbage til tastetryk og tastede
  //    i feltet; kun `set_value` sagde nej (panelet 29/9).
  const nej = (r) => r.ok === false && r.code === 'secure-field' && !r.typed;
  const sikker = await start({ CMCP_PROEVE_SIKKER: '1' });
  const r3 = koer('type', '--app', sikker, '--text', 'hemmelig123');
  check('3 et kodeordsfelt får ingen tekst, heller ikke som tastetryk', nej(r3), JSON.stringify(r3).slice(0, 160));
  const r3k = koer('type', '--app', sikker, '--keystrokes', '--text', 'hemmelig123');
  check('3k ...heller ikke når tastetryk vælges direkte', nej(r3k), JSON.stringify(r3k).slice(0, 160));
  // 3b. Et kodeordsfelt som på en webside (AXTextField med undertypen AXSecureTextField).
  //     macOS beskytter ikke dette; kun vores egen vagt gør.
  const web = await start({ CMCP_PROEVE_SIKKER: 'web' });
  const r3b = koer('type', '--app', web, '--text', 'hemmelig456');
  check('3b et kodeordsfelt som på en webside får heller ingen tekst', nej(r3b), JSON.stringify(r3b).slice(0, 160));
  // 3s (runde 3 30/9, Fable R3): set_value er den tredje skrivevej - samme regel.
  // Et native kodeordsfelt har ROLLEN AXTextField og UNDERROLLEN AXSecureTextField (CI 30/9: --role fandt intet).
  const r3s = koer('set-value', '--app', sikker, '--subrole', 'AXSecureTextField', '--text', 'hemmelig789');
  check('3s set_value i et kodeordsfelt: afvist', r3s.ok === false && r3s.code === 'secure-field', JSON.stringify(r3s).slice(0, 160));
  const r3sw = koer('set-value', '--app', web, '--subrole', 'AXSecureTextField', '--text', 'hemmelig789');
  check('3sw ...ogsaa som paa en webside', r3sw.ok === false && r3sw.code === 'secure-field', JSON.stringify(r3sw).slice(0, 160));
  // 3c. Fokus flytter ind i et kodeordsfelt MIDT i teksten (Tab i «bruger\tkode»,
  //     et klik, et felt der selv hopper videre): skrivningen stopper dér.
  const skift = await start({ CMCP_PROEVE_SIKKER_SKIFT: '1' });
  const fiks = boern[boern.length - 1];
  const r3c = await new Promise((res) => {
    const p = spawn(HJAELPER, ['type', '--app', skift, '--keystrokes', '--cps', '5', '--text', 'a'.repeat(40)]);
    let ud = ''; p.stdout.on('data', (d) => { ud += d; });
    p.on('close', () => { try { res(JSON.parse(ud)); } catch { res({ ok: false, error: ud.slice(0, 200) }); } });
    // ⛔ RETTET 5/10: ventede FOER paa en fast 2,5 s, som racede mod opstarts-
    //    forsinkelsen paa en travl maskine (maalt: typed=0, did:[] - signalet naaede
    //    feltet foer det foerste tegn gjorde). Fixturens egen kommentar siger
    //    praecis hvornaar: «naar skrivningen er i gang» - saa vent paa BEVIS
    //    (feltet er ikke tomt), ikke paa en gaettet tid. Naar skrivningen aldrig
    //    starter, udloeber dette efter 6 s og proeven dumper som foer - en aegte
    //    regression skjules ikke.
    (async () => {
      const frist = Date.now() + 6000;
      while (Date.now() < frist && !feltet(skift)) await new Promise((r) => setTimeout(r, 50));
      fiks.kill('SIGUSR1');
    })();
  });
  check('3c fokus der flytter ind i et kodeordsfelt undervejs stopper skrivningen dér',
        r3c.ok === false && r3c.code === 'secure-field' && r3c.typed > 0 && r3c.typed < 40, JSON.stringify(r3c).slice(0, 180));

  // 4. Sende-portens aflaesning (runde 1 30/9, Fable P4): modtageren er navnet OVER
  //    feltet i samme kolonne - aldrig sidebarens oeverste navn. Og teksten er feltets.
  const sam = await start({ CMCP_PROEVE_SAMTALE: '1' });
  const s4 = koer('samtale', '--app', sam);
  check('4 samtalen: modtageren er navnet over feltet, ikke sidebarens',
        (s4.headings || [])[0] === 'Bob Samtale' && !(s4.headings || []).includes('Alice Sidebar') && s4.column === true, JSON.stringify(s4).slice(0, 200));
  check('4b ...og teksten er feltets', s4.field?.value === 'hej Bob', JSON.stringify(s4.field || {}));

  // 5. macOS' eget adgangskodesignal (Secure Event Input, R23 - Opus): en browser
  //    taender det for et kodeordsfelt, ogsaa naar tilgaengeligheds-laget kun ser en
  //    beholder (AXWebArea). Er det taendt, skrives der INTET - heller ikke i et
  //    almindeligt felt. Signalet er kun et ekstra NEJ, aldrig et ja.
  const sei = await start({ CMCP_PROEVE_SEI: '1' });
  const seiProces = boern[boern.length - 1];
  const r5 = koer('type', '--app', sei, '--text', 'hemmelig-sei');
  check('5 macOS-adgangskodesignalet taendt: ingen tekst, heller ikke i et almindeligt felt', nej(r5) && !feltet(sei).includes('hemmelig'), JSON.stringify(r5).slice(0, 160));
  const r5k = koer('type', '--app', sei, '--keystrokes', '--text', 'hemmelig-sei');
  check('5k ...heller ikke som tastetryk', nej(r5k) && !feltet(sei).includes('hemmelig'), JSON.stringify(r5k).slice(0, 160));
  try { seiProces.kill(); } catch {}   // signalet slukkes med processen - straks

  // 7. En soegning der loeb toer for tid (R23, Astra): `find` svarede {count: 0} som for
  //    et tomt trae, og et enkelt fund blev skrevet i, selv om et andet, ens felt ikke var
  //    set. Nu siger `find` det, og set_value vaelger intet af sig selv efter tidsudloeb.
  const tid = await start({ CMCP_PROEVE_VAELGER: '1' });
  const nul = (...a) => { try { return JSON.parse(execFileSync(HJAELPER, a, { encoding: 'utf8', timeout: 60000, env: { ...process.env, CMCP_BUDGET_SEK: '0' } })); }
                          catch (e) { try { return JSON.parse(String(e.stdout)); } catch { return { ok: false, error: String(e.stdout || e.message).slice(0, 200) }; } } };
  const r7 = nul('set-value', '--app', tid, '--role', 'AXTextField', '--text', 'tidsudloeb');
  check('7 set_value efter en soegning der loeb toer for tid: intet skrives, og svaret siger hvorfor',
    r7.ok === false && r7.code === 'search-incomplete' && r7.stopped_early === true && !feltet(tid).includes('tidsudloeb'), JSON.stringify(r7).slice(0, 180));
  const f7 = nul('find', '--app', tid, '--role', 'AXTextField');
  check('7b find siger at svaret er ufuldstaendigt (stopped_early) i stedet for at ligne et tomt program', f7.ok === true && f7.stopped_early === true, JSON.stringify(f7).slice(0, 180));
} finally {
  for (const b of boern) { try { b.kill(); } catch {} }
  rmSync(ARB, { recursive: true, force: true });
}
// 6. Afgoerelsen for sig (Skrivevagt.swift kompileret alene) og bundet til begge skriveveje.
{
  const { readFileSync, writeFileSync } = await import('node:fs');
  const KILDE = join(ROOT, 'helper', 'Sources', 'cmcp-helper');
  const A6 = mkdtempSync(join(tmpdir(), 'cmcp-skrivevagt-'));
  writeFileSync(join(A6, 'main.swift'), `import Foundation
let tilf: [(Bool?, Bool)] = [(false, false), (true, false), (nil, false), (false, true), (true, true), (nil, true)]
print(tilf.map { t -> String in switch skriveDom(fokusSikkert: t.0, sikkerIndtastning: t.1) { case .maa: return "maa"; case .ukendtFokus: return "ukendt"; case .sikkertFelt: return "sikker" } }.joined(separator: ","))
`);
  execFileSync('swiftc', ['-O', join(KILDE, 'Skrivevagt.swift'), join(A6, 'main.swift'), '-o', join(A6, 'v')], { stdio: 'pipe', timeout: 300000 });
  const dom = execFileSync(join(A6, 'v'), { encoding: 'utf8' }).trim();
  rmSync(A6, { recursive: true, force: true });
  check('6a afgoerelsen: kun et kendt, almindeligt felt uden adgangskodesignal maa skrives i; signalet er et nej, aldrig et ja',
    dom === 'maa,sikker,ukendt,sikker,sikker,sikker', dom);
  const m = readFileSync(join(KILDE, 'main.swift'), 'utf8');
  const typeKrop = m.slice(m.indexOf('let skrivPid = modtager(args)'), m.indexOf('if ukendtFokus {'));
  check('6b type: signalet doemmes FOER tilgaengeligheds-vejen, og hvert tegn gaar gennem skriveDom',
    typeKrop.indexOf('sikkerIndtastning: macosSikkerIndtastning()) == .sikkertFelt') > 0
    && typeKrop.indexOf('sikkerIndtastning: macosSikkerIndtastning()) == .sikkertFelt') < typeKrop.indexOf('AX.indsaetIFokus(')
    && /switch skriveDom\(fokusSikkert: AX\.fokusErSikkert\(pid: skrivPid\), sikkerIndtastning: macosSikkerIndtastning\(\)\) \{\n\s+case \.maa: return false\n\s+case \.ukendtFokus: ukendtFokus = true; return true\n\s+case \.sikkertFelt: ramteSikkert = true; return true/.test(typeKrop), typeKrop.slice(0, 120));
  const pasteKrop = m.slice(m.indexOf('case "paste":'), m.indexOf('case "window-set":'));
  check('6c paste (R23, Astra): det forreste felt doemmes af samme skriveDom FOER Cmd+V - ukendt og kodeord afvises',
    /switch skriveDom\(fokusSikkert: AX\.fokusErSikkert\(pid: NSWorkspace\.shared\.frontmostApplication\?\.processIdentifier\),\n\s+sikkerIndtastning: macosSikkerIndtastning\(\)\) \{\n\s+case \.maa: break\n\s+case \.ukendtFokus:\n\s+Out\.fail\([^\n]*code: "focus-unknown"\)\n\s+case \.sikkertFelt:\n\s+Out\.fail\([^\n]*code: "secure-field"\)/.test(pasteKrop)
    && pasteKrop.indexOf('switch skriveDom(') < pasteKrop.indexOf('AX.pasteText('), pasteKrop.slice(0, 160));
  const vaelg = m.slice(m.indexOf('func vaelgTraef('), m.indexOf('return first', m.indexOf('func vaelgTraef(')));
  check('7c vaelgTraef: efter tidsudloeb vaelges intet uden et udtrykkeligt index - foer alt andet',
    /func vaelgTraef\([^\n]*\n(\s+\/\/[^\n]*\n)*\s+if AX\.stoppedeTidligt && args\.int\("index"\) == nil \{\n\s+Out\.fail\([^\n]*\n\s+code: "search-incomplete"/.test(vaelg), vaelg.slice(0, 200));
  check('7d find-svaret baerer stopped_early, naar soegningen loeb toer for tid',
    /if AX\.stoppedeTidligt \{\n\s+fundSvar\["stopped_early"\] = true/.test(m) && /Out\.ok\(fundSvar\)/.test(m));
  check('6d signalet er macOS\' eget (IsSecureEventInputEnabled)', /func macosSikkerIndtastning\(\) -> Bool \{ IsSecureEventInputEnabled\(\) \}/.test(readFileSync(join(KILDE, 'Input.swift'), 'utf8')));
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
