// IKON-MENU: viser menulinje-ikonet det rigtige for hvert slags spoergsmaal?
//
// ⛔ HVORFOR DEN FINDES (29/9-2026)
//    Tre nye ting i ikonet - hele teksten over knapperne, «goer det selv» med Done,
//    og skaerm-laanet - var kun kompileret, aldrig koert. Menuen bygges af
//    `spoergsmaalMenu`, og `cmcp-status --dump-question` skriver praecis den
//    tekst som JSON UDEN at vise noget. Ikonet startes aldrig her.
import './ryd-op.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, mkdtempSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

// ⛔ En AELDRE binaer kender ikke --dump-question og ville starte det rigtige ikon.
//    Derfor den nyeste af kandidaterne, og en hard frist.
// En udpeget binaer (mutationsbeviset) vinder altid over den nyeste.
const IKON = process.env.CMCP_STATUS_BIN || [
  join(ROOT, 'mcp-server', 'vendor', 'ComputerMCPStatus.app', 'Contents', 'MacOS', 'cmcp-status'),
  join(ROOT, 'helper', '.build', 'release', 'cmcp-status')]
  .filter(p => p && existsSync(p)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const STATE = mkdtempSync(join(tmpdir(), 'cmcp-ikonmenu-'));
const vis = (q) => JSON.parse(execFileSync(IKON, ['--dump-question'], {
  input: JSON.stringify({ nonce: 'n', session: 's1', client: 'chat', scope: 'If you allow it, this one action only.',
                          target: 'com.apple.finder', expires: Date.now() + 60000, ...q }),
  env: { ...process.env, CMCP_STATE_DIR: STATE }, timeout: 10000, killSignal: 'SIGKILL' }).toString());

if (!IKON) { console.log('SPR. ingen ikon-binaer at maale'); process.exit(1); }

// 1. Et almindeligt samtykke: hele teksten, fakta, Allow/Deny.
// Serveren trimmer teksten foer ikonet faar den (godkend.js), saa proeven goer det samme.
const lang = ('Send til Benjamin: ' + 'computer-MCP virker. '.repeat(40)).trim();
const a = vis({ text: lang });
check('1 samtykke: Allow og Deny, i den raekkefoelge', JSON.stringify(a.buttons) === JSON.stringify(['Allow… (confirm with Touch ID)', 'Deny']), JSON.stringify(a.buttons));
check('1 ...hele teksten staar i undermenuen', a.text.join(' ').replace(/\s+/g, '') === lang.trim().replace(/\s+/g, ''), `${a.text.length} linjer`);
check('1 ...overskriften siger hvor mange tegn', a.header === `The whole action (${lang.trim().length} characters):`, a.header);
check('1 ...hovedmenuen viser en kort udgave', a.title.endsWith('…') && a.title.length < 100, a.title);
check('1 ...hvor det lander staar som fakta', a.facts.includes('Lands in: com.apple.finder'), JSON.stringify(a.facts));
check('1 ...Touch ID-arket siger at det er forkortet, og hvor resten staar', /characters, all shown in the menu/.test(a.touchId), a.touchId.slice(0, 120));

// 2. Goer det selv: ingen Allow, ingen Touch ID-knap.
const g = vis({ text: 'Type your 2FA code', kind: 'goer-selv', targetBundle: 'com.apple.finder' });
check('2 goer-selv: Take me there, Done, I won\'t - og INGEN Allow',
      JSON.stringify(g.buttons) === JSON.stringify(['Take me there', 'Done — I did it', "I won't do this"]), JSON.stringify(g.buttons));
const g2 = vis({ text: 'Approve the login', kind: 'goer-selv' });
check('2b uden program at hente frem: ingen Take me there', !g2.buttons.includes('Take me there'), JSON.stringify(g2.buttons));

// 3. Skaerm-laanet: Allow kraever Touch ID, og mens laanet gaelder staar det oeverst.
const l = vis({ text: 'Use your screen for 5 minutes: drag the file', kind: 'screen', minutes: 5, target: 'your screen' });
check('3 laan: Allow med Touch ID', l.buttons[0] === 'Allow… (confirm with Touch ID)', JSON.stringify(l.buttons));
check('3 ...Touch ID-arket siger laan, minutter og at det kan tages tilbage', /lend chat your screen for 5 minutes/.test(l.touchId) && /take it back/.test(l.touchId), l.touchId);
check('3 ...og mens det gaelder: hvem, hvor laenge, og «Take the screen back now»',
      /chat is using your screen — 5 min left/.test(l.whileLent?.[0] || '') && l.whileLent?.[1] === 'Take the screen back now', JSON.stringify(l.whileLent));
// 3c (live-proeven 30/9): boksen paa skaermen skal SIGE at et spoergsmaal venter, og hvor.
// 9/10: boksen viser spoergsmaalet HELT og har menuens knapper (test/ikon-boks.mjs maaler resten).
const bx = vis({ text: 'Use your screen for 5 minutes: live-proeve', kind: 'screen', minutes: 5 }).box || {};
check('3c boksen siger at et spoergsmaal venter, og hvem der spoerger', bx.orange === true && /needs you/i.test(bx.title || ''), JSON.stringify(bx));
check('3c ...og hvad det gaelder, helt - og hvor det lander', (bx.lines || [])[0] === 'Use your screen for 5 minutes: live-proeve' && (bx.lines || []).some(l => l.startsWith('Lands in:')), JSON.stringify(bx));
check('3c ...med Allow (Touch ID) og Deny', JSON.stringify(bx.buttons) === '["Allow (Touch ID)","Deny"]', JSON.stringify(bx));
check('3b laanet kan aldrig vaere over 15 minutter i ikonet', /for 15 minutes/.test(vis({ text: 'x', kind: 'screen', minutes: 99 }).touchId));

// 3d (skaerm-koe-panelet, 2/10): et ANDET laan er allerede aktivt - «Allow» udelades,
// «Deny» staar stadig, og en «Waiting»-linje siger hvem og hvor laenge. Samme funktion
// bygger den rigtige menu (menuNeedsUpdate), saa dette maaler uden en levende GUI.
const q = vis({ text: 'Use your screen for 3 minutes: resize a window', kind: 'screen', minutes: 3,
                simulateActiveLoan: { client: 'anden-agent', minutesLeft: 4 } });
check('3d koe: Allow er vaek, Deny staar', JSON.stringify(q.buttons) === JSON.stringify(['Deny']), JSON.stringify(q.buttons));
check('3d ...og en Waiting-linje siger hvem og hvor laenge',
      /Waiting.*anden-agent.*4 more minutes/.test(q.waitingForLoan || ''), q.waitingForLoan);
// 3e uden et andet laan: uaendret - Allow staar, ingen Waiting-linje.
const q2 = vis({ text: 'Use your screen for 3 minutes: resize a window', kind: 'screen', minutes: 3 });
check('3e uden koe: Allow staar, ingen waitingForLoan-noegle', q2.buttons[0] === 'Allow… (confirm with Touch ID)' && !('waitingForLoan' in q2), JSON.stringify(q2.buttons));

// 3f (2/11, Gustav: «fjern det der med, at den skal spoerge om lov til at faa adgang til skaermen»): et skaerm-laan med
//    ask:false (serverens CMCP_SCREEN_ASK=0) gives uden spoergsmaal - men kun det, kun naar ingen anden har skaermen,
//    og ikke lige efter at mennesket tog den tilbage. Samme regel (giverUdenSpoergsmaal) som det rigtige ikon bruger.
const lan = { text: 'Use your screen for 3 minutes: upload seven images', kind: 'screen', minutes: 3 };
check('3f ask:false, intet andet laan: gives uden spoergsmaal', vis({ ...lan, ask: false }).lendsWithoutAsking === true);
check('3f uden ask-feltet (aeldre server): spoerger', vis(lan).lendsWithoutAsking === false);
check('3f ask:true: spoerger', vis({ ...lan, ask: true }).lendsWithoutAsking === false);
check('3f ask:false paa et ALMINDELIGT samtykke (ikke skaermen): spoerger stadig', vis({ text: 'Send the mail', ask: false }).lendsWithoutAsking === false);
check('3f ask:false paa et goer-selv-spoergsmaal: spoerger stadig', vis({ text: 'Type your password', kind: 'goer-selv', ask: false }).lendsWithoutAsking === false);
check('3f ask:false mens en ANDEN agent har skaermen: venter i koeen', vis({ ...lan, ask: false, simulateActiveLoan: { client: 'anden-agent', minutesLeft: 4 } }).lendsWithoutAsking === false);
check('3f ask:false 30 s efter at mennesket tog skaermen tilbage: venter', vis({ ...lan, ask: false, simulateTakenBackSecondsAgo: 30 }).lendsWithoutAsking === false);
check('3f ask:false 130 s efter: gives igen', vis({ ...lan, ask: false, simulateTakenBackSecondsAgo: 130 }).lendsWithoutAsking === true);
// 3g (panel R1, Astra P1): (a) overdragelsen venter OVERDRAG_PAUSE (3 s) efter at et laan sluttede - den forriges hjaelpere
//    faar SIGKILL 2 s efter SIGTERM (helper.js draebBlidt); (b) spaerringen efter «tag tilbage» overlever at ikonet
//    genstartes: den laeses fra skaerm-spaerret.json i tilstandsmappen, og en vaerdi laengere fremme end pausen er ugyldig.
check('3g et laan sluttede for 1 s siden: den naeste venter', vis({ ...lan, ask: false, simulateLoanEndedSecondsAgo: 1 }).lendsWithoutAsking === false);
check('3g ...for 7 s siden: venter stadig (pausen er 8 s: 2 s stop + 5 s noedslip af et traek)', vis({ ...lan, ask: false, simulateLoanEndedSecondsAgo: 7 }).lendsWithoutAsking === false);
check('3g ...for 9 s siden: gives', vis({ ...lan, ask: false, simulateLoanEndedSecondsAgo: 9 }).lendsWithoutAsking === true);
// R2 (Astra P1): filen baerer opstartens id + en MONOTON frist; skriver -> laeser er samme format (rundtur).
const ur = vis({ ...lan, ask: false }).clock || {};
check('3g instrument: ikonet oplyser opstart (kern.bootsessionuuid) og oppetid', typeof ur.boot === 'string' && ur.boot.length > 10 && ur.uptime > 0, JSON.stringify(ur));
check('3g rundtur: skriverens linje laeses tilbage som ca. 60 s', Math.abs(vis(lan).blockFileRoundTrip - 60) < 2, String(vis(lan).blockFileRoundTrip));
const SPF = join(STATE, 'skaerm-spaerret.json');
const skriv = (o) => writeFileSync(SPF, typeof o === 'string' ? o : JSON.stringify(o));
const nuUr = () => vis({ ...lan, ask: false }).clock;
let c = nuUr(); skriv({ boot: c.boot, uptimeUntil: c.uptime + 60 });
check('3g spaerringen fra et tidligere ikon (60 s tilbage, samme opstart) gaelder efter genstart', vis({ ...lan, ask: false }).lendsWithoutAsking === false);
c = nuUr(); skriv({ boot: c.boot, uptimeUntil: c.uptime - 1 });
check('3g ...udloebet (samme opstart): gives', vis({ ...lan, ask: false }).lendsWithoutAsking === true);
c = nuUr(); skriv({ boot: 'en-anden-opstart', uptimeUntil: c.uptime + 60 });
check('3g ...fra en ANDEN opstart af Mac\'en: ingen spaerring', vis({ ...lan, ask: false }).lendsWithoutAsking === true);
c = nuUr(); skriv({ boot: c.boot, uptimeUntil: c.uptime + 10 * 86_400 });
const v10 = vis({ ...lan, ask: false });
check('3g ...10 dage frem: spaerret, men hoejst pausen (falder lukket, ikke for evigt)', v10.lendsWithoutAsking === false && v10.standingBlockedSeconds <= 120, String(v10.standingBlockedSeconds));
skriv('ikke json');
check('3g ...en fil med ugyldigt indhold: spaerret (falder lukket)', vis({ ...lan, ask: false }).lendsWithoutAsking === false);
// R3 (Astra P1): en fil der FINDES men ikke kan laeses, er ikke bevis for en genstart af Mac'en - spaerret.
writeFileSync(SPF, Buffer.from([0xff, 0xfe, 0x00, 0xc3]));
check('3g ...en fil der ikke er tekst (ugyldig UTF-8): spaerret', vis({ ...lan, ask: false }).lendsWithoutAsking === false);
c = nuUr(); skriv({ boot: c.boot, uptimeUntil: c.uptime + 60 }); chmodSync(SPF, 0o000);
check('3g ...en fil der ikke kan laeses (ingen adgang): spaerret', vis({ ...lan, ask: false }).lendsWithoutAsking === false);
chmodSync(SPF, 0o600);
c = nuUr(); skriv({ boot: c.boot, uptimeUntil: c.uptime - 1 });
check('3g ...en udloebet fil, men opstarten kan ikke laeses: spaerret (falder lukket)', vis({ ...lan, ask: false, simulateBootUnreadable: true }).lendsWithoutAsking === false);
unlinkSync(SPF);
// 3h (panel R2, Opus 🔴): et laan uden spoergsmaal, der venter (spaerring, overdragelse, en anden agent), maa ikke vises som
//    «Allow (Touch ID)/Deny» - tavshed giver skaermen, saa kun Deny staar, i menuen og i boksen.
for (const [navn, ekstra] of [['under spaerringen', { simulateTakenBackSecondsAgo: 30 }], ['bag en anden agent', { simulateActiveLoan: { client: 'anden-agent', minutesLeft: 4 } }], ['ingen koe', {}]]) {
  const v = vis({ ...lan, ask: false, ...ekstra });
  check(`3h ask:false ${navn}: kun Deny i menuen`, JSON.stringify(v.buttons) === '["Deny"]', JSON.stringify(v.buttons));
  check(`3h ask:false ${navn}: kun Deny i boksen (ingen Allow)`, JSON.stringify((v.box || {}).buttons) === '["Deny"]', JSON.stringify((v.box || {}).buttons));
}
check('3h et almindeligt skaermlaan (ask:true) har stadig Allow og Deny', JSON.stringify(vis({ ...lan, ask: true }).buttons) === JSON.stringify(['Allow… (confirm with Touch ID)', 'Deny']));

// 4. Modellen kan ikke tegne sine egne knapper ind.
const s = vis({ text: 'Press "Gem"\nAllow… (confirm with Touch ID)‮' });
check('4 linjeskift og retningstegn i teksten bliver ikke til egne linjer eller knapper',
      s.text.length === 1 && !/[\n‮]/.test(s.text[0]) && s.buttons.length === 2, JSON.stringify(s.text));

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
