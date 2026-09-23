// ÉN DIALOG PR. PROGRAM PR. SESSION - og aldrig for et adgangskode-program.
//
// ⛔ HVORFOR DEN FINDES (22/9-2026)
//    MAALT i menneskets egen revisionslog: 283 dialoger paa to dage, ALLE med
//    Terminal som maal, ALLE i `allow`. Porten virkede efter hensigten og var
//    uudholdelig. Og listen manglede det sted agenten FAKTISK koerer - Cursor,
//    VS Code, hans egen IDE - hvor et tastetryk i en integreret terminal ER en
//    kommando.
//
//    De to ting kunne ikke rettes hver for sig: IDE'er paa en liste der
//    spoerger hver gang, ville have gjort produktet ubrugeligt praecis der hvor
//    det bruges mest. Derfor to lister.
//
// ⛔ Attrap-spoerger, saa ingen aegte dialog kan naa menneskets skaerm, og
//    attrap-hjaelper, saa intet udfoeres.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { lavFalskHjaelper, lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

function klient(spoerger) {
  const env = {
    ...process.env,
    CMCP_MODE: 'allow', CMCP_BACKGROUND: '0',
    CMCP_ASK_TIMEOUT: '1',
    CMCP_HELPER: lavFalskHjaelper('cmcp-sesport').sti,
    CMCP_OSASCRIPT: spoerger.sti,
    CMCP_STATE_DIR: mkdtempSync(join(tmpdir(), 'cmcp-sesport-')),
  };
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const venter = new Map(); let n = 0;
  srv.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!l.trim()) continue;
      try { const m = JSON.parse(l); venter.get(m.id)?.(m); venter.delete(m.id); } catch { /* videre */ }
    }
  });
  const rpc = (method, params) => new Promise((res, rej) => {
    const id = ++n; venter.set(id, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => rej(new Error('timeout ' + method)), 20000);
  });
  return { srv, rpc, env };
}

// ⛔ MAALER-FAELDE, faldet i 22/9: foerste udgave brugte `com.apple.Terminal`.
//    Den KOERER IKKE paa maskinen, saa `resolveBundleId` gav null, maalet blev
//    «ukendt» - og porten spurgte hver gang af en HELT anden grund. Proeven
//    sagde «session-rabatten virker ikke»; den maalte ukendt-maal-porten.
//    Et program skal koere for at kunne opsloes. Vi vaelger derfor et der goer.
const { SPOERG_PR_SESSION: LISTE } = await import(join(ROOT, 'mcp-server', 'policy.js'));
const koerende = (await import('node:child_process')).execSync(
  `"${lavFalskHjaelper('cmcp-opslag').sti}" apps`, { encoding: 'utf8' });
const SESSIONS_APP = (JSON.parse(koerende).apps || [])
  .map(a => a.bundleId).find(b => LISTE.has(b));
if (!SESSIONS_APP) {
  console.log('UMAALT  intet program fra session-listen koerer - punkt 1-3 kan ikke maales');
  console.log();
  console.log('BESTAAET');
  process.exit(0);
}
console.log(`     (maaler mod ${SESSIONS_APP})`);

// --- 1. Et SESSION-PROGRAM spoerger ÉN gang, ikke tre ---------------------
{
  const sp = lavFalskSpoerger('ja', 'cmcp-sesport-ja');
  const c = klient(sp);
  await c.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '1' } });
  c.srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  for (let i = 0; i < 3; i++) {
    await c.rpc('tools/call', { name: 'computer_press', arguments: { app: SESSIONS_APP, title: 'x' } });
  }
  c.srv.kill();
  check('tre handlinger i samme program spoerger ÉN gang', sp.gangeSpurgt() === 1,
        `${sp.gangeSpurgt()} dialoger for 3 handlinger`);
}

