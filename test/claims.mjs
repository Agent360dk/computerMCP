// Proever for de paastande sitet og README'en staar paa.
//
// De var alle sande i koden da de blev skrevet. Forskellen paa "sand i dag"
// og "bliver ved med at vaere sand" er en proeve. Et sikkerhedsloefte uden
// proeve er en kommentar.
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT = join(homedir(), '.local', 'state', 'computer-mcp', 'audit.jsonl');

function client(env) {
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')],
    { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const pending = new Map(); let id = 0;
  srv.stdout.on('data', d => { buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!l.trim()) continue; try { const m = JSON.parse(l);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} } });
  const rpc = (method, params = {}) => new Promise((res, rej) => {
    const my = ++id; pending.set(my, res);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
    setTimeout(() => { if (pending.has(my)) { pending.delete(my); rej(new Error('timeout ' + method)); } }, 90000);
  });
  return { srv, rpc, async ready() {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '1' } });
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }};
}

const fails = []; const skips = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const skip = (l, why) => { console.log(`SPR. ${l} - ${why}`); skips.push(l); };

// ---------------------------------------------------------------- paastand 1
// "Password managers and terminals ask every single time, even in allow mode."
// Testes i allow-tilstand, hvor INTET andet spoerger. Sker handlingen alligevel,
// er saetningen paa forsiden usand.
{
  const c = client({ CMCP_MODE: 'allow', CMCP_ASK_TIMEOUT: '2' });
  await c.ready();
  console.log('  (en dialog vises i 2 sekunder - det er meningen)');
  const r = await c.rpc('tools/call', { name: 'computer_activate', arguments: { app: 'com.apple.Terminal' } });
  const txt = r.result?.content?.[0]?.text || '';
  // MAALT 18/9: her stod kun `isError === true`. Terminal koerte ikke paa
  // maskinen, saa kaldet fejlede med "programmet koerer ikke" - ogsaa en fejl -
  // og proeven bestod selv da samtykke-porten var muteret vaek. En proeve der
  // ikke kan skelne "afvist af porten" fra "fejlede af en anden grund",
  // beviser ingenting. Nu kraeves ordet fra porten selv.
  check('1. farligt program spoerger selv i allow-tilstand',
        r.result?.isError === true && /Afvist:/.test(txt),
        txt.split('\n')[0]);

  // Og modstykket: et harmloest program spoerger IKKE i allow-tilstand.
  // Uden dette tjek ville "afvis altid" ogsaa bestaa proeve 1.
  const r2 = await c.rpc('tools/call', { name: 'computer_move', arguments: { x: 900, y: 500 } });
  // Slaar opslaget af det forreste program fejl, er maalet UKENDT, og saa
  // spoerger porten med rette (fail-closed). Det er ikke det denne linje maaler,
  // saa den springer over i stedet for at dumpe paa en travl maskine.
  const t2 = r2.result?.content?.[0]?.text || '';
  if (r2.result?.isError === true && /sagde nej eller svarede ikke/.test(t2)) {
    skip('1b. harmloest program spoerger ikke i allow-tilstand',
         'opslaget af forreste program naaede ikke frem - ukendt maal, porten spurgte med rette');
  } else {
    check('1b. harmloest program spoerger ikke i allow-tilstand',
          r2.result?.isError !== true, t2.slice(0, 40));
  }
  c.srv.kill();
}

