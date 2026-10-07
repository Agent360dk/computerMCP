// En KNAP der sletter, rydder eller lukker, spoerger - som et menupunkt med samme ord.
//
// ⛔ HVORFOR DEN FINDES (1/10-2026, konsulent-panelet om skaerm-koeen)
//    README lover «Anything that deletes or clears asks every time, recognised from the
//    words in the action itself». Ordene blev kun laest paa menuer og genveje: et tryk
//    paa en knap der hed «Slet», eller et klik paa «Erase», spurgte aldrig.
// Intet startes, intet tager skaermen: attrap-hjaelper og attrap-samtykke.
import './ryd-op.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const D = mkdtempSync(join(tmpdir(), 'cmcp-knapord-'));
const ARGV = join(D, 'argv.txt'), KNAP = join(D, 'knap.json'), AT = join(D, 'at.json'), STUB = join(D, 'stub.sh');
writeFileSync(STUB, `#!/bin/sh
printf '%s ' "$@" >> ${ARGV}; echo >> ${ARGV}
case "$1" in
  apps) echo '{"ok":true,"apps":[{"bundleId":"com.apple.TextEdit","name":"TextEdit","pid":4242,"active":false}]}' ;;
  resolve-app) echo '{"ok":true,"bundleId":"com.apple.TextEdit","running":true}' ;;
  press) case " $* " in *" --dry "*) cat ${KNAP} ;; *) echo '{"ok":true,"pressed":{}}' ;; esac ;;
  at) cat ${AT} ;;
  *) echo '{"ok":true}' ;;
esac
`);
chmodSync(STUB, 0o755);
const knap = (navn) => writeFileSync(KNAP, JSON.stringify({ ok: true, would_press: { name: navn, role: 'AXButton' } }));
const ved = (titel) => writeFileSync(AT, JSON.stringify({ ok: true, found: true, bundleId: 'com.apple.TextEdit', role: 'AXButton', title: titel }));

const spoerger = lavFalskSpoerger('udloeb', 'cmcp-knapord');
const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
  env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
         CMCP_STATE_DIR: join(D, 'state'), CMCP_BACKGROUND: '0', CMCP_MODE: 'allow',
         CMCP_ASK_TIMEOUT: '2', CMCP_OSASCRIPT: spoerger.sti },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
const kald = async (navn, args) => (await rpc('tools/call', { name: navn, arguments: args })).result?.content?.[0]?.text || '';
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'knapord', version: '1' } });
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const linjer = () => (existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '').split('\n');
const trykket = () => linjer().filter(l => l.startsWith('press ') && !l.includes('--dry')).length;
const klikket = () => linjer().filter(l => l.startsWith('click ')).length;

knap('Slet'); let f = trykket();
await kald('computer_press', { app: 'com.apple.TextEdit', title: 'Slet' });
check('1 en knap der hedder «Slet», trykkes IKKE uden et ja', trykket() === f);

knap('Erase'); f = trykket();
await kald('computer_press', { app: 'com.apple.TextEdit', contains: 'ras' });
check('2 knappens EGET navn afgør det, ikke det agenten søgte på («ras» -> «Erase»)', trykket() === f);

knap('Gem'); f = trykket();
await kald('computer_press', { app: 'com.apple.TextEdit', title: 'Gem' });
check('3 en harmløs knap («Gem») trykkes uden at spørge', trykket() === f + 1);

ved('Delete'); f = klikket();
await kald('computer_click', { app: 'com.apple.TextEdit', x: 100, y: 200 });
check('4 et klik der rammer «Delete», sker IKKE uden et ja', klikket() === f);

// ⛔ 2/10 (Opus-panelet): et klik rammer UANSET om opslaget her kan sige hvad
// der er på punktet - i modsætning til press, som slet ikke kan udføres uden
// et fundet element. Før fejlede disse tre tilfælde ÅBENT (ikke farligt).
writeFileSync(AT, JSON.stringify({ ok: true, found: false })); f = klikket();
await kald('computer_click', { app: 'com.apple.TextEdit', x: 10, y: 10 });
check('6 intet fundet på punktet: klikket sker IKKE uden et ja (fail closed)', klikket() === f);

writeFileSync(AT, JSON.stringify({ ok: true, found: true, bundleId: 'com.apple.TextEdit', role: 'AXUnknown' })); f = klikket();
await kald('computer_click', { app: 'com.apple.TextEdit', x: 10, y: 10 });
check('7 fundet, men uden navn eller beskrivelse: klikket sker IKKE uden et ja', klikket() === f);

const stubKilde = readFileSync(STUB, 'utf8');
writeFileSync(STUB, stubKilde.replace(/^  at\) cat .*$/m, '  at) exit 1 ;;')); f = klikket();
await kald('computer_click', { app: 'com.apple.TextEdit', x: 10, y: 10 });
check('8 opslaget selv fejler: klikket sker IKKE uden et ja', klikket() === f);
writeFileSync(STUB, stubKilde);

