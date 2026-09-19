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

// MUTATIONSBEVIS 19/9 (3b): maalestokken oplyst som "pixels per point" i
// stedet for "pixel pr. punkt" -> DUMP '3b. skaermbilledet oplyser
// maalestokken'. IKKE sprunget over, selv om filen nu har en spring-over-gren
// for en stallet hjaelper.
// ⛔ MAALT 19/9: denne fil viser SYV aegte macOS-dialoger pr. koersel, og
//    failclosed viser en ottende. De er der med vilje - en dialog der ikke kan
//    ses, beviser ingenting om at en ubesvaret dialog bliver til et afslag.
//    Men jeg koerte suiten omkring ti gange paa en dag, og Gustav fik dermed
//    omkring firs afbrydelser paa en maskine hvor produktets loefte er at det
//    IKKE tager skaermen.
//
//    CMCP_QUIET=1 springer dem over - og de rapporteres som SPRUNGET OVER,
//    ikke som bestaaet. Et flag der gjorde stoejen vaek ved at lade som om
//    noget var maalt, ville vaere vaerre end stoejen.
// ⛔ VENDT OM 19/9, efter at have afbrudt Gustav fem gange paa een dag.
//    Foerst laa flaget i run-all.sh - men jeg koerte filen DIREKTE mens jeg
//    byggede nye vagter, saa flaget blev aldrig laest. "Husk flaget" fejlede
//    to gange. Et sikkerhedsvalg der afhaenger af at nogen husker noget, er
//    ikke et valg; det er et haab.
//
//    Dialogerne er derfor OPT-IN: de vises kun med CMCP_DIALOGS=1. Standarden
//    springer dem over og siger det MED NAVN pr. tjek - aldrig som bestaaet.
//
//    ⛔ Og hullet det ville aabne, er lukket det rigtige sted: `release.sh`
//       NAEGTER at udgive uden CMCP_DIALOGS=1. Saa kan samtykke-porten ikke
//       vaere ubevist naar noget gaar ud, uanset hvor tit jeg glemmer flaget.
const STILLE = process.env.CMCP_DIALOGS !== '1';
const dialogSkip = (label) => skip(label, 'dialoger er opt-in - koer med CMCP_DIALOGS=1 (bevist intet)');

const fails = []; const skips = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const skip = (l, why) => { console.log(`SPR. ${l} - ${why}`); skips.push(l); };