// ---------------------------------------------------------------- paastand 2
// "Typed text is stored as a length and a hash, never in clear."
// Koeres i readonly, saa der ikke skrives i et rigtigt program: handlingen
// afvises, men revisionslinjen skrives foerst - og det er linjen vi proever.
{
  const SECRET = 'KLARTEKST-MAA-ALDRIG-LOGGES-9f3a';
  // ⛔ EGEN state-mappe. Laeser proeven brugerens rigtige log, finder den den
  //    NYESTE computer_type-linje - som kan vaere fra en anden proeve eller en
  //    tidligere koersel. MAALT 19/9: 2b dumpede paa "length 30" fordi
  //    paastand 8's hemmelighed laa oeverst. En proeve skal maale sin egen
  //    handling, ikke det den tilfaeldigvis finder.
  const { mkdtempSync: mkd2 } = await import('fs');
  const { tmpdir: td2 } = await import('os');
  const stateDir = mkd2(join(td2(), 'cmcp-audit-'));
  const AUDIT_OWN = join(stateDir, 'audit.jsonl');
  const c = client({ CMCP_MODE: 'readonly', CMCP_STATE_DIR: stateDir });
  await c.ready();
  await c.rpc('tools/call', { name: 'computer_type', arguments: { text: SECRET } });
  c.srv.kill();
  await new Promise(r => setTimeout(r, 300));

  if (!existsSync(AUDIT_OWN)) { skip('2. revisionslog', 'loggen blev ikke skrevet'); }
  else {
    const lines = readFileSync(AUDIT_OWN, 'utf8').trim().split('\n').slice(-12);
    const whole = lines.join('\n');
    const typed = lines.map(l => JSON.parse(l)).find(e => e.tool === 'computer_type' && e.args);
    check('2. klarteksten staar ikke i loggen', !whole.includes(SECRET));
    check('2b. der staar et fingeraftryk i stedet',
          !!typed?.args?.text?.sha256_12 && typed.args.text.length === SECRET.length,
          typed ? JSON.stringify(typed.args.text) : 'ingen linje fundet');

    // 2c. ⛔ Aftrykket skal vaere SALTET. Et usaltet sha256 af et kort kodeord
    //     kan gaettes igennem offline af den der har loggen - tolv hex er 48 bit,
    //     rigeligt til at bekraefte et gaet. Uden denne linje var loeftet
    //     "aldrig i klartekst" bogstaveligt sandt og praktisk halvt, og vores
    //     egen artikel om revisionslogge der er deres egen laekage, ramte os selv.
    const plain = createHash('sha256').update(SECRET).digest('hex').slice(0, 12);
    check('2c. fingeraftrykket er saltet, ikke et bart sha256',
          !!typed?.args?.text?.sha256_12 && typed.args.text.sha256_12 !== plain,
          `log=${typed?.args?.text?.sha256_12} bart=${plain}`);
  }
}

// ---------------------------------------------------------------- paastand 3
// "Values of secure fields are never returned, not even to the agent."
{
  const c = client({ CMCP_MODE: 'readonly' });
  await c.ready();
  const r = await c.rpc('tools/call', { name: 'computer_inspect', arguments: { depth: 14, limit: 1500 } });
  c.srv.kill();
  let nodes = [];
  try { nodes = JSON.parse(r.result?.content?.[0]?.text || '{}').nodes || []; } catch {}
  const secure = nodes.filter(n => n.secure);
  if (!secure.length) {
    // Ingen sikre felter paa skaermen = proeven kan ikke bevise noget.
    // Den siger det hoejt i stedet for at bestaa paa et tomt grundlag.
    skip('3. sikre felter udelader vaerdien', `ingen sikre felter paa skaermen (${nodes.length} noder set)`);
  } else {
    check('3. sikre felter udelader vaerdien',
          secure.every(n => !('value' in n)), `${secure.length} sikre noder`);
  }
}

// ---------------------------------------------------------------- paastand 3b
// "computer_click bruger PUNKTER, billedet er i PIXELS."
//
// MAALT 18/9: uden --max-width er billedet 3420x2214 mens skaermen er
// 1710x1107 punkter. En model der laeser en koordinat af billedet og klikker
// der, rammer 600 punkter forkert - den halve skaerm - og faar ingen fejl.
// Svaret skal baere maalestokken, ellers er billedet ubrugeligt til at klikke ud fra.
{
  const c = client({ CMCP_MODE: 'readonly' });
  await c.ready();
  const r = await c.rpc('tools/call', { name: 'computer_screenshot', arguments: {} });
  c.srv.kill();
  const txt = r.result?.content?.find(p => p.type === 'text')?.text || '';
  const m = txt.match(/([\d.]+) pixel pr\. punkt/);
  check('3b. skaermbilledet oplyser maalestokken', !!m, txt.slice(0, 90));
  if (m) {
    const f = Number(m[1]);
    check('3c. maalestokken er brugbar', f > 0 && f < 10, `faktor ${f}`);
    check('3d. svaret siger at klik regner i punkter', /PUNKTER/.test(txt));
  }
}

// ---------------------------------------------------------------- paastand 4
// "No shell execution, no arbitrary file access, no URL fetching."
{
  const { TOOLS } = await import(join(ROOT, 'mcp-server', 'tools.js'));
  const forbidden = /exec|shell|command|run_|open_file|read_file|fetch|download|url/i;
  const offenders = TOOLS.filter(t => forbidden.test(t.name));
  check('4. ingen skal-, fil- eller URL-vaerktoejer', offenders.length === 0,
        offenders.length ? offenders.map(t => t.name).join(', ') : `${TOOLS.length} vaerktoejer gennemgaaet`);
}

