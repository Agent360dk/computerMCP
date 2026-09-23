// De LARMENDE veje: bevist paa vores egen attrap, eller skrevet ned som umaalt.
//
// ⛔ HVORFOR DEN FINDES (23/9-2026)
//    Et daekningskort over de 28 vaerktoejer viste at otte af dem KUN er
//    bevist som en AFVISNING: `quit`, `drag`, `space`, `paste`, `window`,
//    `ask_user`, `move`, `activate` staar i `TAGER_SKAERMEN` og skjules i
//    baggrundstilstand. E2E-forloebet proever at de ikke tilbydes - og
//    stopper der. Ingen af dem er nogensinde set VIRKE.
//
//    «Bevist at den siger nej» er ikke «bevist at den virker». Kriteriet er
//    at hver vej gennem produktet er gaaet paa en maskine eller et vindue der
//    ikke er menneskets.
//
//    To af de otte KAN proeves her, fordi de rammer ét navngivet program og
//    ikke den globale haendelsesstroem: `computer_window` og `computer_quit`.
//    Maalet er vores egen attrap-app: et vindue uden ramme, med alpha 0, i
//    (-20000,-20000). De seks andre staar nederst som UMAALT med praecis
//    begrundelse - ikke pakket ind.
//
// ⛔ OG DEN MAALER ET AABENT SPOERGSMAAL: tager en AX-vinduesflytning fokus?
//    `computer_focused` laeses FOER og EFTER. Svaret er et faktum om macOS,
//    ikke en vurdering - og det afgoer om `computer_window` er fejlklassificeret.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.env.CMCP_STATUS_IKON = '0';
const fails = [], noter = [];

// ⛔ SELV-VAGT. Denne fil er den ENESTE i suiten der saetter CMCP_BACKGROUND=0,
//    altsaa «maa tage skaermen». Det er kun forsvarligt saa laenge hvert kald
//    peger paa vores egen attrap. En dag tilfoejer nogen et kald uden `app`,
//    eller et af de seks der ikke KAN rettes mod et program - og saa staar der
//    et vindue paa menneskets skaerm, fundet af ham og ikke af proeven.
//
//    Vagten laeser filens egen kilde. Den kan ikke glemmes.
{
  const egen = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8');
  // ⛔ MAALT 23/9: foerste udgave af DENNE vagt kunne ikke fejle. To grunde,
  //    og den ene er husets egen dokumenterede faelde:
  //      1. markoer-strengen stod TO steder - her i opslaget og nede i filen -
  //         saa `split(...)[1]` gav de femten linjer MELLEM dem: vagten laeste
  //         sig selv, ikke proeven. Derfor bygges ordet nu af stumper, og vi
  //         tager det SIDSTE stykke.
  //      2. jeg «mutationsbeviste» den med en perl-erstatning der aldrig
  //         matchede. En mutation der ikke blev anvendt, ligner en vagt der
  //         holder. Mutationen skal ses AENDRE filen, foer det roede tal taeller.
  const MARKOER = '// ---- SELV-VAGT' + ' SLUT ----';
  const dele = egen.split(MARKOER);
  const kode = dele[dele.length - 1];
  // ⛔ Et laengde-krav var IKKE nok: da jeg gendannede den blinde form, fyldte
  //    vagtens egen kommentar mere end graensen, og vagten bestod sin egen
  //    omgaaelse. Den skal bevise at den ser PROEVENS KROP - derfor et anker
  //    der kun findes dernede. Ankeret bygges af stumper, ellers staar det
  //    ogsaa heroppe, og saa er vi tilbage hvor vi startede.
  const ANKER = '6a computer_' + 'quit afsluttede';
  if (!kode.includes(ANKER)) {
    console.log('DUMP 0 selv-vagt: laeser ikke proevens krop - vagten ville vaere blind');
    process.exit(1);
  }
  const forbudte = ['computer_move', 'computer_drag', 'computer_activate', 'computer_space', 'computer_paste']
    .filter(t => new RegExp("kald\\(\\s*'" + t + "'").test(kode));
  if (forbudte.length) {
    console.log('DUMP 0 selv-vagt: filen kalder skaermtagende vaerktoejer - ' + forbudte.join(', '));
    process.exit(1);
  }
  const udenApp = [...kode.matchAll(/kald\('computer_(window|quit|type|click|key|press|set_value)'[^)]*\)/g)]
    .filter(m => !/app:/.test(m[0])).map(m => m[0].slice(0, 40));
  if (udenApp.length) {
    console.log('DUMP 0 selv-vagt: skrivende kald uden `app` - ' + udenApp.join(' | '));
    process.exit(1);
  }
  console.log('OK   0 selv-vagt: hvert skrivende kald peger paa vores egen attrap');
}
// ---- SELV-VAGT SLUT ----
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

