// E2E-FORLOEBET: ét forloeb, én frisk server, som en agent ville bruge den.
//
// ⛔ HVORFOR DEN FINDES (22/9-2026)
//    Alle suiterne var groenne. Saa blev produktet brugt gennem HELE kaeden -
//    MCP-kald -> port -> hjaelper -> program - og 12 af 20 bestod. Hver eneste
//    skrivning til et program blev afvist.
//
//    To fejl, og ingen suite kunne se dem:
//     1. Porten slog programmer op i én liste (kun almindelige), leveringen i
//        en anden (alle). Et baggrundsprogram var usynligt for porten og
//        naaeligt for leveringen. Suiterne kalder hjaelperen DIREKTE, uden om
//        porten.
//     2. vendor-binaeren var ikke bygget om efter `--all` kom til, og en gammel
//        binaer ignorerer ukendte flag i STILHED. Samme fejlklasse som 21/9.
//
//    Laesende paa menneskets RIGTIGE programmer. Skrivende KUN paa en attrap
//    (en rigtig .app med bundle-ID, vindue uden for skaermen). Kaldet mod det
//    program mennesket sidder i sigter paa noget der ikke findes, saa en
//    fejlet port roerer intet.
// E2E: ét forløb, én frisk server med dagens kode, som en agent ville bruge den.
// Laesende paa menneskets RIGTIGE programmer. Skrivende KUN paa attrappen.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⛔ 23/9: slukkeren stod i tre proevefiler, men ikke i denne. Koert alene
//    startede e2e derfor det RIGTIGE ikon i menneskets menulinje - og ventede
//    et minut paa et svar ingen kunne se.
process.env.CMCP_STATUS_IKON = '0';
const STATE = mkdtempSync(join(tmpdir(), 'cmcp-e2e-'));
const ARB = mkdtempSync(join(tmpdir(), 'cmcp-e2e-bin-'));
// ⛔ En RIGTIG .app-pakke, ikke en bar binaer. Maalt 22/9: en bar binaer
//    registreres slet ikke af macOS som et program med identitet - den stod
//    ikke i `apps --all` (58 programmer, 1 uden bundle-ID, og det var ikke
//    den). Porten kunne derfor ikke opsloe den, og fail-closed afviste hver
//    skrivning. Rigtige programmer har altid en pakke og et bundle-ID.
const NAVN = 'cmcpe2e' + Math.random().toString(36).slice(2, 7);
const BID = 'dk.agent360.cmcp.' + NAVN;
const PAKKE = join(ARB, NAVN + '.app');
const { mkdirSync, writeFileSync } = await import('node:fs');
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
execFileSync('swiftc', ['-O', join(ROOT, 'test/fixture/proevemaal.swift'), '-o', join(PAKKE, 'Contents', 'MacOS', NAVN)], { stdio: 'pipe' });
const attrap = spawn(join(PAKKE, 'Contents', 'MacOS', NAVN), { stdio: ['ignore', 'pipe', 'ignore'] });
await new Promise(r => { attrap.stdout.on('data', b => /pid=/.test(String(b)) && r()); setTimeout(r, 8000); });
await new Promise(r => setTimeout(r, 2500));

const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')],
  // Attrap-spoerger (husets vagt 26): ingen proeve maa kunne rejse en aegte
  // macOS-dialog paa menneskets skaerm.
  { env: { ...process.env, CMCP_STATE_DIR: STATE, CMCP_OSASCRIPT: lavFalskSpoerger('udloeb', 'cmcp-e2e').sti },
    stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
const kald = async (navn, args = {}) => {
  const r = await rpc('tools/call', { name: navn, arguments: args });
  return { tekst: r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? {}), fejl: !!r.result?.isError };
};
const res = [];
const trin = (gruppe, hvad, ok, bevis) => res.push({ gruppe, hvad, ok, bevis: String(bevis).replace(/\s+/g, ' ').slice(0, 78) });

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

// --- 1. OPSTART
const liste = (await rpc('tools/list')).result?.tools?.map(t => t.name) || [];
trin('opstart', 'serveren tilbyder vaerktoejer', liste.length > 0, `${liste.length} vaerktoejer`);
const perm = await kald('computer_permissions');
trin('opstart', 'baggrund er slaaet til', /"background": true/.test(perm.tekst), perm.tekst.match(/"background": \w+/)?.[0]);