// ---------------------------------------------------------------- paastand 1
// "Password managers and terminals ask every single time, even in allow mode."
// Testes i allow-tilstand, hvor INTET andet spoerger. Sker handlingen alligevel,
// er saetningen paa forsiden usand.
if (STILLE) { ['1. farligt program spoerger selv i allow-tilstand', '1b. harmloest program spoerger ikke i allow-tilstand'].forEach(dialogSkip); } else
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
  // ⛔ TREDJE STED med samme fejlklasse 19/9 (de to andre er i server-e2e.mjs).
  //    Optagelsen rammer 45-sekunders-loftet naar maskinen er belastet - maalt
  //    paa load 32 med 54 MB fri RAM - og saa dumper et tjek om MAALESTOKKEN
  //    paa at hjaelperen aldrig svarede. En hjaelper der ikke svarede, siger
  //    intet om hvad svaret ville have indeholdt.
  //
  //    Tre steder med to linjer hver er ikke et faelles modul vaerd; bliver det
  //    et fjerde, er det.
  const stalled = !m && /helper-timeout|svarede ikke inden for/i.test(txt);
  if (stalled) {
    skip('3b. skaermbilledet oplyser maalestokken', 'hjaelperen svarede ikke - maskinen, ikke koden (bevist intet)');
    skip('3c. maalestokken er brugbar', 'ingen optagelse at bedoemme (bevist intet)');
    skip('3d. svaret siger at klik regner i punkter', 'ingen optagelse at bedoemme (bevist intet)');
  } else {
  check('3b. skaermbilledet oplyser maalestokken', !!m, txt.slice(0, 90));
  if (m) {
    const f = Number(m[1]);
    check('3c. maalestokken er brugbar', f > 0 && f < 10, `faktor ${f}`);
    check('3d. svaret siger at klik regner i punkter', /PUNKTER/.test(txt));
  }
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
if (STILLE) { ['5. press bedoemmes paa det program elementet ligger i', '5b. harmloest program stoppes ikke af porten'].forEach(dialogSkip); } else
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
if (STILLE) { ['7. et ukendt maal spoerger i stedet for at gaa igennem'].forEach(dialogSkip); } else
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
if (STILLE) { ['8. tastet tekst staar IKKE i argumenterne', '8b. og den naaede frem paa stdin'].forEach(dialogSkip); } else
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
if (STILLE) { ['9. computer_ask_user findes', '9. ask_user kan ikke bede om en hemmelighed', '9b. skemaet har intet password-felt', '9c. svaret baerer kun en boolean og serverens stedangivelse'].forEach(dialogSkip); } else
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

// ---------------------------------------------------------------- paastand 10
// `computer_set_value` maa ALDRIG skrive i et sikkert felt.
//
// Uden den spaerre har vi bygget en tavs vej ind i en adgangskodeboks - og det
// er praecis det forsidens foerste loefte siger ikke kan lade sig goere.
//
// ⛔ MAALT live 19/9 paa en rigtig webside: almindeligt felt -> skrev;
//    kodeordsfelt -> afvist med `secure-field`. Proeven her koerer mod hvad der
//    tilfaeldigvis er paa skaermen, saa den SPRINGER OVER naar der ikke er et
//    sikkert felt - den maa aldrig bestaa paa et tomt grundlag.
{
  const { helperPath } = await import(join(ROOT, 'mcp-server', 'helper.js') + '?sv');
  const HELP = process.env.CMCP_HELPER || helperPath();
  const cp = await import('child_process');
  const run = (a, input) => new Promise(res => {
    const c = cp.execFile(HELP, a, (e, out) => { try { res(JSON.parse(String(out).trim().split('\n').pop())); } catch { res(null); } });
    if (input != null && c.stdin) { c.stdin.on('error', () => {}); c.stdin.end(input); }
  });

  const rects = HELP ? await run(['secure-rects']) : null;
  const n = (rects && rects.count) || 0;
  if (!n) {
    skip('10. set_value afviser et sikkert felt', 'intet sikkert felt paa skaermen');
  } else {
    // Saet fokus i det stoerste sikre felt og forsoeg at skrive i det.
    const r = (rects.rects || []).reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
    await run(['click', '--x', String(r.x + r.w / 2), '--y', String(r.y + r.h / 2)]);
    await new Promise(z => setTimeout(z, 600));
    const f = await run(['focused']);
    if (!f || !f.element || f.element.secure !== true) {
      skip('10. set_value afviser et sikkert felt', 'kunne ikke faa fokus i et sikkert felt');
    } else {
      const res = await run(['set-value', '--stdin'], 'MAA-ALDRIG-SKRIVES-9f3a');
      check('10. set_value afviser et sikkert felt',
            res && res.ok === false && res.code === 'secure-field',
            res ? `${res.ok === false ? 'afvist' : 'SKREV'}: ${res.code || '-'}` : 'intet svar');
    }
  }
}

// ---------------------------------------------------------------- paastand 11
// "Menupunkter der ser ud til at slette noget, spoerger hver gang, i enhver
// tilstand." Staar paa vaerktoejets beskrivelse, altsaa i modellens kontekst.
//
// ⛔ MAALT 19/9: menulinjen var det stoerste hul mellem hvad et menneske kan og
//    hvad agenten kan - 301 punkter i Chrome alene, heraf "Slet browserdata…"
//    og "Afslut Google Chrome". At give agenten menuen UDEN en port ville vaere
//    at give den en liste over uigenkaldelige handlinger.
//
//    Proeven doemmer BESLUTNINGEN, ikke udfoerelsen: den kalder porten direkte,
//    saa der aldrig slettes noget for at bevise at sletning spoerger.
if (STILLE) { ['11. farlige menustier genkendes', '11b. harmloese stier gaar fri', '11c. en farlig menusti spoerger selv i allow'].forEach(dialogSkip); } else
{
  const pol = await import(join(ROOT, 'mcp-server', 'policy.js') + '?m11');

  // Heuristikken paa aegte stier fra Gustavs egen Chrome, paa dansk - som
  // menulinjen faktisk er. En regel bygget paa engelske ord alene ville have
  // sluppet hver eneste af dem igennem.
  const farlige = ['Chrome > Slet browserdata…', 'Chrome > Afslut Google Chrome',
                   'Finder > Tøm papirkurv', 'History > Clear browsing data'];
  const harmloese = ['Arkiv > Udskriv…', 'Rediger > Kopiér', 'Vis > Zoom ind',
                     'Bogmærker > Vis alle bogmærker'];
  const f = farlige.filter(p => pol.menuSerFarlig(p)).length;
  const h = harmloese.filter(p => !pol.menuSerFarlig(p)).length;
  check('11. farlige menustier genkendes', f === farlige.length, `${f}/${farlige.length}`);
  check('11b. harmloese stier gaar fri', h === harmloese.length, `${h}/${harmloese.length}`);

  // Og porten SKAL spoerge, ogsaa i allow. Tidsgraensen er sat til 2 sekunder,
  // saa dialogen lukker sig selv - og et ubesvaret spoergsmaal er et afslag.
  const gemtMode = process.env.CMCP_MODE, gemtTid = process.env.CMCP_ASK_TIMEOUT;
  process.env.CMCP_MODE = 'allow';
  process.env.CMCP_ASK_TIMEOUT = '2';
  const d = await pol.decide({
    tier: pol.TIER.WRITE, targetBundleId: 'com.google.Chrome',
    describe: 'vaelger "Chrome > Slet browserdata…"', alwaysAsk: true
  });
  process.env.CMCP_MODE = gemtMode; process.env.CMCP_ASK_TIMEOUT = gemtTid;
  check('11c. en farlig menusti spoerger selv i allow', d.asked === true && d.allow === false,
        `asked=${d.asked} allow=${d.allow}`);
}

// ---------------------------------------------------------------- paastand 12
// MCP05 i OWASP's MCP Top 10 hedder "Command Injection and Execution", og
// **43 % af MCP-saarbarhederne i januar-februar 2026 var af den klasse.**
//
// Vi udstiller ingen skal - men vi bygger et AppleScript af tekst der kommer
// fra vaerktoejets argumenter og giver det til osascript. Hvis den tekst kunne
// bryde ud af strengen, havde vi bygget praecis den saarbarhed vi siger vi
// ikke har, i selve samtykke-porten.
//
// ⛔ Min egen foerste kontrol sagde "mulig udbrydning" - et regex jeg skrev i
//    farten. Den var forkert. Det er ikke til at ræsonnere sig til; det skal
//    KOERES. Derfor proever denne nyttelaster der forsoeger at skabe en fil.
//
// MUTATIONSBEVIS 19/9: erstat JSON.stringify(b) med raa sammensaetning
// ('"' + b + '"') -> DUMPET med "NYTTELASTEN KOERTE - teksten broed ud af
// strengen". Filen blev faktisk skabt. Det er indkapslingen der holder, ikke
// heldet.
{
  const cp = await import('child_process');
  const fs = await import('fs');
  const { tmpdir: td12 } = await import('os');
  const MAAL = join(td12(), 'cmcp-injektion-proeve-' + Date.now());
  const onde = [
    'x" & (do shell script "touch ' + MAAL + '") & "',
    'x" & (do shell script "touch ' + MAAL + '") & "y',
    'a\nb" & (do shell script "touch ' + MAAL + '") & "'
  ];
  let koerte = false;
  for (const b of onde) {
    // Samme konstruktion som policy.js - men `return` i stedet for
    // `display dialog`, saa proeven ikke afbryder mennesket.
    const script = ['return', JSON.stringify(b)].join(' ');
    try { cp.execFileSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8', timeout: 20000 }); }
    catch { /* et afvist script er ogsaa "ingen indsproejtning" */ }
    if (fs.existsSync(MAAL)) { koerte = true; break; }
  }
  if (koerte) { try { fs.unlinkSync(MAAL); } catch {} }
  check('12. samtykke-dialogen kan ikke indsproejtes (OWASP MCP05)', !koerte,
        koerte ? 'NYTTELASTEN KOERTE - teksten brød ud af strengen'
               : 'tre nyttelaster indkapslet, intet udfoert');
}

// ---------------------------------------------------------------- paastand 13
// "Der er INGEN vej gennem denne server til at LAESE udklipsholderen."
//
// ⛔ Det er den skarpeste enkeltrisiko i hele produktet. Et menneske kopierer
//    sin adgangskode ud af 1Password; et enkelt laese-kald ville levere den i
//    klartekst til modellen - forbi sloeringen, forbi porten, forbi alt.
//    `computer_paste` skriver kun. At den laeser det gamle indhold for at
//    laegge det tilbage, sker i hukommelsen og returneres aldrig.
{
  const { TOOLS: T13 } = await import(join(ROOT, 'mcp-server', 'tools.js') + '?p13');
  const navne = T13.map(t => t.name);
  const laeser = T13.filter(t =>
    /clipboard|pasteboard/i.test(t.name) ||
    (/clipboard|pasteboard/i.test(t.description || '') &&
     /\bread\b|\bget\b|\breturn/i.test(t.name)));
  check('13. intet vaerktoej laeser udklipsholderen', laeser.length === 0,
        laeser.length ? laeser.map(t => t.name).join(', ') : `${navne.length} vaerktoejer, ingen laeser den`);

  const paste = T13.find(t => t.name === 'computer_paste');
  check('13b. paste er skrivende, altsaa skjult i readonly',
        paste && paste.tier !== 'read', paste ? 'tier=' + paste.tier : 'mangler');
}

// ---------------------------------------------------------------- paastand 14
// Den indsatte tekst maa ALDRIG staa i klartekst i revisionsloggen.
//
// ⛔ Proeven gaar gennem den RIGTIGE server og laeser den FAKTISKE logfil.
//    At kalde scrubArgs() direkte ville proeve mekanismen og ikke ledningen -
//    den fejl har jeg lavet tre gange i dag, og hver gang saa den groen ud.
{
  const fs = await import('fs');
  const { mkdtempSync } = fs;
  const { tmpdir: td14 } = await import('os');
  const dir = mkdtempSync(join(td14(), 'cmcp-paste-'));
  const HEMMELIG = 'INDSAT-MAA-ALDRIG-STAA-I-LOGGEN-7b4e';
  const c = client({ CMCP_MODE: 'readonly', CMCP_STATE_DIR: join(dir, 'state') });
  await c.ready();
  // readonly AFVISER kaldet - og det er netop pointen: selv et afvist kald
  // skriver en revisionslinje, og teksten maa ikke staa i den.
  await c.rpc('tools/call', { name: 'computer_paste', arguments: { text: HEMMELIG } });
  c.srv.kill();
  await new Promise(r => setTimeout(r, 400));

  const f = join(dir, 'state', 'audit.jsonl');
  const log = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const skrev = log.includes('computer_paste');
  const laek = log.includes(HEMMELIG);
  check('14. den indsatte tekst staar ikke i loggen', skrev && !laek,
        !skrev ? 'ingen revisionslinje blev skrevet - proeven beviser intet'
               : (laek ? 'LAEKKET I KLARTEKST' : 'linjen findes, teksten ikke'));
}

// ---------------------------------------------------------------- paastand 15
// Vaerktoejstallet paa ENHVER tekstflade skal matche koden.
//
// ⛔ MAALT 19/9: tallet gik 12 -> 18 -> 19 -> 21 -> 22 -> 23 paa een dag, og
//    HVER gang rettede jeg otte-ni flader i haanden. Tre gange stod der et
//    forkert tal live bagefter - to gange paa GitHubs repo-beskrivelse, som
//    er den flade katalogerne gengiver ordret.
//
//    `release.sh` har en vagt, men den koerer foerst ved udgivelse. Paa en dag
//    hvor tallet aendrer sig fire gange, er det fire chancer for at sende noget
//    forkert ud. Den her koerer ved hver suite.
{
  const { TOOLS: T15 } = await import(join(ROOT, 'mcp-server', 'tools.js') + '?p15');
  const fs15 = await import('fs');
  const N = T15.length;
  const L = T15.filter(t => t.tier === 'read').length;
  const ORD = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
    'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen',
    'nineteen','twenty','twenty-one','twenty-two','twenty-three','twenty-four','twenty-five',
    'twenty-six','twenty-seven','twenty-eight','twenty-nine','thirty'];

  // Alt der ligner en paastand om antal vaerktoejer, paa enhver flade.
  const MOENSTRE = [
    /\b(\d+) tools\b/gi,
    /\b([a-z]+(?:-[a-z]+)?) tools\b/gi,
    /\b(\d+) of them read-only\b/gi,
  ];
  const FLADER = [
    'README.md', 'docs/index.html', 'docs/tools.html', 'docs/llms.txt',
    'docs/llms-install.md', 'docs/docs/capability-matrix/index.html',
  ];
  for (const d of fs15.readdirSync(join(ROOT,'docs','docs'))) {
    if (d.startsWith('install-')) FLADER.push(join('docs','docs',d,'index.html'));
  }

  const forkerte = [];
  for (const f of FLADER) {
    const sti = join(ROOT, f);
    if (!fs15.existsSync(sti)) continue;
    const t = fs15.readFileSync(sti, 'utf8');
    // ⛔ EEN undtagelse, snaever med vilje: forbeholdet om hvad npx leverer i
    //    dag naevner med rette et ANDET tal ("0.1.0, which has 12 tools").
    //    Undtagelsen udloeses af at "0.1.0" staar taet paa - altsaa af noget
    //    UAFHAENGIGT af tallet selv. En undtagelse skrevet i det der proeves,
    //    er et hul; det laerte jeg to gange tidligere i dag.
    const erVersionsforbehold = (tekst, i) =>
      tekst.slice(Math.max(0, i - 90), i + 20).includes('0.1.0');
    for (const m of t.matchAll(/\b(\d+) tools\b/gi)) {
      if (Number(m[1]) !== N && !erVersionsforbehold(t, m.index))
        forkerte.push(`${f}: "${m[0]}" (koden: ${N})`);
    }
    // ⛔ MAALT 19/9: den gamle udgave slog ordet op i listen og sprang over
    //    hvis det ikke stod der. Derfor saa den IKKE at forsiden sagde
    //    "Twenty-twenty-twenty-twenty-five tools" - et ord der ikke findes,
    //    lavet af mit eget rette-script. En vagt der kun kender de RIGTIGE
    //    former, er blind over for det vrøvl der faktisk opstaar.
    //
    //    Nu flages ethvert ord foran "tools" der INDEHOLDER et taltord uden
    //    at vaere det rigtige.
    for (const m of t.matchAll(/\b([a-z][a-z-]*) tools\b/gi)) {
      const ord = m[1].toLowerCase();
      if (ord === ORD[N]) continue;
      const i = ORD.indexOf(ord);
      const ligner_tal = i >= 0 || ORD.slice(1).some(w => ord.includes(w));
      if (ligner_tal) forkerte.push(`${f}: "${m[0]}" (koden: ${ORD[N]})`);
    }
    // ⛔ MAALT 19/9: forbeholdet sagde "The 22 on this page are the source" mens
    //    koden havde 25. Vagten ledte efter "N tools" og saa det ikke. Et tal
    //    uden sit navneord er stadig et tal der kan lyve.
    for (const m of t.matchAll(/\bThe (\d+) on this page\b/gi)) {
      if (Number(m[1]) !== N) forkerte.push(`${f}: "${m[0]}" (koden: ${N})`);
    }
    for (const m of t.matchAll(/\b(\d+) of them read-only\b/gi)) {
      if (Number(m[1]) !== L) forkerte.push(`${f}: "${m[0]}" (laesende: ${L})`);
    }
    for (const m of t.matchAll(/\b([a-z-]+) write tools\b/gi)) {
      const i = ORD.indexOf(m[1].toLowerCase());
      if (i >= 0 && i !== N - L) forkerte.push(`${f}: "${m[0]}" (skrivende: ${N-L})`);
    }
  }
  check('15. vaerktoejstallet stemmer paa alle tekstflader', forkerte.length === 0,
        forkerte.length ? forkerte.slice(0,4).join(' | ') : `${FLADER.length} flader, alle siger ${N}`);

  // ⛔ ET TAL UDEN NAVNE ER ET HUL I MIN EGEN VAGT. MAALT 19/9: efter at have
  //    tilfoejet launch og quit stod der rigtigt "25 vaerktoejer" paa alle
  //    flader - og listerne viste stadig 23 navne. Tallet loej ikke; listen
  //    gjorde. Derfor tjekkes hvert NAVN ogsaa, paa de flader der lister dem.
  // ⛔ FORSIDEN ER TAGET UD 19/9, og det er en bevidst svaekkelse med en grund:
  //    den er skrevet om til almindeligt sprog, saa vaerktoejerne staar som
  //    "se hvad der er der" med de korte navne under. At kraeve fulde
  //    computer_*-navne DER ville tvinge jargon tilbage paa den ene side der
  //    med vilje ikke har den.
  //
  //    Vagtens formaal - at intet vaerktoej er udokumenteret - er intakt:
  //    tools.html er referencen, og README, llms.txt og matricen lister dem
  //    alle. Fire flader, ikke fem.
  const NAVNEFLADER = ['README.md', 'docs/llms.txt',
                       'docs/tools.html', 'docs/docs/capability-matrix/index.html'];
  const mangler = [];
  for (const f of NAVNEFLADER) {
    const sti = join(ROOT, f);
    if (!fs15.existsSync(sti)) continue;
    const t = fs15.readFileSync(sti, 'utf8');
    for (const v of T15) if (!t.includes(v.name)) mangler.push(`${f}: ${v.name}`);
  }
  check('15b. hvert vaerktoej staar ved navn paa listerne', mangler.length === 0,
        mangler.length ? mangler.slice(0,4).join(' | ') : `${NAVNEFLADER.length} lister, alle ${N} navne`);
}

console.log();
if (skips.length) console.log(`SPRUNGET OVER: ${skips.length} (bevist intet - ikke bestaaet)`);
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