// ---------------------------------------------------------------- paastand 5
// "computer_press virker paa et vindue der ligger bagved" - og netop derfor
// maa porten bedoemme det program elementet LIGGER I, ikke det der er forrest.
//
// Uden det tjek ville et tryk paa "Vis adgangskode" i 1Password blive bedoemt
// paa TextEdit, altid-spoerg-listen ville aldrig fyre, og hele forskellen paa
// "agenten maa arbejde" og "agenten maa hente mine kodeord" var vaek.
// Koeres i allow-tilstand, hvor intet andet spoerger.
{
  const c = client({ CMCP_MODE: 'allow', CMCP_ASK_TIMEOUT: '2' });
  await c.ready();
  console.log('  (endnu en dialog i 2 sekunder - ogsaa med vilje)');
  const r = await c.rpc('tools/call', {
    name: 'computer_press',
    arguments: { app: 'com.apple.Terminal', title: 'Ny fane' }
  });
  const txt = r.result?.content?.[0]?.text || '';
  check('5. press bedoemmes paa det program elementet ligger i',
        r.result?.isError === true && /Afvist:/.test(txt), txt.split('\n')[0]);

  // Modstykket: et harmloest program slipper igennem porten. Uden det ville
  // "afvis alle press" ogsaa bestaa proeve 5. Finder koerer altid; opslaget
  // finder ingenting, og DEN fejl er ikke portens.
  const r2 = await c.rpc('tools/call', {
    name: 'computer_press',
    arguments: { app: 'com.apple.finder', title: 'FINDES-HELT-SIKKERT-IKKE-7f21' }
  });
  const txt2 = r2.result?.content?.[0]?.text || '';
  check('5b. harmloest program stoppes ikke af porten',
        !/Afvist:/.test(txt2), txt2.split('\n')[0].slice(0, 60));
  c.srv.kill();
}

// ---------------------------------------------------------------- paastand 6
// "Adgangskode-bokse og terminaler spoerger hver gang" - og porten skal kunne
// holde det uanset HVILKEN form agenten skriver programmet i.
//
// MAALT 18/9 af panelet: `ALWAYS_ASK_APPS` indeholder bundle-ID'er, men baade
// vaerktoejs-skemaet og hjaelperen tager imod et NAVN. `decide()` fik derfor
// strengen "1Password", som ikke staar i listen, og svarede allow=true,
// asked=false - mens handlingen ramte 1Password. Forsidens andet loefte var
// falsificerbart med ét ord.
//
// Rettelsen er oversaettelse FOER porten, ikke navne i listen: navne er
// oversatte, og "Keychain Access" hedder "Noeglering" paa en dansk Mac.
{
  const { resolveBundleId } = await import(join(ROOT, 'mcp-server', 'helper.js'));
  const { ALWAYS_ASK_APPS } = await import(join(ROOT, 'mcp-server', 'policy.js'));

  // 6a. Listen er bundle-ID'er. Det er DERFOR oversaettelsen er baerende.
  //     AEndrer nogen den beslutning, skal denne linje tvinge dem til at sige det.
  check('6a. altid-spoerg-listen er bundle-ID-formen',
        ALWAYS_ASK_APPS.has('com.apple.Terminal') && !ALWAYS_ASK_APPS.has('Terminal'),
        'com.apple.Terminal=ja, Terminal=nej');

  // 6b. Et NAVN skal oversaettes til det kanoniske bundle-ID foer porten spoerges.
  const { helperPath } = await import(join(ROOT, 'mcp-server', 'helper.js'));
  const HELPER = process.env.CMCP_HELPER || helperPath();
  const probe = HELPER ? await import('child_process')
    .then(cp => new Promise(res => cp.execFile(HELPER, ['apps'], (e, out) => {
      try { res((JSON.parse(out).apps || []).find(a => a.bundleId && a.name)); } catch { res(null); }
    }))) : null;
  if (!probe) {
    skip('6b. et program-NAVN oversaettes til bundle-ID', 'kunne ikke laese programlisten');
  } else {
    const byName = await resolveBundleId(probe.name);
    const byId   = await resolveBundleId(probe.bundleId);
    const upper  = await resolveBundleId(probe.name.toUpperCase());
    check('6b. et program-NAVN oversaettes til bundle-ID',
          byName === probe.bundleId, `"${probe.name}" -> ${byName}`);
    check('6c. et bundle-ID bliver staaende',
          byId === probe.bundleId, byId);
    check('6d. oversaettelsen er ikke versalfoelsom',
          upper === probe.bundleId, `"${probe.name.toUpperCase()}" -> ${upper}`);
  }

  // 6e. ⛔ DET AFGOERENDE TJEK. 6b-6d proever `resolveBundleId` direkte og bliver
  //     GROENNE selv om `index.js` holder op med at kalde den - maalt ved mutation
  //     18/9. En proeve der ikke kan blive roed paa den rigtige fejl, paastaar intet.
  //     Her gaar vejen gennem serveren: vi beder om et program ved NAVN, og
  //     revisionslinjen skal baere det kanoniske bundle-ID. Goer den ikke det,
  //     saa det porten saa, var navnet.
  if (probe && probe.name !== probe.bundleId) {
    const c = client({ CMCP_MODE: 'readonly' });
    await c.ready();
    await c.rpc('tools/call', { name: 'computer_press', arguments: { app: probe.name, title: 'FINDES-IKKE-6e' } });
    c.srv.kill();
    await new Promise(r => setTimeout(r, 300));
    let line = null;
    if (existsSync(AUDIT)) {
      line = readFileSync(AUDIT, 'utf8').trim().split('\n').slice(-8)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean).reverse().find(e => e.tool === 'computer_press');
    }
    if (!line) {
      skip('6e. porten faar det kanoniske ID, ikke navnet', 'ingen press-linje i loggen');
    } else {
      check('6e. porten faar det kanoniske ID, ikke navnet',
            line.target === probe.bundleId,
            `bad om "${probe.name}", porten saa "${line.target}"`);
    }
  } else {
    skip('6e. porten faar det kanoniske ID, ikke navnet', 'intet program hvor navn og bundle-ID er forskellige');
  }
}

