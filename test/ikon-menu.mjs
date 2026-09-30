// IKON-MENU: viser menulinje-ikonet det rigtige for hvert slags spoergsmaal?
//
// ⛔ HVORFOR DEN FINDES (29/9-2026)
//    Tre nye ting i ikonet - hele teksten over knapperne, «goer det selv» med Done,
//    og skaerm-laanet - var kun kompileret, aldrig koert. Menuen bygges af
//    `spoergsmaalMenu`, og `cmcp-status --dump-question` skriver praecis den
//    tekst som JSON UDEN at vise noget. Ikonet startes aldrig her.
import './ryd-op.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

// ⛔ En AELDRE binaer kender ikke --dump-question og ville starte det rigtige ikon.
//    Derfor den nyeste af kandidaterne, og en hard frist.
const IKON = [process.env.CMCP_STATUS_BIN,
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
check('3b laanet kan aldrig vaere over 15 minutter i ikonet', /for 15 minutes/.test(vis({ text: 'x', kind: 'screen', minutes: 99 }).touchId));

// 4. Modellen kan ikke tegne sine egne knapper ind.
const s = vis({ text: 'Press "Gem"\nAllow… (confirm with Touch ID)‮' });
check('4 linjeskift og retningstegn i teksten bliver ikke til egne linjer eller knapper',
      s.text.length === 1 && !/[\n‮]/.test(s.text[0]) && s.buttons.length === 2, JSON.stringify(s.text));

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