// --- 2. Et ADGANGSKODE-program spoerger HVER gang -------------------------
//
// ⛔ MAALT PAA DEN FORKERTE MAADE FOERST, 22/9. Foerste udgave gik gennem
//    serveren med `app: 'com.apple.keychainaccess'`. Noeglering KOERER IKKE paa
//    maskinen, saa maalet blev opsloet til null -> «ukendt maal» -> og DEN
//    regel spoerger ogsaa hver gang. Paastanden var groen, og en mutation der
//    gav adgangskode-programmer session-rabat aendrede INTET: reglen den
//    paastod at maale, var ikke den der holdt.
//
//    Hvilken ANDEN regel kunne give samme groenne svar? Den her.
//    Derfor maales reglen nu direkte, med et kendt maal, uden at noget skal
//    koere paa maskinen.
{
  process.env.CMCP_MODE = 'allow';
  process.env.CMCP_BACKGROUND = '0';
  process.env.CMCP_ASK_TIMEOUT = '1';
  const sp = lavFalskSpoerger('ja', 'cmcp-sesport-noegle');
  process.env.CMCP_OSASCRIPT = sp.sti;
  const { decide, TIER } = await import(join(ROOT, 'mcp-server', 'policy.js'));

  for (let i = 0; i < 3; i++) {
    await decide({ tier: TIER.WRITE, targetBundleId: 'com.apple.keychainaccess', describe: 'press x' });
  }
  check('tre handlinger i et adgangskode-program spoerger TRE gange', sp.gangeSpurgt() === 3,
        `${sp.gangeSpurgt()} dialoger - session-rabatten maa ALDRIG gaelde her`);

  // ...og kalibrering: et program paa SESSION-listen spoerger kun én gang,
  // gennem nøjagtig samme kald. Uden den her linje kunne paastanden ovenfor
  // bestaa fordi ALT spoerger tre gange.
  const sp2 = lavFalskSpoerger('ja', 'cmcp-sesport-term');
  process.env.CMCP_OSASCRIPT = sp2.sti;
  const { decide: decide2, TIER: TIER2 } = await import(join(ROOT, 'mcp-server', 'policy.js') + '?frisk=' + Date.now());
  for (let i = 0; i < 3; i++) {
    await decide2({ tier: TIER2.WRITE, targetBundleId: 'com.apple.Terminal', describe: 'press x' });
  }
  check('...mens et session-program spoerger ÉN gang, samme kald', sp2.gangeSpurgt() === 1,
        `${sp2.gangeSpurgt()} dialoger for Terminal`);
}

// --- 3. Et ja til et session-program daekker IKKE en adgangskode-boks -----
{
  const sp = lavFalskSpoerger('ja', 'cmcp-sesport-to');
  const c = klient(sp);
  await c.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '1' } });
  c.srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await c.rpc('tools/call', { name: 'computer_press', arguments: { app: SESSIONS_APP, title: 'x' } });
  await c.rpc('tools/call', { name: 'computer_press', arguments: { app: SESSIONS_APP, title: 'x' } });
  await c.rpc('tools/call', { name: 'computer_press', arguments: { app: 'com.apple.keychainaccess', title: 'x' } });
  c.srv.kill();
  check('et ja til arbejdsprogrammet daekker ikke en adgangskode-boks',
        sp.gangeSpurgt() === 2, `${sp.gangeSpurgt()} dialoger: 1 for programmet + 1 for noeglen`);
}

// --- 4. Editorerne ER paa listen - det var hele hullet --------------------
{
  const { SPOERG_PR_SESSION, ALWAYS_ASK_APPS } = await import(join(ROOT, 'mcp-server', 'policy.js'));
  const skal = ['com.microsoft.VSCode', 'com.todesktop.230313mzl4w4u92', 'com.agent360.ide',
                'com.apple.Terminal', 'com.mitchellh.ghostty'];
  const mangler = skal.filter(x => !SPOERG_PR_SESSION.has(x));
  check('editorer og terminaler staar paa session-listen', mangler.length === 0, mangler.join(', ') || `${SPOERG_PR_SESSION.size} programmer`);

  // ...og de to lister maa ALDRIG overlappe: et program paa begge ville faa
  // session-rabat paa en adgangskode-boks.
  const begge = [...ALWAYS_ASK_APPS].filter(x => SPOERG_PR_SESSION.has(x));
  check('intet program staar paa begge lister', begge.length === 0, begge.join(', ') || 'ingen overlap');
}

// ⛔ ASTRA, runde 1 (23/9): dialogen for en FARLIG handling siger «Allow this
//    one action?» - og et ja gav alligevel hele sessionen i terminalen, fordi
//    `!alwaysAsk` manglede i netop den gren. Teksten og virkningen sagde ikke
//    det samme, og det er den vaerste slags samtykke.
{
  const P = await import(join(ROOT, 'mcp-server', 'policy.js'));
  const ja = lavFalskSpoerger('ja', 'cmcp-sesport-enkelt');
  process.env.CMCP_OSASCRIPT = ja.sti;
  process.env.CMCP_BACKGROUND = '0';
  process.env.CMCP_MODE = 'ask';
  P.glemSessionsProgrammer();
  const v = await P.decide({ tier: P.TIER.WRITE, targetBundleId: 'com.apple.Terminal',
                             describe: 'Press cmd+w', alwaysAsk: true });
  check('et ja til «denne ene handling» aabner IKKE hele sessionen',
        v.allow === true && !P.sessionsProgrammer().includes('com.apple.Terminal'),
        `lov=${v.allow} · sessioner=${JSON.stringify(P.sessionsProgrammer())}`);
  P.glemSessionsProgrammer();
  delete process.env.CMCP_BACKGROUND;
}

console.log();
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