// --- 2. OEJNENE paa rigtige programmer
for (const app of ['com.agent360.ide', 'com.apple.finder', 'com.google.Chrome']) {
  const r = await kald('computer_inspect', { app });
  const m = r.tekst.match(/(\d+) elements with text, out of (\d+)/);
  trin('oejne', `inspect ${app.split('.').pop()} som tekst`, !!m && !r.fejl, m ? `${m[1]} med tekst af ${m[2]} · ${r.tekst.length} tegn` : r.tekst);
}
const vind = await kald('computer_windows');
trin('oejne', 'windows lister vinduer', /"count"/.test(vind.tekst), vind.tekst.match(/"count": \d+/)?.[0]);
const fok = await kald('computer_focused');
trin('oejne', 'focused svarer sandt - et program ELLER «intet har fokus»',
     /"app"/.test(fok.tekst) || /"focused":\s*false/.test(fok.tekst),
     (fok.tekst.match(/"app":\s*"[^"]+"/)?.[0]) ?? 'intet har fokus lige nu - aerligt svar');
const fnd = await kald('computer_find', { app: BID, role: 'AXButton', limit: 5 });
trin('oejne', 'find giver ramme og pressable', /"pressable"/.test(fnd.tekst), fnd.tekst.match(/"count": \d+/)?.[0]);

// --- 3. HAENDERNE paa attrappen (uden for skaermen)
const skriv = await kald('computer_type', { text: 'e2e-tekst', app: BID });
trin('haender', 'type --app lander stille', /pointer stayed/.test(skriv.tekst), skriv.tekst);
const laes = await kald('computer_inspect', { app: BID });
trin('haender', '...og teksten ankom', /e2e-tekst/.test(laes.tekst), laes.tekst.match(/TextField: [^\n]*/)?.[0] ?? 'ikke fundet');
const sv = await kald('computer_set_value', { app: BID, role: 'AXTextField', value: 'sat-via-e2e' });
trin('haender', 'set_value bekraeftes', !sv.fejl && /verified.*true|"set": true/.test(sv.tekst), sv.tekst);
const svR = await kald('computer_set_value', { app: BID, role: 'AXPopUpButton', value: 'rulle-B' });
trin('haender', 'set_value paa rullemenu paastaar IKKE succes', svR.fejl && /set-ignored|did not change/.test(svR.tekst), svR.tekst);
const pr = await kald('computer_press', { app: BID, title: 'ikke-trykket' });
trin('haender', 'press trykker knappen', !pr.fejl, pr.tekst);
const efter = await kald('computer_inspect', { app: BID });
trin('haender', '...og knappen ER trykket', /TRYKKET/.test(efter.tekst), efter.tekst.match(/Button: TRYK[^\n]*/)?.[0] ?? 'ikke trykket');

// --- 3b. RESTEN AF OEJNENE - de laesende der aldrig var koert gennem kaeden
const disp = await kald('computer_displays');
trin('oejne+', 'displays lister skaermene', /"displays"/.test(disp.tekst) && !disp.fejl, disp.tekst.match(/"count":\s*\d+/)?.[0]);
const menus = await kald('computer_menus', { app: 'com.apple.finder' });
trin('oejne+', 'menus laeser et programs menulinje', !menus.fejl && menus.tekst.length > 200, `${menus.tekst.length} tegn`);
const pend = await kald('computer_pending');
trin('oejne+', 'pending svarer', !pend.fejl, pend.tekst.slice(0, 60));
const vent = await kald('computer_wait_for', { app: BID, role: 'AXButton', title: 'orden-2', timeout: 3 });
trin('oejne+', 'wait_for finder et element der er der', !vent.fejl && /orden-2|found|"ok":\s*true/i.test(vent.tekst), vent.tekst.slice(0, 70));
// Skaermbillede: laeser, tager ikke skaermen. Lav bredde, saa intet kan laeses.
const shot = await rpc('tools/call', { name: 'computer_screenshot', arguments: { maxWidth: 200 } });
const billede = (shot.result?.content || []).some(c => c.type === 'image');
trin('oejne+', 'screenshot giver et billede, sloeret', billede, (shot.result?.content || []).find(c => c.type === 'text')?.text?.match(/Redacted \(\d+ regions?\)/)?.[0] ?? 'intet svar');

// --- 3c. KLIK ad den stille kanal - det store umaalte.
//     En knap der skifter titel naar den trykkes. Klik paa dens midte, --app,
//     og laes om titlen skiftede. Knappen «ikke-trykket» er allerede trykket
//     af press ovenfor, saa vi bruger «orden-1», som ikke har en handling -
//     derfor maales i stedet om klikket overhovedet nar frem: fokus-skift.
const kf = await kald('computer_find', { app: BID, role: 'AXButton', limit: 10 });
let midte = null;
try { midte = (JSON.parse(kf.tekst).matches || []).find(m => /orden-3/.test(JSON.stringify(m)))?.center; } catch {}
let klikMidte = null;
try { klikMidte = (JSON.parse(kf.tekst).matches || []).find(m => /klik-maal/.test(JSON.stringify(m)))?.center; } catch {}
if (klikMidte) {
  const k = await kald('computer_click', { app: BID, x: klikMidte.x, y: klikMidte.y });
  trin('haender+', 'click --app tager ikke skaermen', !k.fejl && /pointer stayed/.test(k.tekst), k.tekst.slice(0, 60));
  // «It does not pretend»: svaret maa IKKE paastaa at klikket lykkedes.
  trin('haender+', '...og paastaar ikke at klikket landede', /NOT verified/.test(k.tekst) && !/^Clicked at/.test(k.tekst),
       k.tekst.slice(0, 60));
  await new Promise(r => setTimeout(r, 700));
  const efterK = await kald('computer_inspect', { app: BID });
  // ⛔ UMAALT indtil nu. Rapporteres som maaling, ikke som paastand.
  const landede = /KLIKKET/.test(efterK.tekst);
  console.log(`\n  MAALING · landede klikket? ${landede ? 'JA' : 'NEJ'} - ${landede ? 'knappen skiftede titel' : 'knappen hedder stadig klik-maal'}`);
} else if (midte) {
  trin('haender+', 'click --app (kunne ikke finde en knap at sigte paa)', false, kf.tekst.slice(0, 60));
}

// --- 3d. DE OTTE DER ALDRIG KAN GOERES STILLE - skal vaere SKJULT i baggrund,
//     og afvist hvis de kaldes ved navn alligevel. Skjult er ikke det samme
//     som afvist, saa begge dele proeves.
const SKJULT = ['computer_quit', 'computer_drag', 'computer_space', 'computer_paste',
                'computer_window', 'computer_ask_user', 'computer_move', 'computer_activate'];
const tilbudt = SKJULT.filter(x => liste.includes(x));
trin('skjult', 'de otte larmende tilbydes IKKE i baggrund', tilbudt.length === 0,
     tilbudt.length ? 'TILBUDT: ' + tilbudt.join(', ') : 'ingen af de otte i listen');
const tvang = await kald('computer_move', { x: 5, y: 5 });
trin('skjult', '...og afvises hvis de kaldes ved navn alligevel', /Refused|not offered|unknown|background/i.test(tvang.tekst),
     tvang.tekst.slice(0, 70));

// --- 4. PORTENE
const uden = await kald('computer_type', { text: 'x' });
trin('porte', 'type UDEN app afvises', /Refused/.test(uden.tekst), uden.tekst);
const noegle = await kald('computer_scroll', { dx: 0, dy: 0, app: 'Keychain Access' });
trin('porte', 'adgangskode-program afvises', /Refused/.test(noegle.tekst), noegle.tekst);
const q = await kald('computer_key', { combo: 'cmd+q', app: BID });
trin('porte', 'cmd+q afvises', /Refused/.test(q.tekst), q.tekst);
// Det aktive program fra `apps`, ikke fra fokus: et program kan vaere forrest
// uden at noget felt i det har tastatur-fokus.
const appsR = await kald('computer_apps');
let aktiv = null; try { aktiv = (JSON.parse(appsR.tekst).apps || []).find(a => a.active)?.bundleId; } catch {}
if (aktiv) {
  const a = await kald('computer_press', { app: aktiv, title: 'findes-ikke-' + Date.now() });
  trin('porte', `press i det program du sidder i afvises`, /working in right now/.test(a.tekst), a.tekst);
}

// --- 5. LOGGEN
const log = await kald('computer_audit', { limit: 60 });
trin('log', 'kaeden er hel', /intact/.test(log.tekst), log.tekst.match(/"chain": "[^"]+"/)?.[0]);
trin('log', 'took_screen staar i loggen', /took_screen/.test(log.tekst), (log.tekst.match(/took_screen/g) || []).length + ' forekomster');
// ⛔ Konsulenten 22/9: loggen sagde «ok» om baade «vi sendte det» og «det
//    virkede». Nu staar der hvad vi FAKTISK ved: verified (laest efter),
//    performed (programmet udfoerte den) eller sent (afleveret, udfald ukendt).
const eff = [...log.tekst.matchAll(/"effect": "(\w+)"/g)].map(m => m[1]);
trin('log', 'loggen skelner «sendt» fra «virkede»',
     eff.includes('verified') && eff.includes('performed') && eff.includes('sent'),
     eff.length ? [...new Set(eff)].join(', ') : 'intet effect-felt');

srv.kill(); attrap.kill();
rmSync(STATE, { recursive: true, force: true }); rmSync(ARB, { recursive: true, force: true });

let g = '';
for (const r of res) {
  if (r.gruppe !== g) { console.log(`\n  ── ${r.gruppe.toUpperCase()}`); g = r.gruppe; }
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.hvad.padEnd(46)} ${r.bevis}`);
}
const ok = res.filter(r => r.ok).length;
console.log(`\n  ${ok} af ${res.length} gennem ÉN frisk server`);
console.log(ok === res.length ? 'BESTAAET' : `DUMPET: ${res.length - ok}`);
process.exit(ok === res.length ? 0 : 1);
