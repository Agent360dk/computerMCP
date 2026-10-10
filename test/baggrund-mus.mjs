// BAGGRUND-MUS: et klik til et program BAG et andet lander i det rigtige program,
// og porten doemmer det element, klikket faktisk rammer.
//
// ⛔ HVORFOR DEN FINDES (10/10-2026, R27)
//    Gustav: «det skal maaske tilbage paa en maade hvor det kan bruges i baggrunden,
//    altsaa mus, vision for det den selv laver». Maalt samme nat: `click --app` sendte
//    klikket til programmets koe (postToPid) og svarede ok - men det LANDEDE ikke
//    (Lommeregneren stod paa 0). Opus fandt i R27 runde 2, og Claude efterproevede 3/3,
//    at klikket lander, naar haendelsen baerer felt 51 (vinduesnummeret) og felt 58
//    (et tal forskelligt fra 0) - kun offentlige funktioner, men udokumenterede felter.
//    Og porten doemte det OEVERSTE vindue paa punktet: lander klikket bagved, ville en
//    «Slet»-knap i et daekket program blive doemt efter det harmloese vindue ovenpaa.
//
//    Proeven bruger to af vores egne usynlige proevemaal oven paa hinanden (uden for
//    skaermen, gennemsigtige) - ingen af menneskets programmer roeres.
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
const vent = (ms) => new Promise(r => setTimeout(r, ms));

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-bgmus-'));
const MAAL = join(ARB, 'bin');
execFileSync('swiftc', ['-O', join(ROOT, 'test', 'fixture', 'proevemaal.swift'), '-o', MAAL], { stdio: 'pipe', timeout: 180000 });
const boern = [];
async function start(env = {}) {
  const navn = 'cmcpbgmus' + Math.random().toString(36).slice(2, 8);
  const sti = join(ARB, navn); execFileSync('cp', [MAAL, sti]);
  const b = spawn(sti, { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...env } }); boern.push(b);
  await new Promise((res) => { b.stdout.on('data', (d) => { if (/pid=/.test(String(d))) res(); }); setTimeout(res, 15000); });
  const frist = Date.now() + 60000;
  while (Date.now() < frist) { if ((koer('find', '--app', navn, '--title', 'klik-maal', '--limit', '1').matches || []).length) break; await vent(400); }
  return navn;
}
const titel = (navn) => ((koer('find', '--app', navn, '--role', 'AXButton', '--contains', 'KLIK', '--limit', '3').matches || []).map(m => m.name).find(n => /KLIK|klik/.test(n)) || '');
const forrest = () => { try { return execFileSync('osascript', ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'], { encoding: 'utf8' }).trim(); } catch { return '?'; } };
const markoer = () => { try { return JSON.parse(execFileSync(HJAELPER, ['at', '--pointer'], { encoding: 'utf8' })).pointer || null; } catch { return null; } };

try {
  const A = await start();
  const B = await start();          // startet sidst: ligger OVEN PAA A
  const kA = (koer('find', '--app', A, '--title', 'klik-maal', '--limit', '1').matches || [])[0];
  check('0 proevemaalene kører, og A\'s klik-knap er fundet', !!kA, JSON.stringify(kA || {}).slice(0, 120));
  const { x, y } = kA.center;

  // 1. Porten: hvem ejer punktet - i maalprogrammet, ikke det oeverste vindue.
  const iA = koer('at', '--app', A, '--x', String(x), '--y', String(y));
  check('1a at --app A: elementet under punktet I A - A\'s egen knap, med vinduesnummeret',
    iA.found === true && iA.app === A && iA.title === 'klik-maal' && Number.isInteger(iA.window_number) && iA.window_number > 0, JSON.stringify(iA).slice(0, 220));
  const iB = koer('at', '--app', B, '--x', String(x), '--y', String(y));
  check('1b at --app B paa samme punkt: B\'s knap - og et ANDET vindue end A\'s',
    iB.found === true && iB.app === B && iB.window_number > 0 && iB.window_number !== iA.window_number, JSON.stringify(iB).slice(0, 220));
  const ude = koer('at', '--app', A, '--x', String(x + 5000), '--y', String(y));
  check('1c et punkt uden for A\'s vinduer: intet fundet - porten kan afvise', ude.found === false, JSON.stringify(ude).slice(0, 160));

  // 2. Leveringen: klikket lander i A, B (ovenpaa) er uroert, fokus og markoer uaendrede.
  const foerFront = forrest(), foerMus = JSON.stringify(markoer());
  const k = koer('click', '--app', A, '--x', String(x), '--y', String(y), '--window', String(iA.window_number));
  await vent(400);
  check('2a click --app A bag B: klikket LANDER i A («KLIKKET»)', k.ok === true && titel(A) === 'KLIKKET', `${JSON.stringify(k).slice(0, 140)} · A=${titel(A)}`);
  check('2b ...B (ovenpaa) blev IKKE klikket', titel(B) === 'klik-maal', `B=${titel(B)}`);
  check('2c ...forreste program og markoeren er uaendrede', forrest() === foerFront && JSON.stringify(markoer()) === foerMus, `${foerFront} → ${forrest()}`);
  // 3. Bindingen: et klik bundet til et vindue, der ikke laengere er A's paa punktet, afvises.
  const forkert = koer('click', '--app', A, '--x', String(x), '--y', String(y), '--window', String(iB.window_number));
  check('3 et klik bundet til det forkerte vindue afvises - intet sendes', forkert.ok === false && forkert.code === 'target-moved', JSON.stringify(forkert).slice(0, 160));
  // 4. Bundet til kilden (mutantporten genbygger ikke hjaelperen): felterne, bindingen og opslaget I programmet.
  const { readFileSync } = await import('node:fs');
  const K = join(ROOT, 'helper', 'Sources', 'cmcp-helper');
  const inp = readFileSync(join(K, 'Input.swift'), 'utf8'), m = readFileSync(join(K, 'main.swift'), 'utf8');
  check('4a et klik til en koe baerer felt 51 (vinduet) og 58 (≠0) - paa baade ned og op',
    /static let FELT_VINDUE = CGEventField\(rawValue: 51\)!/.test(inp) && /static let FELT_VINDUESPUNKT = CGEventField\(rawValue: 58\)!/.test(inp)
    && /if let v = vindue, tilPid != nil \{ d\?\.setIntegerValueField\(FELT_VINDUE, value: Int64\(v\)\); d\?\.setIntegerValueField\(FELT_VINDUESPUNKT, value: 1\) \}/.test(inp)
    && /if let v = vindue, tilPid != nil \{ u\?\.setIntegerValueField\(FELT_VINDUE, value: Int64\(v\)\); u\?\.setIntegerValueField\(FELT_VINDUESPUNKT, value: 1\) \}/.test(inp));
  check('4b click --app: intet vindue paa punktet → not-in-window; et andet vindue end det doemte → target-moved; ellers leveres til vinduet',
    /guard let v = Input\.vindueVedPunkt\(pid: pid, x: x, y: y\) else \{\n\s+Out\.fail\([^\n]*code: "not-in-window"\)/.test(m)
    && /if let bundet = args\.int\("window"\), bundet != v \{\n\s+Out\.fail\([^\n]*code: "target-moved"\)/.test(m)
    && /tilPid: klikPid, vindue: klikVindue\)/.test(m));
  check('4c at --app slaar op I programmet (AXUIElementCreateApplication) med reserve paa programmets eget trae',
    /let sys = appPid\.map \{ AXUIElementCreateApplication\(\$0\) \} \?\? AXUIElementCreateSystemWide\(\)/.test(m)
    && /if let pid = appPid, fejl != \.success \|\| el == nil, let m = AX\.mindsteVedPunkt\(pid: pid, x: x, y: y\) \{/.test(m));

  // 5. NETTET: et klik bagved, der alligevel aabner en menu, lukker den igen og siger det.
  //    (Porten afviser de kendte tilfaelde foer hjaelperen kaldes - bundet-maal 9a-9d. Her
  //    kaldes hjaelperen direkte, saa nettet under porten maales.) Menuen ses kort paa
  //    skaermen, saa kun naar det er sagt: CMCP_FREMMED_MASKINE=1 eller CMCP_BRUG_TAG_SKAERMEN=1.
  if (process.env.CMCP_FREMMED_MASKINE === '1' || process.env.CMCP_BRUG_TAG_SKAERMEN === '1') {
    const C = await start({ CMCP_PROEVE_MENU: '1' });
    const rul = (koer('find', '--app', C, '--role', 'AXPopUpButton', '--title', 'menu-A', '--limit', '1').matches || [])[0];
    const iC = rul && koer('at', '--app', C, '--x', String(rul.center.x), '--y', String(rul.center.y));
    const foerC = forrest();
    const svar = rul ? koer('click', '--app', C, '--x', String(rul.center.x), '--y', String(rul.center.y), '--window', String(iC.window_number)) : {};
    check('5a et klik bagved der aabner en menu: svaret siger menu_opened, menu_closed og took_screen',
      svar.ok === true && svar.menu_opened === true && svar.menu_closed === true && svar.took_screen === true, JSON.stringify(svar).slice(0, 260));
    await vent(300);
    const tael = ((koer('find', '--app', C, '--role', 'AXStaticText', '--contains', 'menu:', '--limit', '1').matches || [])[0] || {});
    const tekst = String(tael.value ?? tael.name ?? '');
    check('5b ...menuen blev lukket af os (Escape), ikke af proevemaalets noedstop efter 3 s', /aabnet 1 lukket 1 noed 0/.test(tekst), tekst);
    check('5c ...forreste program er uaendret', forrest() === foerC, `${foerC} → ${forrest()}`);
  } else {
    console.log('SPRUNGET OVER: 3 (5a-5c viser en menu paa skaermen - koer med CMCP_FREMMED_MASKINE=1) - bevist intet, ikke bestaaet');
  }
  const sk = readFileSync(join(K, 'Skaerm.swift'), 'utf8');
  check('5d klik til en koe: menuerne maales foer, og en ny menu lukkes med Escape (tast 53) i programmets koe',
    /let menuerFoer = klikPid\.map \{ Skaerm\.menuer\(\$0\) \} \?\? \[\]/.test(m)
    && /if let pid = klikPid, let menu = Skaerm\.lukNyMenu\(pid: pid, foer: menuerFoer\) \{/.test(m)
    && /CGEvent\(keyboardEventSource: nil, virtualKey: 53, keyDown: ned\)\?\.postToPid\(pid\)/.test(sk));
} finally {
  for (const b of boern) { try { b.kill(); } catch {} }
  rmSync(ARB, { recursive: true, force: true });
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