// --- attrappen: en RIGTIG .app med bundle-ID, vindue uden for skaermen
const STATE = mkdtempSync(join(tmpdir(), 'cmcp-larm-'));
const ARB = mkdtempSync(join(tmpdir(), 'cmcp-larm-bin-'));
const NAVN = 'cmcplarm' + Math.random().toString(36).slice(2, 7);
const BID = 'dk.agent360.cmcp.' + NAVN;
const PAKKE = join(ARB, NAVN + '.app');
mkdirSync(join(PAKKE, 'Contents', 'MacOS'), { recursive: true });
writeFileSync(join(PAKKE, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${BID}</string>
<key>CFBundleName</key><string>${NAVN}</string>
<key>CFBundleExecutable</key><string>${NAVN}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>`);
execFileSync('swiftc', ['-O', join(ROOT, 'test/fixture/proevemaal.swift'),
                        '-o', join(PAKKE, 'Contents', 'MacOS', NAVN)], { stdio: 'pipe' });
const attrap = spawn(join(PAKKE, 'Contents', 'MacOS', NAVN), { stdio: ['ignore', 'pipe', 'ignore'] });
await new Promise(r => { attrap.stdout.on('data', b => /pid=/.test(String(b)) && r()); setTimeout(r, 8000); });
await new Promise(r => setTimeout(r, 2000));

// ⛔ CMCP_BACKGROUND=0 er det der goer de larmende veje NAAELIGE. Hvert eneste
//    kald herunder baerer `app: BID` - attrappen. Et kald uden maal ville
//    kunne ramme mennesket; derfor findes der ingen her.
const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
  env: { ...process.env, CMCP_STATE_DIR: STATE, CMCP_BACKGROUND: '0',
         CMCP_OSASCRIPT: lavFalskSpoerger('ja', 'cmcp-larm').sti },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
const kald = async (navn, args = {}) => {
  const r = await rpc('tools/call', { name: navn, arguments: args });
  return { tekst: r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? {}), fejl: !!r.result?.isError };
};
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'larm', version: '1' } });
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const ramme = async () => {
  const v = await kald('computer_windows', { app: BID });
  try { return JSON.parse(v.tekst).windows?.[0] ?? null; } catch { return null; }
};

// 1. KALIBRERING: vinduet findes, og det ligger uden for HVER skaerm.
//
// ⛔ Foerste udgave af denne linje kraevede `y < -1000`. Den var roed paa et
//    vindue der laa helt rigtigt: AX regner y fra skaermens overkant og nedad,
//    saa attrappens y var +20987, ikke -20000. Et gaettet fortegn er ikke en
//    maaling - vi spoerger skaermene i stedet.
const skaerme = JSON.parse((await kald('computer_displays')).tekst).displays;
// ⛔ MIN EGEN FEJL, FUNDET AF EN RAADGIVER 23/9 - og den var committet.
//    Produktet bruger TO ordforraad: en SKAERM har `width`/`height`, en
//    vindues-RAMME har `w`/`h`. Jeg skrev `f.width` for rammen. Det giver
//    `undefined`, hver sammenligning bliver `NaN`, og `NaN < x` er falsk -
//    saa funktionen svarede «roerer ingen skaerm» om ETHVERT vindue,
//    ogsaa et midt paa skaermen. Tjek 1 kunne ikke fejle.
//    MAALT: {x:100,y:100,w:300,h:120} mod {x:0,y:0,width:1920,height:1080}
//    gav false. Den skulle give true.
//
//    Derfor kalibreres funktionen nu BEGGE veje lige nedenfor. En
//    geometri-funktion der kun proeves paa noget der ligger udenfor,
//    er ikke proevet.
const paaEnSkaerm = (f) => skaerme.some(d =>
  f.x < d.x + d.width && f.x + f.w > d.x && f.y < d.y + d.height && f.y + f.h > d.y);

{
  const hoved = skaerme.find(d => d.main) || skaerme[0];
  const midtPaa = { x: hoved.x + 40, y: hoved.y + 40, w: 200, h: 100 };
  const langtVaek = { x: -90000, y: -90000, w: 200, h: 100 };
  check('1a kalibrering: et vindue MIDT paa skaermen ses som paa skaermen',
        paaEnSkaerm(midtPaa) === true, JSON.stringify(midtPaa));
  check('1b kalibrering: et vindue langt udenfor ses som udenfor',
        paaEnSkaerm(langtVaek) === false, JSON.stringify(langtVaek));
}
const foer = await ramme();
check('1c attrappens vindue findes og roerer INGEN skaerm',
      !!foer && !paaEnSkaerm(foer.frame),
      `${JSON.stringify(foer?.frame)} mod ${skaerme.length} skaerm(e)`);

// 2. Hvem har fokus FOER? Det er referencen for proeve 4.
const fokusFoer = (await kald('computer_focused')).tekst;

// 3. computer_window FLYTTER faktisk et vindue - ikke kun «afvist i baggrund».
const flyt = await kald('computer_window', { app: BID, x: -19000, y: -19500, width: 420, height: 320 });
await new Promise(r => setTimeout(r, 400));
const efter = await ramme();
check('3a computer_window FLYTTEDE faktisk vinduet', !!efter &&
      efter.frame.x === -19000 && efter.frame.y === -19500,
      `${JSON.stringify(efter?.frame)} · ${flyt.tekst.replace(/\s+/g, ' ').slice(0, 70)}`);
// ⛔ FALSIFICERET PAA DENNE ATTRAP, ikke i produktet: et `.borderless`-vindue
//    har hverken AXSize eller en lukkeknap, saa `resize` svarer -25200
//    (attributten findes ikke) og `button=close` svarer «no close button».
//    Attrappen ER borderless med vilje: maalt 22/9 klemmer macOS et vindue
//    MED titellinje ind paa menneskets skaerm, uanset hvor man beder om det.
//    De to veje kraever derfor en maskine der ikke er hans. Skrevet ned, ikke
//    pakket ind - og prisen staar i UMAALT-listen nederst.
const kanRes = !/-25200|could not resize/.test(flyt.tekst);
check('3b resize: attrappen kan ikke baere proeven (borderless har ingen AXSize)',
      !kanRes, kanRes ? 'uventet: den kunne resize - stram proeven' : 'falsificeret her, ikke i produktet');

// 4. ⛔ DET AABNE SPOERGSMAAL: tog flytningen fokus fra det program mennesket
//    sad i? Svaret gaar i rapporten uanset hvad - det er en MAALING, ikke en
//    paastand, og det afgoer om `computer_window` hoerer hjemme i TAGER_SKAERMEN.
const fokusEfter = (await kald('computer_focused')).tekst;
// ⛔ FOERSTE UDGAVE VAR BLIND, og en raadgiver fandt det foer jeg gjorde:
//    den sammenlignede `computer_focused` foer og efter. Det felt beskriver
//    det element mennesket staar i. Skifter HAN felt imens, bliver tjekket
//    roedt uden at produktet har gjort noget - og da flytningen fejlede,
//    var det groent uden at produktet havde gjort noget. Et instrument der
//    ikke kan tilskrive aarsagen, maaler ingenting.
//
//    Spoergsmaalet er ikke «skiftede forgrunden» men «kom ATTRAPPEN frem».
//    Det kan kun vores eget kald have foraarsaget.
const framme = (t) => t.includes(BID);
check('4 flytningen hentede IKKE attrappen frem i forgrunden',
      !framme(fokusEfter) && !framme(fokusFoer),
      framme(fokusEfter) ? 'attrappen blev forgrundsprogram' : 'attrappen var og blev i baggrunden');
noter.push('MAALT (kalibreret ÉN vej): en AX-vinduesflytning hentede ikke programmet frem.\n'
  + '  Den anden vej - at instrumentet VILLE se en aktivering - kan ikke proeves her:\n'
  + '  mutationen er at indsaette `activate()`, og den tager menneskets skaerm.\n'
  + '  Den maaling kraever en anden login-session. Umaalt, ikke groent.');

// 5. window button=close lukker vinduet - stadig paa vores egen attrap.
const luk = await kald('computer_window', { app: BID, button: 'close' });
await new Promise(r => setTimeout(r, 600));
const vinduer = await kald('computer_windows', { app: BID });
let antal = -1; try { antal = JSON.parse(vinduer.tekst).windows.length; } catch {}
check('5 close: attrappen kan ikke baere proeven (borderless har ingen lukkeknap)',
      /no close but/.test(luk.tekst), `${antal} vinduer tilbage · ${luk.tekst.replace(/\s+/g, ' ').slice(0, 60)}`);

// 10. ⛔ «It does not pretend» - READMEens egne ord - skal ogsaa gaelde naar
//     kaldet ikke kunne udfoeres. MAALT 23/9 FOER rettelsen:
//       window-set --app <x>            -> {"did":[],"ok":true,"result":"sat"}
//       computer_window {app, x: 100.5} -> samme: intet flyttede sig, svaret sagde sat
//     Et no-op meldt som «gjort» er vaerre end en fejl: ingen gaar og leder.
//
//     ⛔ AERLIGT OM DAEKNINGEN: baade serveren og hjaelperen afviser nu et
//     no-op. Proeven kan derfor IKKE skelne de to lag: slaar man serverens
//     vagt fra, bliver 10a stadig groen, fordi hjaelperen tager den.
//     10b diskriminerer (kun serveren kender heltals-kravet, maalt: M15 roed).
//     10a beviser ADFAERDEN, ikke hvilket lag der baerer den. Sagt her, saa
//     ingen senere laeser den som et bevis for serverens vagt.
const foerNoop = await ramme();
const noop = await kald('computer_window', { app: BID });
check('10a et kald uden geometri afvises - ikke meldt som «sat»',
      noop.fejl && /nothing to change/i.test(noop.tekst), noop.tekst.replace(/\s+/g, ' ').slice(0, 70));
const skaev = await kald('computer_window', { app: BID, x: 100.5 });
await new Promise(r => setTimeout(r, 300));
const efterSkaev = await ramme();
check('10b et koordinat der ikke er et heltal afvises',
      skaev.fejl && /whole numbers/i.test(skaev.tekst), skaev.tekst.replace(/\s+/g, ' ').slice(0, 70));
check('10c ...og vinduet stod stille imens',
      JSON.stringify(efterSkaev?.frame) === JSON.stringify(foerNoop?.frame),
      `${JSON.stringify(foerNoop?.frame)} -> ${JSON.stringify(efterSkaev?.frame)}`);

// 6. computer_quit afslutter programmet - og draeber ikke processen.
const doedFoer = attrap.exitCode !== null;
const q = await kald('computer_quit', { app: BID });
await new Promise(r => setTimeout(r, 1500));
check('6a computer_quit afsluttede attrappen', !q.fejl && attrap.exitCode !== null,
      `exitCode=${attrap.exitCode} · ${q.tekst.slice(0, 50)}`);
check('6b ...og den var i live foer kaldet', doedFoer === false);

// 7. Revisionssporet skal baere de tre skrivninger. En handling uden spor er
//    ikke en handling produktet maa udfoere.
const log = await kald('computer_audit', { limit: 40 });
if (process.env.CMCP_VIS_LOG === '1')
  for (const l of log.tekst.split('\n')) if (/computer_(window|quit)/.test(l)) console.log('  LOG ' + l.trim().slice(0, 260));
for (const navn of ['computer_window', 'computer_quit'])
  check(`7 revisionsloggen baerer ${navn}`, log.tekst.includes(navn), '');

// 8. ⛔ Den halve skrivning skal staa i revisionssporet.
//    MAALT 23/9 FOER rettelsen: flytningen lykkedes, resize fejlede, og loggen
//    skrev {outcome:"error"} uden et ord om at vinduet havde flyttet sig.
//    Loeftet er at sporet er helt; det var det ikke.
const raa = (await import('node:fs')).readFileSync(join(STATE, 'audit.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return {}; } });
const halve = raa.filter(d => d.tool === 'computer_window' && d.outcome === 'error' && d.partial);
check('8a en halvt udfoert skrivning staar i loggen som halv - ikke som intet',
      halve.some(d => d.partial.includes('moved')),
      halve.length ? JSON.stringify(halve[0].partial) : 'ingen `partial` i nogen fejl-linje');

// 9. ⛔ FABLE (23/9): «hverken window-set, window-button eller quit baerer
//    took_screen» - og READMEen indroemmer det selv. Feltet er den ene af de
//    to ting loggen findes for at kunne svare paa: tog handlingen skaermen?
//    Tre skrivende veje svarede slet ikke paa spoergsmaalet.
//    Ogsaa paa FEJL-vejen: et halvt kald der tog skaermen, maa ikke tie.
const medSk = (t, o) => raa.filter(d => d.tool === t && d.outcome === o && typeof d.took_screen === 'boolean');
check('9a computer_quit goer skaermen op i loggen',
      medSk('computer_quit', 'ok').some(d => d.took_screen === false),
      JSON.stringify(medSk('computer_quit', 'ok').map(d => d.took_screen)));
check('9b ogsaa en FEJLET vinduesskrivning goer skaermen op',
      medSk('computer_window', 'error').length > 0,
      `${medSk('computer_window', 'error').length} af ${raa.filter(d => d.tool === 'computer_window' && d.outcome === 'error').length} fejl-linjer`);
check('9c og attrappen blev IKKE hentet frem af nogen af dem',
      [...medSk('computer_quit', 'ok'), ...medSk('computer_window', 'error')].every(d => d.took_screen === false),
      'alle siger took_screen: false');

srv.kill(); try { attrap.kill(); } catch {}
if (process.env.CMCP_VIS_LOG !== '1') rmSync(STATE, { recursive: true, force: true });
else console.log('  state beholdt: ' + STATE);
rmSync(ARB, { recursive: true, force: true });

// --- UMAALT, med begrundelse. Aldrig rapporteret som groent.
console.log('\nUMAALT paa denne maskine (mennesket sidder ved den):');
for (const [t, hvorfor] of [
  ['computer_move',     'flytter menneskets markoer - der findes ingen anden markoer'],
  ['computer_drag',     'samme: et traek ER markoeren'],
  ['computer_activate', 'haever et program til forgrunden og tager dermed fokus'],
  ['computer_space',    'skifter menneskets Space'],
  ['computer_paste',    'udklipsholderen er global - en proeve ville overskrive hans'],
  ['computer_ask_user', 'skal vise en aegte boks; maales af failclosed.mjs med CMCP_DIALOGS=1'],
  ['window resize',     'attrappen er borderless (har ingen AXSize); et vindue MED titellinje klemmer macOS ind paa hans skaerm'],
  ['window close/minim', 'samme: en lukkeknap findes kun paa en titellinje. Minimering laver desuden en genie-animation i HANS Dock'],
]) console.log(`  ${t.padEnd(20)} ${hvorfor}`);
console.log('  Alle otte kraever en maskine der ikke er hans, eller hans eksplicitte ja.');
for (const n of noter) console.log('\n' + n);

console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