// ⛔ RETTET samme dag (CI fandt det, test/sende-port.mjs q9): en navnløs
// AXGroup er et helt almindeligt layout-lag, ikke en mulig "Slet"-knap -
// kun roller der plausibelt ER en knap (ukendt, Button, Image, Unknown)
// spørger når navnet mangler. Uden denne sondring spurgte porten på HVERT
// navnløst klik, også harmløse - for bredt.
writeFileSync(AT, JSON.stringify({ ok: true, found: true, bundleId: 'com.apple.TextEdit', role: 'AXGroup' })); f = klikket();
await kald('computer_click', { app: 'com.apple.TextEdit', x: 10, y: 10 });
check('9 fundet uden navn, men rollen er en harmløs gruppe: klikket sker UDEN at spørge', klikket() === f + 1);

// ⛔ review-security F5 (2/10), Gustav ja: samme klasse fejl som klikkets F1 i dag,
// bare paa tryk-grenen - et mislykket toerkoersels-opslag blev laest som "ufarligt".
// ⛔ 7/10 (panel R8, punkt I): toerkoersel og tryk bruger SAMME soegning, saa et maal
// toerkoerslen ikke kan vise, kan heller ikke trykkes. Foer spurgte porten om et ja til
// noget der ikke kunne ske. Nu: intet tryk OG intet spoergsmaal, med en grund.
let spurgt = spoerger.gangeSpurgt();
writeFileSync(KNAP, JSON.stringify({ ok: true })); f = trykket();
let svar = await kald('computer_press', { app: 'com.apple.TextEdit', title: 'Hvad Som Helst' });
check('11 dry-run finder intet at trykke (intet would_press): intet tryk, ingen spurgt', trykket() === f && spoerger.gangeSpurgt() === spurgt && /nobody was asked/.test(svar), svar.slice(0, 80));

const stubKilde2 = readFileSync(STUB, 'utf8');
writeFileSync(STUB, stubKilde2.replace(/^  press\) case.*$/m, '  press) exit 1 ;;')); f = trykket(); spurgt = spoerger.gangeSpurgt();
svar = await kald('computer_press', { app: 'com.apple.TextEdit', title: 'Noget' });
check('12 selve toerkoerslen fejler: intet tryk, ingen spurgt', trykket() === f && spoerger.gangeSpurgt() === spurgt && /nobody was asked/.test(svar), svar.slice(0, 80));
writeFileSync(STUB, stubKilde2);

// 13-14: hjaelperens egne afslag naar videre med den tekst og de kandidater, det
// rigtige tryk ville have givet - vaerktoejets loefte («a refusal, not a guess»).
writeFileSync(KNAP, JSON.stringify({ ok: false, error: 'nothing matched', code: 'not-found', count: 0 })); f = trykket(); spurgt = spoerger.gangeSpurgt();
svar = await kald('computer_press', { app: 'com.apple.TextEdit', title: 'Findes Ikke' });
check('13 not-found: intet tryk, ingen spurgt, hjaelperens grund', trykket() === f && spoerger.gangeSpurgt() === spurgt && /^Error \(not-found\): nothing matched/.test(svar), svar.slice(0, 80));
writeFileSync(KNAP, JSON.stringify({ ok: false, error: '2 elements match', code: 'ambiguous', count: 2, matches: [{ title: 'OK', index: 0 }, { title: 'OK', index: 1 }] })); f = trykket(); spurgt = spoerger.gangeSpurgt();
svar = await kald('computer_press', { app: 'com.apple.TextEdit', title: 'OK' });
check('14 ambiguous: intet tryk, ingen spurgt, kandidaterne med', trykket() === f && spoerger.gangeSpurgt() === spurgt && /^Error \(ambiguous\)/.test(svar) && /"matches"/.test(svar), svar.slice(0, 80));

// 15: et klik UDEN app paa et punkt hvis ejer ikke kan slaas op - genmaalingen afviste
// det alligevel efter ja'et. Nu afvises det foer, uden spoergsmaal.
writeFileSync(AT, JSON.stringify({ ok: true, found: false, under: [] })); f = klikket(); spurgt = spoerger.gangeSpurgt();
svar = await kald('computer_click', { x: 10, y: 10 });
check('15 klik uden app, ukendt ejer: intet klik, ingen spurgt', klikket() === f && spoerger.gangeSpurgt() === spurgt && /could not be identified/.test(svar), svar.slice(0, 80));

check('10 kalibrering: porten spurgte et menneske om 1, 2, 4, 6, 7 og 8 - ikke om 11-15', spoerger.gangeSpurgt() === 6, `spurgt ${spoerger.gangeSpurgt()} gange`);
srv.kill();
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
