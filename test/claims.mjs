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

// ⛔ 19/9: samtykke-proeverne var opt-in bag CMCP_DIALOGS, fordi de viste aegte
//    bokse. Resultatet var at portens vigtigste tjek naesten aldrig koerte.
//    MAALT i menneskets rigtige revisionslog: 323 spoergsmaal paa to dage, 274
//    ubesvarede - naesten alle fra proevekoersler.
//
//    Nu faar hver klient som standard en ATTRAP for spoergeren. Porten, kaldet
//    og tolkningen af svaret er den rigtige kode; kun vinduet mangler. Med
//    CMCP_DIALOGS=1 bruges det rigtige osascript, saa OS-kontrakten kan maales.

function client(env) {
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')],
    { env: { ...process.env,
             ...(spoergerAttrap ? { CMCP_OSASCRIPT: spoergerAttrap.sti } : {}),
             ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
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
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';
const STILLE = process.env.CMCP_DIALOGS !== '1';
// ⛔ ALTID attrappen her - ogsaa med CMCP_DIALOGS=1. Disse paastande proever
//    VORES logik (hvem spoerges, hvornaar, hvad staar i loggen), og den er
//    fuldt daekket uden et vindue. Lod vi dem bruge det rigtige osascript naar
//    flaget er sat, ville flaget vise SYV bokse i stedet for een - og saa var
//    hele aftenens arbejde spildt paa den ene dag nogen satte det.
//
//    OS-kontrakten - at osascript SELV giver op efter N sekunder - maales ét
//    sted og kun ét: failclosed.mjs med CMCP_DIALOGS=1. Een boks, to sekunder.
const spoergerAttrap = lavFalskSpoerger('udloeb', 'cmcp-claims-spoerger');

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
  console.log('  (spoergsmaalet gaar gennem en attrap - ingen boks, ogsaa med CMCP_DIALOGS=1)');
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
  // Attrappen stiller selv et adgangskodefelt op - usynligt. Uden den blev
  // denne proeve sprunget over hver eneste gang.
  const { lavSikkertFelt } = await import('./falsk-hjaelper.mjs');
  const felt = lavSikkertFelt(25, 'MAA-ALDRIG-RETURNERES-c7f1');
  if (felt) await felt.klar();
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
    // ⛔ Uden denne halvdel kunne 3 bestaa fordi hjaelperen udelader ALT.
    //    Det harmloese felt ved siden af SKAL komme med, ellers maaler proeven
    //    ikke forskellen paa sikkert og usikkert - den maaler bare tavshed.
    const harmloes = nodes.some(n => String(n.value || '').includes('HARMLOES'));
    check('3e. og det harmloese felt ved siden af kom MED',
          !felt || harmloes,
          harmloes ? 'forskellen ligger i feltet, ikke i at alt udelades'
                   : 'ogsaa det harmloese felt manglede - proeven maaler tavshed');
  }
  if (felt) felt.luk();
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
{
  const c = client({ CMCP_MODE: 'allow', CMCP_ASK_TIMEOUT: '2' });
  await c.ready();
  console.log('  (ogsaa gennem attrappen)');
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
  console.log('  (gennem attrappen - ingen boks)');
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
    console.log('  (ogsaa gennem attrappen)');
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
//    kodeordsfelt -> afvist med `secure-field`. MEN proeven her koerte mod hvad
//    der TILFAELDIGVIS laa paa skaermen, og sprang derfor over hver eneste
//    gang. Et kerneloefte, ubevist i hver koersel - og den gamle udgave KLIKKEDE
//    oven i koebet paa menneskets skaerm for at saette fokus.
//
//    Nu stiller proeven selv feltet op i et helt gennemsigtigt vindue og
//    rammer det via tilgaengeligheds-API'et. Ingen mus, ingen pixels, og den
//    koerer hver gang.
{
  const { lavSikkertFelt } = await import('./falsk-hjaelper.mjs');
  const felt10 = lavSikkertFelt(25, 'MAA-ALDRIG-SKRIVES-I-9d2e', true);
  const klar10 = felt10 ? await felt10.klar() : false;
  if (!klar10) {
    skip('10. set_value afviser et sikkert felt', 'attrappen for feltet kunne ikke startes');
  } else {
    const { helperPath } = await import(join(ROOT, 'mcp-server', 'helper.js') + '?sv');
    const HELP = process.env.CMCP_HELPER || helperPath();
    const cp10 = await import('child_process');
    const run10 = (a) => new Promise(res => {
      cp10.execFile(HELP, a, (e, out, err) => {
        const linjer = String(out || err || '').trim().split('\n');
        try { res(JSON.parse(linjer.pop())); } catch { res(null); }
      });
    });

    // Ét sikkert felt, ingen andre - saa soegningen ikke kan ramme forbi.
    const fund = await run10(['find', '--app', 'sikkert-felt', '--role', 'AXTextField', '--limit', '3']);
    const antal = (fund && fund.count) || 0;
    const alleSikre = antal > 0 && (fund.matches || []).every(m => m.secure === true);
    check('10a. attrappens felt er et AEGTE sikkert felt',
          antal === 1 && alleSikre,
          `${antal} felt(er), sikre: ${alleSikre}`);

    const r10 = await run10(['set-value', '--app', 'sikkert-felt', '--role', 'AXTextField',
                             '--text', 'DETTE-MAA-IKKE-LANDE']);
    const afvist = r10 && r10.ok === false;
    check('10. set_value afviser et sikkert felt', !!afvist,
          afvist ? `afvist: ${r10.code || r10.error || 'uden kode'}`
                 : `SKREV I DET: ${JSON.stringify(r10).slice(0, 160)}`);
    check('10b. og afvisningen siger at det er FELTET der er grunden',
          !!afvist && /secure/i.test(JSON.stringify(r10)),
          afvist ? String(r10.code || r10.error || '').slice(0, 60) : 'ikke afvist');
    felt10.luk();
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

// ---------------------------------------------------------------- paastand 16
// Revisionsloggen maa ikke laekke en hemmelighed i ET ENESTE felt - heller
// ikke et der ligger inde i et andet felt.
//
// ⛔ FUNDET AF PANELET 19/9. `scrubArgs` sloerede kun de OEVERSTE felter, og
//    kun dem paa en fast liste. MAALT samme dag: `text` blev sloeret, mens
//    `contains`, `message` og alt indlejret stod i KLARTEKST i loggen.
//    Det gjorde den mest udsatte vej - "vent til feltet indeholder <min
//    adgangskode>" - til en ren afskrift af hemmeligheden paa disken.
//
//    Proeven gaar gennem den RIGTIGE server og laeser den FAKTISKE logfil.
//    Samme grund som paastand 14: at kalde scrubArgs() direkte ville proeve
//    mekanismen og ikke ledningen.
{
  const fs = await import('fs');
  const { mkdtempSync } = fs;
  const { tmpdir: td16 } = await import('os');
  const dir = mkdtempSync(join(td16(), 'cmcp-scrub-'));
  const H = 'DYBT-FELT-MAA-ALDRIG-STAA-I-LOGGEN-3c91';
  const c = client({ CMCP_MODE: 'readonly', CMCP_STATE_DIR: join(dir, 'state') });
  await c.ready();
  // `contains` er den farligste af dem alle: "vent til feltet indeholder X"
  // er praecis hvordan en adgangskode ender i et argument.
  await c.rpc('tools/call', { name: 'computer_find',
    arguments: { app: 'Finder', contains: H, limit: 1 } });
  // `title` er et almindeligt tekstfelt som INGEN farlig-liste ville have
  // gaettet paa - og praecis derfor er det proeven paa at standarden er sikker
  await c.rpc('tools/call', { name: 'computer_set_value',
    arguments: { text: 'harmloes', app: 'Finder', title: H } });
  // og et indlejret felt under et navn vi aldrig har set, som den gamle
  // udgave aldrig saa ned i
  await c.rpc('tools/call', { name: 'computer_press',
    arguments: { app: 'Finder', title: { skjult: H } } });
  c.srv.kill();
  await new Promise(r => setTimeout(r, 400));

  const f = join(dir, 'state', 'audit.jsonl');
  const log = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const skrev = log.includes('computer_find');
  check('16. hemmeligheden staar i INTET felt i loggen', skrev && !log.includes(H),
        !skrev ? 'ingen revisionslinje blev skrevet - proeven beviser intet'
               : (log.includes(H) ? 'LAEKKET I KLARTEKST' : 'begge linjer findes, hemmeligheden ikke'));

  // ⛔ Uden denne halvdel kunne 16 bestaas ved at sloere ALT - en log hvor
  //    intet kan laeses, beviser intet om at handlingerne spores. Loggen skal
  //    stadig kunne besvare "hvad blev gjort, i hvilket program".
  check('16b. loggen kan stadig laeses: handling og program staar der',
        log.includes('computer_set_value') && log.includes('Finder'),
        log.includes('Finder') ? 'begge vaerktoejer + programnavnet staar der'
                               : 'programnavnet blev ogsaa sloeret - loggen er ulaeselig');
}

// ---------------------------------------------------------------- paastand 17
// Et USLOERET skaermbillede er ikke en laesning. Det er den ene handling der
// kan levere en adgangskode i klartekst til modellen.
//
// ⛔ FUNDET AF PANELET 19/9. `computer_screenshot` staar som `read`, og
//    `redact: false` var bare et argument. I readonly - den tilstand man
//    vaelger NAAR man ikke vil have noget skrevet - kunne modellen dermed
//    bede om et billede med adgangskodefelterne synlige, uden at nogen blev
//    spurgt. Sloeringen var frivillig for den der kaldte.
//
//    Rettelsen: `redact: false` loefter kaldet til skrivende og tvinger
//    samtykke. Proeven maaler ledningen, ikke hensigten: readonly skal AFVISE
//    det usloerede kald, og det almindelige kald skal stadig virke.
{
  const fs17 = await import('fs');
  const { mkdtempSync: mk17 } = fs17;
  const { tmpdir: td17 } = await import('os');
  const dir17 = mk17(join(td17(), 'cmcp-usloeret-'));
  const c17 = client({ CMCP_MODE: 'readonly', CMCP_STATE_DIR: join(dir17, 'state') });
  await c17.ready();
  const usloeret = await c17.rpc('tools/call', {
    name: 'computer_screenshot', arguments: { redact: false, scale: 0.1 } });
  const alm = await c17.rpc('tools/call', {
    name: 'computer_screenshot', arguments: { scale: 0.1 } });
  c17.srv.kill();

  const tekst = JSON.stringify(usloeret || {});
  const afvist = /readonly|skrivende|write|afvis|naegt/i.test(tekst) || usloeret?.isError === true;
  check('17. usloeret skaermbillede afvises i readonly', afvist,
        afvist ? 'afvist som skrivende' : 'SLAP IGENNEM: ' + tekst.slice(0, 160));
  const almTekst = JSON.stringify(alm || {});
  check('17b. det sloerede skaermbillede virker stadig i readonly',
        !/readonly|afvis|naegt/i.test(almTekst) && !alm?.isError,
        alm?.isError ? almTekst.slice(0, 160) : 'gik igennem');
}

// ---------------------------------------------------------------- paastand 18
// Ingen tekstflade maa love en signatur binaeren ikke baerer.
//
// ⛔ MAALT 19/9 paa den LEVENDE forside: tre flader sagde "the package ships a
//    SIGNED universal binary". `codesign -v` paa den medsendte binaer svarer
//    "code object is not signed at all"; den baerer kun `Signature=adhoc,
//    linker-signed` uden TeamIdentifier - altsaa det compileren saetter paa af
//    sig selv for at den overhovedet kan koere paa Apple silicon.
//
//    For en laeser betyder "signed" at den kan efterproeves og kommer fra os.
//    Det kunne den ikke. Samme fejlklasse som vaerktoejstallet i paastand 15:
//    en saetning der stod live, og som ingen proeve roerte.
{
  const fs18 = await import('fs');
  const cp18 = await import('child_process');
  const BIN = join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
  let rigtigtSigneret = false;
  if (fs18.existsSync(BIN)) {
    // `codesign -v` er tavs og exit 0 naar signaturen holder. En adhoc/linker-
    // signatur faelder den, og det er praecis forskellen laeseren gaar op i.
    try { cp18.execFileSync('/usr/bin/codesign', ['-v', BIN], { stdio: 'pipe' }); rigtigtSigneret = true; }
    catch { rigtigtSigneret = false; }
  }
  const FLADER = ['docs/index.html', 'README.md', 'mcp-server/README.md', 'llms.txt'];
  const lover = FLADER.filter(f => {
    const sti = join(ROOT, f);
    if (!fs18.existsSync(sti)) return false;
    const t = fs18.readFileSync(sti, 'utf8');
    // kun paastanden om VORES binaer - ikke ordet "signed" hvor som helst
    // ⛔ Foerste udgave af denne vagt faeldede sin egen rettelse: den matchede
    //    ordene "notarized" og "Developer ID" ogsaa i saetningen "not a
    //    Developer ID signature, and not notarized". Samme fejl som huset har
    //    skrevet ned: et ORD kan ikke baere en regel. Nu matches kun det
    //    BEKRAEFTENDE loefte - "signed binary", "is notarized", "Developer ID
    //    signed" - og aldrig en benaegtelse af det.
    return /\bsigned\s+(universal\s+)?binary\b|\bis\s+notarized\b|\bDeveloper\s+ID[- ]signed\b/i
      .test(t.replace(/not\s+(a\s+)?(Developer ID[^.,]*|notarized)/gi, ''));
  });
  check('18. ingen flade lover en signatur binaeren ikke baerer',
        rigtigtSigneret || lover.length === 0,
        rigtigtSigneret ? 'binaeren ER rigtigt signeret - saa maa flader gerne sige det'
          : (lover.length ? 'LOVER SIGNATUR UDEN DAEKNING: ' + lover.join(', ')
                          : `${FLADER.length} flader, ingen lover en signatur (binaer: adhoc)`));
}

// ---------------------------------------------------------------- paastand 19
// I readonly maa INTET vaerktoej kunne rejse en dialog paa menneskets skaerm.
//
// ⛔ FUNDET AF RAADGIVEREN 19/9. `computer_ask_user` sprang porten over med et
//    haardt {allow:true} - begrundelsen var at vaerktoejet "selv er samtykke-
//    oejeblikket", og at det var skjult i readonly. Men listen filtrerer, og
//    kald-haandteringen slaar op paa NAVN: en klient med en cachet liste kunne
//    kalde det og faa en boks op i den ene tilstand hvor produktet lover ikke
//    at roere noget. Skjult er ikke afvist.
//
//    Proeven kalder det VED NAVN, altsaa uden om listen, i readonly - og
//    forventer en afvisning. Den viser derfor ingen dialog og koerer i den
//    stille suite.
{
  const fs19 = await import('fs');
  const { mkdtempSync: mk19 } = fs19;
  const { tmpdir: td19 } = await import('os');
  const dir19 = mk19(join(td19(), 'cmcp-askuser-'));
  // Attrappen for spoergeren: naaede kaldet frem til den, havde porten sluppet
  // det igennem - og paa en maskine uden attrap ville der staa en hvid boks.
  const { lavFalskSpoerger } = await import('./falsk-hjaelper.mjs');
  const spoerger19 = lavFalskSpoerger('ja');
  const c19 = client({ CMCP_MODE: 'readonly', CMCP_STATE_DIR: join(dir19, 'state'),
                       CMCP_OSASCRIPT: spoerger19.sti });
  await c19.ready();
  const r19 = await c19.rpc('tools/call', {
    name: 'computer_ask_user', arguments: { message: 'dette maa ALDRIG vises' } });
  c19.srv.kill();
  await new Promise(r => setTimeout(r, 300));

  const t19 = JSON.stringify(r19 || {});
  const afvist = /readonly|afvist|skrivende/i.test(t19);
  check('19. ask_user afvises i readonly - listen er ikke porten', afvist,
        afvist ? 'afvist paa tilstand' : 'SLAP IGENNEM: ' + t19.slice(0, 200));

  // Og revisionsloggen skal baere afvisningen: en port der afviser uden at
  // skrive det ned, kan ikke efterproeves bagefter.
  const f19 = join(dir19, 'state', 'audit.jsonl');
  const log19 = fs19.existsSync(f19) ? fs19.readFileSync(f19, 'utf8') : '';
  // ⛔ SKYLDIGT MUTATIONSBEVIS: at fjerne readonly-tjekket ville faa serveren
  //    til at naa osascript og vise en RIGTIG dialog paa menneskets skaerm.
  //    Gustav har bedt fire gange om at det stopper, saa beviset er ikke koert.
  //    Det skal koeres SAMMEN med dialog-suiten, den ene gang han siger ja:
  //      1) byt `currentMode() === 'readonly'` ud med `=== 'allow'` i index.js
  //      2) denne proeve skal blive ROED
  //      3) saet den tilbage og bekraeft md5
  //    Indtil da: vagten er groen, men uafproevet. Det staar her, ikke i en
  //    besked der forsvinder.
  // ⛔ Dette ER mutationsbeviset, og det kan nu koeres UDEN en eneste boks.
  //    Fjern readonly-tjekket i index.js, og dette tal bliver 1: kaldet naaede
  //    spoergeren, altsaa ville en rigtig maskine have vist dialogen.
  check('19c. spoergeren blev ALDRIG kaldt - porten stoppede det foer dialogen',
        spoerger19.gangeSpurgt() === 0,
        spoerger19.gangeSpurgt() === 0 ? 'nul forsoeg paa at spoerge'
          : `${spoerger19.gangeSpurgt()} forsoeg - paa en rigtig maskine var det en hvid boks`);

  check('19b. afvisningen staar i revisionsloggen',
        /computer_ask_user/.test(log19) && /denied/.test(log19),
        /denied/.test(log19) ? 'linjen findes med decision=denied' : 'ingen afvisningslinje');
}

// ---------------------------------------------------------------- paastand 20
// Hjaelperen kan mere end serveren udstiller - og det der IKKE er udstillet,
// har ingen port.
//
// ⛔ FUNDET AF RAADGIVEREN 19/9. `cmcp-helper` har en `space`-kommando
//    (main.swift), som skifter Space og dermed tager hele skaermen. Den er
//    aldrig blevet koblet paa et vaerktoej - men den ligger klar, og den dag
//    nogen kobler den paa, faar den ingen port med i koebet, fordi porten
//    doemmer paa vaerktoejets niveau i tools.js.
//
//    Proeven er ikke "slet den". Den er: hvis `space` nogensinde bliver et
//    vaerktoej, skal denne linje tvinge den der gjorde det til at give den et
//    skrivende niveau - ikke lade den glide ind som en laesning.
{
  const { TOOLS: T20 } = await import(join(ROOT, 'mcp-server', 'tools.js') + '?p20');
  const fs20 = await import('fs');
  const sw = join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'main.swift');
  const harSpace = fs20.existsSync(sw) && /case "space":/.test(fs20.readFileSync(sw, 'utf8'));
  const udstillet = T20.filter(t => /space/i.test(t.name));
  const ok = !harSpace || udstillet.length === 0 || udstillet.every(t => t.tier !== 'read');
  check('20. skaerm-skiftet er enten uudstillet eller skrivende', ok,
        !harSpace ? 'hjaelperen har ingen space-kommando'
          : (udstillet.length === 0 ? 'hjaelperen kan skifte Space, men intet vaerktoej naar den'
             : 'udstillet som: ' + udstillet.map(t => `${t.name}=${t.tier}`).join(', ')));
}

// ---------------------------------------------------------------- paastand 21
// Et Space-skift flytter det mennesket KIGGER paa. Det maa spoerge hver gang.
//
// Hele grunden til at vaerktoejet findes: macOS giver hvert fuldskaerms-vindue
// sin egen Space, saa et vindue agenten ikke kan finde, ofte bare staar paa en
// anden. Men prisen er at skiftet flytter menneskets skaerm - og det er ikke en
// handling i et program, det er en handling paa personen. Samme regel som at
// afslutte et program: spoerges der ikke, er det forkert.
//
// Proeven koerer i ALLOW, hvor intet andet spoerger, gennem attrappen for baade
// spoergeren og hjaelperen - saa hverken en dialog eller et Space-skift naar
// menneskets skaerm.
{
  const { lavFalskHjaelper: lfh21 } = await import('./falsk-hjaelper.mjs');
  const h21 = lfh21('cmcp-space');
  const fs21 = await import('fs');
  const { mkdtempSync: mk21 } = fs21;
  const { tmpdir: td21 } = await import('os');
  const d21 = mk21(join(td21(), 'cmcp-space-'));
  const c21 = client({ CMCP_MODE: 'allow', CMCP_ASK_TIMEOUT: '2',
                       CMCP_HELPER: h21.sti, CMCP_STATE_DIR: join(d21, 'state') });
  await c21.ready();
  const r21 = await c21.rpc('tools/call', {
    name: 'computer_space', arguments: { direction: 'right' } });
  c21.srv.kill();
  await new Promise(r => setTimeout(r, 300));

  const log21 = fs21.existsSync(join(d21, 'state', 'audit.jsonl'))
    ? fs21.readFileSync(join(d21, 'state', 'audit.jsonl'), 'utf8') : '';
  const linje = log21.split('\n').filter(l => l.includes('computer_space')).map(l => {
    try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)[0];
  check('21. et Space-skift spoerger selv i allow-tilstand',
        linje && linje.asked === true,
        linje ? `asked=${linje.asked} decision=${linje.decision}` : 'ingen revisionslinje');
  // Og attrappen doemmer: attrappens spoerger svarer "udloeb" = nej, saa
  // skiftet maa ALDRIG have naaet hjaelperen.
  check('21b. og skiftet naaede aldrig maskinen da svaret var nej',
        h21.handlingerNaaedeFrem().length === 0,
        h21.handlingerNaaedeFrem().map(k => k.argv[0]).join(', ') || 'intet naaede frem');
}

// ---------------------------------------------------------------- paastand 22
// Traek-og-slip er en HAAND, ikke en laesning - og det skal koste det samme
// som et klik at bruge den.
//
// ⛔ Hvad der IKKE kan proeves her, sagt hoejt: om traekket faktisk virker i et
//    program. Et traek kraever en modtager, og en modtager kraever at markoeren
//    bevaeger sig paa menneskets skaerm. Gustav har bedt fire gange om at
//    proeverne holder sig fra skaermen, saa den halvdel er UMAALT - og
//    vaerktoejet siger det selv i sit svar: det rapporterer at traekket er
//    SENDT, aldrig at det blev taget imod.
//
//    Det der proeves her er porten og ledningen: at den er skjult i readonly,
//    at argumenterne naar hjaelperen uaendret, og at den ikke kan snige sig
//    forbi som en laesning.
{
  const { TOOLS: T22 } = await import(join(ROOT, 'mcp-server', 'tools.js') + '?p22');
  const drag = T22.find(t => t.name === 'computer_drag');
  check('22. traek er skrivende, altsaa skjult i readonly',
        drag && drag.tier !== 'read', drag ? 'tier=' + drag.tier : 'mangler');

  const { lavFalskHjaelper: lfh22 } = await import('./falsk-hjaelper.mjs');
  const h22 = lfh22('cmcp-drag');
  const fs22 = await import('fs');
  const { mkdtempSync: mk22 } = fs22;
  const { tmpdir: td22 } = await import('os');
  const d22 = mk22(join(td22(), 'cmcp-drag-'));

  // readonly: maa slet ikke naa hjaelperen
  const cRO = client({ CMCP_MODE: 'readonly', CMCP_HELPER: h22.sti,
                       CMCP_STATE_DIR: join(d22, 'ro') });
  await cRO.ready();
  await cRO.rpc('tools/call', { name: 'computer_drag',
    arguments: { fromX: 10, fromY: 20, toX: 30, toY: 40 } });
  cRO.srv.kill();
  check('22b. i readonly naar traekket ALDRIG maskinen',
        h22.handlingerNaaedeFrem().length === 0,
        h22.handlingerNaaedeFrem().map(k => k.argv[0]).join(', ') || 'intet naaede frem');

  // allow: naar frem, og argumenterne skal vaere dem agenten bad om
  const cA = client({ CMCP_MODE: 'allow', CMCP_HELPER: h22.sti,
                      CMCP_STATE_DIR: join(d22, 'allow') });
  await cA.ready();
  await cA.rpc('tools/call', { name: 'computer_drag',
    arguments: { fromX: 11, fromY: 22, toX: 33, toY: 44, steps: 7, holdMs: 150 } });
  cA.srv.kill();
  await new Promise(r => setTimeout(r, 300));
  const kald = h22.kald().filter(k => k.argv[0] === 'drag').pop();
  const a = kald ? kald.argv.join(' ') : '';
  const rigtigt = /--from-x 11/.test(a) && /--from-y 22/.test(a)
               && /--to-x 33/.test(a) && /--to-y 44/.test(a)
               && /--steps 7/.test(a) && /--hold-ms 150/.test(a);
  check('22c. og argumenterne naar hjaelperen uaendret', rigtigt,
        rigtigt ? 'alle seks tal kom igennem' : (a || 'intet drag-kald'));
}

// ---------------------------------------------------------------- paastand 23
// Dock'en og menulinjens statusikoner skal kunne findes.
//
// ⛔ MAALT 19/9: de har NUL vinduer. Deres indhold haenger direkte paa
//    programmet - Dock'en har 32 AXDockItem under en AXList, Kontrolcenter har
//    9 AXMenuBarItem under en AXMenuBar. Saa laenge gennemloebet kun gik ned
//    gennem VINDUER, var alt uden for et vindue usynligt: wifi, uret,
//    batteriet og hvert eneste program i Dock'en.
//
//    Proeven er ren laesning - der trykkes ikke paa noget.
{
  const { helperPath: hp23 } = await import(join(ROOT, 'mcp-server', 'helper.js') + '?p23');
  const HELP23 = process.env.CMCP_HELPER || hp23();
  const cp23 = await import('child_process');
  const run23 = (a) => new Promise(res => {
    cp23.execFile(HELP23, a, (e, out) => {
      try { res(JSON.parse(String(out).trim().split('\n').pop())); } catch { res(null); }
    });
  });

  const dock = await run23(['find', '--app', 'com.apple.dock', '--role', 'AXDockItem', '--limit', '5']);
  check('23. Dock\'ens ikoner kan findes', (dock && dock.count > 0) === true,
        dock ? `${dock.count} ikon(er)` : 'intet svar fra hjaelperen');

  const cc = await run23(['find', '--app', 'com.apple.controlcenter', '--role', 'AXMenuBarItem', '--limit', '9']);
  const navne = ((cc && cc.matches) || []).map(m => m.name || '').join(' ');
  check('23b. menulinjens statusikoner kan findes', (cc && cc.count > 0) === true,
        cc ? `${cc.count} ikon(er): ${navne.slice(0, 60)}` : 'intet svar');

  // ⛔ Uden denne halvdel kunne 23 bestaa paa en faldbag der returnerer selve
  //    programmet og intet andet. Der skal vaere noget MAN KAN TRYKKE PAA.
  const trykbare = ((dock && dock.matches) || []).filter(m => m.pressable === true).length;
  check('23c. og de kan faktisk trykkes paa', trykbare > 0,
        `${trykbare} af ${(dock && dock.count) || 0} kan trykkes`);
}

// ---------------------------------------------------------------- paastand 24
// "Gem / Gem ikke" - det ark et menneske moeder ved hver lukning med ugemt
// arbejde. Kan agenten naa knapperne i det?
//
// ⛔ Spoergsmaalet stod UBESVARET paa listen, fordi der aldrig laa et ark paa
//    maskinen, og fordi det at fremkalde et ville tage menneskets skaerm.
//    Attrappen stiller selv arket op - baade foraeldrevinduet og arket er
//    gennemsigtige, saa der er intet at se.
//
//    Og det er ikke et spoergsmaal om bekvemmelighed: et ark kan svare "Gem
//    ikke" paa menneskets vegne og smide arbejde vaek. Derfor maales BAADE at
//    agenten kan naa det, og at readonly naegter at roere det.
{
  const { lavArk } = await import('./falsk-hjaelper.mjs');
  const ark = lavArk(25);
  const klar24 = ark ? await ark.klar() : false;
  if (!klar24) {
    skip('24. et Gem/Gem ikke-ark kan naas', 'attrappen for arket kunne ikke startes');
  } else {
    const { helperPath: hp24 } = await import(join(ROOT, 'mcp-server', 'helper.js') + '?p24');
    const HELP24 = process.env.CMCP_HELPER || hp24();
    const cp24 = await import('child_process');
    const run24 = (a) => new Promise(res => {
      cp24.execFile(HELP24, a, (e, out) => {
        try { res(JSON.parse(String(out).trim().split('\n').pop())); } catch { res(null); }
      });
    });

    const sheet = await run24(['find', '--app', 'ark', '--role', 'AXSheet', '--limit', '2']);
    check('24. arket selv kan findes', (sheet && sheet.count > 0) === true,
          sheet ? `${sheet.count} ark` : 'intet svar');

    // En agent leder efter ORDENE, ikke efter en position.
    const gemIkke = await run24(['find', '--app', 'ark', '--contains', 'Gem ikke', '--limit', '3']);
    const traef = ((gemIkke && gemIkke.matches) || []).filter(m => m.pressable === true);
    check('24b. og "Gem ikke" kan slaas op ved navn og trykkes',
          traef.length === 1 && traef[0].name === 'Gem ikke',
          traef.length ? `${traef.length} traef: ${traef[0].name}` : 'ikke fundet');

    // ⛔ Modvaegten: et ark kan smide arbejde vaek. I readonly skal det vaere
    //    uroerligt - ellers er "kan intet skrive" ikke sandt netop dér hvor det
    //    koster mest.
    const { lavFalskHjaelper: lfh24 } = await import('./falsk-hjaelper.mjs');
    const h24 = lfh24('cmcp-ark');
    const fs24 = await import('fs');
    const { mkdtempSync: mk24 } = fs24;
    const { tmpdir: td24 } = await import('os');
    const c24 = client({ CMCP_MODE: 'readonly', CMCP_HELPER: h24.sti,
                         CMCP_STATE_DIR: join(mk24(join(td24(), 'cmcp-ark-')), 'state') });
    await c24.ready();
    const r24 = await c24.rpc('tools/call', {
      name: 'computer_press', arguments: { app: 'ark', contains: 'Gem ikke' } });
    c24.srv.kill();
    const afvist24 = /readonly|afvist|skrivende/i.test(JSON.stringify(r24 || {}));
    check('24c. og i readonly kan arket IKKE roeres',
          afvist24 && h24.handlingerNaaedeFrem().length === 0,
          afvist24 ? 'afvist, og intet naaede hjaelperen' : 'SLAP IGENNEM');
    ark.luk();
  }
}

// ---------------------------------------------------------------- paastand 25
// Sloejfe-vaernet: en agent der goer det samme igen og igen, stoppes - og en
// der arbejder lovligt, stoppes IKKE.
//
// ⛔ Anden halvdel er den vigtige. Et vaern der fyrer paa lovlig gentagelse er
//    vaerre end intet vaern: saa laerer den der bygger ovenpaa at slaa det fra.
//    At rulle ti gange det samme stykke, eller trykke pil-ned tyve gange, er
//    praecis hvad et menneske goer - derfor er rulning, taster og skrivning
//    undtaget, og derfor maales det her.
{
  const { lavFalskHjaelper: lfh25 } = await import('./falsk-hjaelper.mjs');
  const h25 = lfh25('cmcp-sloejfe');
  const fs25 = await import('fs');
  const { mkdtempSync: mk25 } = fs25;
  const { tmpdir: td25 } = await import('os');
  const c25 = client({ CMCP_MODE: 'allow', CMCP_HELPER: h25.sti,
                       CMCP_STATE_DIR: join(mk25(join(td25(), 'cmcp-sloejfe-')), 'state') });
  await c25.ready();

  // 12 identiske klik. Graensen er 10, saa de sidste skal afvises.
  let afvist = 0, igennem = 0;
  for (let i = 0; i < 12; i++) {
    const r = await c25.rpc('tools/call', {
      name: 'computer_click', arguments: { x: 400, y: 400 } });
    if (/sloejfe|gange paa under et minut/i.test(JSON.stringify(r || {}))) afvist++; else igennem++;
  }
  check('25. tolv identiske klik stoppes inden alle tolv naar maskinen',
        afvist >= 2 && igennem <= 10, `${igennem} igennem, ${afvist} afvist`);
  check('25b. og afvisningen fortaeller hvad man skal goere i stedet',
        afvist > 0, afvist ? 'beder om et skaermbillede eller computer_find' : 'ingen afvisning');

  // ⛔ MODVAEGTEN: det samme antal rulninger maa IKKE stoppes.
  let rulIgennem = 0;
  for (let i = 0; i < 12; i++) {
    const r = await c25.rpc('tools/call', {
      name: 'computer_scroll', arguments: { dy: -3 } });
    if (!/sloejfe|gange paa under et minut/i.test(JSON.stringify(r || {}))) rulIgennem++;
  }
  check('25c. men tolv ens rulninger gaar fri - lovlig gentagelse spaerres ikke',
        rulIgennem === 12, `${rulIgennem} af 12 kom igennem`);

  // Og et klik et ANDET sted er ikke den samme handling.
  const andet = await c25.rpc('tools/call', {
    name: 'computer_click', arguments: { x: 401, y: 400 } });
  check('25d. et klik et andet sted er ikke samme handling',
        !/sloejfe/i.test(JSON.stringify(andet || {})), 'én punkts forskel nulstiller taelleren');
  c25.srv.kill();
}

// ---------------------------------------------------------------- paastand 26
// KUN ÉT sted i hele suiten maa kunne vise en aegte dialog.
//
// ⛔ Grunden staar i menneskets egen revisionslog: 323 spoergsmaal paa to dage,
//    274 ubesvarede, naesten alle fra proevekoersler. Han bad fire gange om at
//    det stoppede. Vagten er billig og forhindrer at det sniger sig ind igen -
//    for det GJORDE det: efter at attrappen var bygget, stod der stadig i
//    loggen at fire "AEGTE dialoger" blev vist, fordi beskeden fulgte FLAGET i
//    stedet for virkeligheden. Beskeden loej; boksene kom ikke. Naeste gang
//    kunne det vaere omvendt.
{
  const fs26 = await import('fs');
  const filer = fs26.readdirSync(join(ROOT, 'test')).filter(f => f.endsWith('.mjs'));
  const syndere = [];
  for (const f of filer) {
    if (f === 'failclosed.mjs' || f === 'falsk-hjaelper.mjs') continue;
    const t = fs26.readFileSync(join(ROOT, 'test', f), 'utf8');
    const spawner = /mcp-server', 'index\.js'/.test(t);
    if (!spawner) continue;
    // ⛔ Moenstrene bygges af stumper. Foerste udgave var skrevet som literale
    //    regexer, og saa matchede vagten SIN EGEN kildetekst - den faeldede
    //    claims.mjs paa den linje der udfoerer tjekket. Samme cirkulaere fejl
    //    som to andre vagter i aften: en regel formuleret i de ord den leder
    //    efter, kan ikke laese filen den selv staar i.
    const N_OSA = 'CMCP_' + 'OSASCRIPT';
    const N_FLAG = 'CMCP_' + 'DIALOGS';
    const N_ATTRAP = 'lavFalsk' + 'Spoerger';
    if (!t.includes(N_OSA)) { syndere.push(`${f}: saetter aldrig ${N_OSA}`); continue; }
    const betinget = new RegExp('(' + N_FLAG + '|STILLE)[^\\n]*\\?[^\\n]*' + N_ATTRAP);
    if (betinget.test(t)) syndere.push(`${f}: attrappen er betinget af ${N_FLAG}`);
  }
  check('26. kun fejl-lukket-proeven kan vise en aegte dialog', syndere.length === 0,
        syndere.length ? syndere.join(' | ')
                       : `${filer.length} proevefiler gennemgaaet, ingen anden kan vise en boks`);

  // Samme forholdsregel: ordet bygges, saa tjekket ikke finder sig selv.
  const cl = fs26.readFileSync(join(ROOT, 'test', 'claims.mjs'), 'utf8');
  const ORD = 'AEGTE' + ' dialog';
  const lover = cl.split('\n').some(l => l.includes('console.log') && l.includes(ORD));
  check('26b. og ingen besked her paastaar en aegte dialog', !lover,
        lover ? 'en besked lover en boks der ikke kommer' : 'teksten passer til hvad der sker');
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
  // ⛔ FUNDET AF RAADGIVEREN 20/9, og det var et hul af praecis den klasse denne
  //    vagt findes for at lukke. Listen var HAANDHOLDT: tolv filer, mens docs/
  //    havde syvogtyve. Fire levende sider sagde "All 18 tools" og "All 22
  //    tools" - 404-siden, to use-case-sider og en learn-side - og llms.txt,
  //    som er den fil AI-crawlere laeser, sagde "The 22 described below".
  //    Vagten svarede "12 flader, alle siger 27" og var teknisk sand.
  //
  //    En liste nogen skal huske at udvide, ER hullet. Nu findes fladerne i
  //    stedet: alt tekst i docs/ plus de to README'er. En ny side er daekket
  //    den dag den skrives, ikke den dag nogen husker den.
  const FLADER = ['README.md', 'mcp-server/README.md'];
  (function gaaIgennem(mappe) {
    for (const navn of fs15.readdirSync(join(ROOT, mappe), { withFileTypes: true })) {
      const sti = join(mappe, navn.name);
      if (navn.isDirectory()) { gaaIgennem(sti); continue; }
      if (/\.(html|md|txt)$/.test(navn.name)) FLADER.push(sti);
    }
  })('docs');

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