// ---------------------------------------------------------------- paastand 7
// "Fejl lukket" skal ogsaa gaelde naar vi ikke kan se hvad vi rammer.
//
// MAALT 18/9: `frontmostBundleId()` giver null naar opslaget tager over fem
// sekunder. Samme aften tog hjaelperen 23-38 sekunder (load 143). Foer
// rettelsen svarede porten da allow=true, asked=false - et tastetryk i en
// terminal gik igennem uden dialog, praecis naar maskinen var mest presset.
{
  const { decide } = await import(join(ROOT, 'mcp-server', 'policy.js'));
  const before = process.env.CMCP_MODE;
  process.env.CMCP_MODE = 'allow';
  process.env.CMCP_ASK_TIMEOUT = '2';
  console.log('  (en dialog mere i 2 sekunder)');
  const v = await decide({ tier: 'write', targetBundleId: null, describe: 'proeve: ukendt maal' });
  process.env.CMCP_MODE = before;
  check('7. et ukendt maal spoerger i stedet for at gaa igennem',
        v.asked === true && v.allow === false,
        `asked=${v.asked} allow=${v.allow} (${v.reason})`);
}

// ---------------------------------------------------------------- paastand 8
// "The text reaches the helper over stdin, never as a command-line argument,
//  because ps is readable by every process on the machine." - docs/tools.html
//
// ⛔ MAALT 19/9 af panelet: USANDT i den udgivne kode. Hjaelperen har haft
// --stdin siden 18/9 med kommentaren "den eneste vej for hemmeligheder", og
// JS-siden sendte --text alligevel. Kodeordet stod i procestabellen mens det
// blev skrevet, laesbart for enhver proces med samme bruger-id.
//
// ⛔ OG MIN FOERSTE UDGAVE AF DENNE PROEVE VAR VAERDILOES: den kaldte
// `callHelper` direkte med --stdin og blev GROEN med `computer_type` rullet
// tilbage til --text. Den maalte roerfoeringen, ikke wiringen - samme fejl som
// proeve 6 samme dag. Nu gaar vejen gennem SERVEREN, og den falske hjaelper
// skriver sin egen argv til en fil vi laeser bagefter.
{
  const { writeFileSync, chmodSync, mkdtempSync, readFileSync: rf, existsSync: ex } = await import('fs');
  const { tmpdir } = await import('os');
  const dir = mkdtempSync(join(tmpdir(), 'cmcp-argv-'));
  const out = join(dir, 'seen.json');
  const fake = join(dir, 'fake.mjs');
  writeFileSync(fake,
    "import {writeFileSync} from 'fs';\n" +
    "let s='';process.stdin.setEncoding('utf8');\n" +
    // Hjaelperen skal svare paa `apps`, ellers bliver maalet ukendt, porten
    // spoerger (min egen fail-closed-vagt), dialogen udloeber - og `type`
    // koeres aldrig. Proeven maalte foerst netop det og troede den maalte argv.
    "const cmd=process.argv[2];\n" +
    "const reply=cmd==='apps'?{ok:true,apps:[{bundleId:'com.apple.TextEdit',name:'TextEdit',active:true,pid:1}]}:{ok:true};\n" +
    "const done=()=>{try{if(cmd==='type')writeFileSync(" + JSON.stringify(out) + ",JSON.stringify({argv:process.argv.slice(2),stdin:s}));}catch{}\n" +
    "  process.stdout.write(JSON.stringify(reply)+'\\n');process.exit(0);};\n" +
    "process.stdin.on('data',d=>s+=d).on('end',done);setTimeout(done,2500);\n");
  const wrapper = join(dir, 'w.sh');
  writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
  chmodSync(wrapper, 0o755);

  const SECRET = 'KODEORD-MAA-ALDRIG-I-ARGV-9f3a';
  // ⛔ EGEN state-mappe. Uden den skriver denne proeve i brugerens RIGTIGE
  //    revisionslog, og paastand 2 laeser saa 8's linje i stedet for sin egen -
  //    maalt: 2b dumpede paa "length 30" hvor dens egen hemmelighed er 32 tegn.
  //    En proeve der forurener det den maaler, maaler sig selv.
  const c = client({ CMCP_MODE: 'allow', CMCP_HELPER: wrapper, CMCP_ASK_TIMEOUT: '2',
                     CMCP_STATE_DIR: join(dir, 'state') });
  await c.ready();
  await c.rpc('tools/call', { name: 'computer_type', arguments: { text: SECRET } });
  c.srv.kill();
  await new Promise(r => setTimeout(r, 400));

  let seen = null;
  try { seen = JSON.parse(rf(out, 'utf8')); } catch { seen = null; }
  if (!seen) {
    skip('8. tastet tekst staar ikke i procestabellen', 'den falske hjaelper efterlod intet spor');
  } else {
    check('8. tastet tekst staar IKKE i argumenterne',
          !seen.argv.some(a => String(a).includes(SECRET)), JSON.stringify(seen.argv));
    check('8b. og den naaede frem paa stdin',
          String(seen.stdin || '').includes(SECRET),
          String(seen.stdin || '').trim().slice(0, 34) || 'tom');
  }
}

// ---------------------------------------------------------------- paastand 9
// `computer_ask_user` maa ALDRIG kunne baere en hemmelighed tilbage.
//
// Panelet 19/9 (Fable + sikkerhedsgennemgangen) landede uafhaengigt paa samme
// udgave: dialogen returnerer kun en boolean, mennesket taster selv.
// Soesterproduktets `browser_ask_user` har et `type: password`-felt og sender
// vaerdien til modellen. Det er ikke en praecedens vi foelger.
//
// Proeven maaler FORMEN, ikke en enkelt koersel: et skema uden felter kan ikke
// tage imod en hemmelighed, og et svar uden fritekst kan ikke give en videre.
{
  const { TOOLS } = await import(join(ROOT, 'mcp-server', 'tools.js') + '?ask');
  const t = TOOLS.find(x => x.name === 'computer_ask_user');
  if (!t) {
    check('9. computer_ask_user findes', false, 'vaerktoejet mangler');
  } else {
    const props = Object.keys(t.inputSchema?.properties || {});
    check('9. ask_user kan ikke bede om en hemmelighed',
          props.length === 1 && props[0] === 'message',
          `felter: ${props.join(', ') || 'ingen'}`);
    const txt = JSON.stringify(t.inputSchema);
    check('9b. skemaet har intet password-felt',
          !/password|secret|token|credential/i.test(txt), 'skemaet er rent');

    // 9c. Selve svaret: kun boolean + serverens egen stedangivelse.
    const c = client({ CMCP_MODE: 'ask', CMCP_ASK_TIMEOUT: '2' });
    await c.ready();
    console.log('  (endnu en dialog i 2 sekunder - svar ikke)');
    const r = await c.rpc('tools/call', {
      name: 'computer_ask_user',
      arguments: { message: 'PROEVE-BON-MAA-IKKE-KOMME-RETUR-9f3a' }
    });
    c.srv.kill();
    let body = {}; try { body = JSON.parse(r.result?.content?.[0]?.text || '{}'); } catch {}
    const keys = Object.keys(body).sort().join(',');
    check('9c. svaret baerer kun en boolean og serverens stedangivelse',
          typeof body.done === 'boolean' && !('value' in body) && !('text' in body) && !('answer' in body),
          `noegler: ${keys}`);
  }
}

console.log();
if (skips.length) console.log(`SPRUNGET OVER: ${skips.length} (bevist intet - ikke bestaaet)`);
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
