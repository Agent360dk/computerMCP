// Proever for de paastande sitet og README'en staar paa.
//
// De var alle sande i koden da de blev skrevet. Forskellen paa "sand i dag"
// og "bliver ved med at vaere sand" er en proeve. Et sikkerhedsloefte uden
// proeve er en kommentar.
import { spawn } from 'child_process';
import { readFileSync, existsSync, mkdtempSync} from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir, tmpdir } from 'os';

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

// ⛔ FUNDET AF RAADGIVEREN 20/9, og det var MIN egen fejl fra i gaar der ikke
//    var faerdig. Jeg rettede `run-all.sh` til at give suiten sin egen mappe og
//    skrev at forureningen var stoppet. Den var ikke: koerer man en proevefil
//    DIREKTE - `node test/claims.mjs`, som jeg gjorde snesevis af gange i dag -
//    arvede den menneskets rigtige log igen. MAALT: 36 nye fremmede poster i
//    hans log kl. 06:15Z i morges. Alle mine.
//
//    Rettelsen hoerer hjemme HER, ikke i suiten: enhver klient faar sin egen
//    mappe medmindre en er givet. Saa kan ingen indgang til proeverne skrive i
//    menneskets log, uanset hvordan de startes.
const EGEN_LOG = mkdtempSync(join(tmpdir(), 'cmcp-proevelog-'));

function client(env) {
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')],
    { env: { ...process.env,
             CMCP_STATE_DIR: EGEN_LOG,
             // ⛔ Baggrund er STANDARD siden 20/9. Proeverne maaler hele
             // produktet - ogsaa skaerm-vejen - men gennem attrapper, saa
             // intet sker. De fravaelger derfor bevidst; paastand 29 slaar
             // den udtrykkeligt TIL igen.
             CMCP_BACKGROUND: '0',
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
        r.result?.isError === true && /Refused:/.test(txt),
        txt.split('\n')[0]);

  // Og modstykket: et harmloest program spoerger IKKE i allow-tilstand.
  // Uden dette tjek ville "afvis altid" ogsaa bestaa proeve 1.
  const r2 = await c.rpc('tools/call', { name: 'computer_move', arguments: { x: 900, y: 500 } });
  // Slaar opslaget af det forreste program fejl, er maalet UKENDT, og saa
  // spoerger porten med rette (fail-closed). Det er ikke det denne linje maaler,
  // saa den springer over i stedet for at dumpe paa en travl maskine.
  const t2 = r2.result?.content?.[0]?.text || '';
  if (r2.result?.isError === true && /said no, or did not answer/.test(t2)) {
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
  // ⛔ Uden `app` gennemgaas ALLE programmer, og med 1.500 noder som loft naaede
  //    den ikke altid attrappens felt - proeven flakkede mellem groen og
  //    "sprunget over" paa uaendret kode. Et instrument der svinger, er forkert
  //    stillet: naar proeven selv stiller feltet op, skal den ogsaa kigge dér.
  const r = await c.rpc('tools/call', {
    name: 'computer_inspect',
    arguments: { ...(felt ? { app: 'sikkert-felt' } : {}), depth: 14, limit: 1500 } });
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
  // Teksten er engelsk siden 20/9. Proeven maaler MENINGEN - et tal og en
  // enhed - ikke de danske ord den blev skrevet med.
  const m = txt.match(/([\d.]+) pixels per point/);
  // ⛔ TREDJE STED med samme fejlklasse 19/9 (de to andre er i server-e2e.mjs).
  //    Optagelsen rammer 45-sekunders-loftet naar maskinen er belastet - maalt
  //    paa load 32 med 54 MB fri RAM - og saa dumper et tjek om MAALESTOKKEN
  //    paa at hjaelperen aldrig svarede. En hjaelper der ikke svarede, siger
  //    intet om hvad svaret ville have indeholdt.
  //
  //    Tre steder med to linjer hver er ikke et faelles modul vaerd; bliver det
  //    et fjerde, er det.
  const stalled = !m && /helper-timeout|did not answer within/i.test(txt);
  if (stalled) {
    skip('3b. skaermbilledet oplyser maalestokken', 'hjaelperen svarede ikke - maskinen, ikke koden (bevist intet)');
    skip('3c. maalestokken er brugbar', 'ingen optagelse at bedoemme (bevist intet)');
    skip('3d. svaret siger at klik regner i punkter', 'ingen optagelse at bedoemme (bevist intet)');
  } else {
  check('3b. skaermbilledet oplyser maalestokken', !!m, txt.slice(0, 90));
  if (m) {
    const f = Number(m[1]);
    check('3c. maalestokken er brugbar', f > 0 && f < 10, `faktor ${f}`);
    check('3d. svaret siger at klik regner i punkter', /works in POINTS/.test(txt));
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
        r.result?.isError === true && /Refused:/.test(txt), txt.split('\n')[0]);

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
  const { ALWAYS_ASK_APPS, SPOERG_PR_SESSION } = await import(join(ROOT, 'mcp-server', 'policy.js'));

  // 6a. Listerne er bundle-ID'er. Det er DERFOR oversaettelsen er baerende.
  //     AEndrer nogen den beslutning, skal denne linje tvinge dem til at sige det.
  //
  //     ⛔ 22/9: listen blev DELT. Adgangskode-programmer spoerger hver gang;
  //     terminaler og editorer spoerger én gang pr. session. Begge lister skal
  //     have formen, ellers rammer oversaettelsen kun den ene.
  const alleNavne = [...ALWAYS_ASK_APPS, ...SPOERG_PR_SESSION];
  const udenPunktum = alleNavne.filter(x => !x.includes('.'));
  check('6a. begge spoerg-lister er paa bundle-ID-formen',
        udenPunktum.length === 0
        && SPOERG_PR_SESSION.has('com.apple.Terminal')
        && !SPOERG_PR_SESSION.has('Terminal')
        && ALWAYS_ASK_APPS.has('com.apple.keychainaccess'),
        udenPunktum.length ? 'uden punktum: ' + udenPunktum.join(', ')
                           : `${ALWAYS_ASK_APPS.size} altid + ${SPOERG_PR_SESSION.size} pr. session`);

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
    // ⛔ MAALT 23/9: her stod `AUDIT` - maskinens RIGTIGE log. Men klienten i
    //    denne proeve skriver til EGEN_LOG. Proeven laeste altsaa en anden fil
    //    end den serveren skrev i, og bestod naar den rigtige logs sidste
    //    press-linje tilfaeldigvis havde et target. Samme fejlklasse som et
    //    doedt trae: instrumentet pegede et andet sted end maalingen.
    const EGEN_AUDIT = join(EGEN_LOG, 'audit.jsonl');
    let line = null;
    if (existsSync(EGEN_AUDIT)) {
      line = readFileSync(EGEN_AUDIT, 'utf8').trim().split('\n').slice(-8)
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
  const foerBg = process.env.CMCP_BACKGROUND;
  process.env.CMCP_MODE = 'allow';
  process.env.CMCP_ASK_TIMEOUT = '2';
  // Baggrund er standard siden 20/9; denne paastand maaler dialog-vejen.
  process.env.CMCP_BACKGROUND = '0';
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
    // ⛔ 24/9: attrappen meldte «klar», proeven ventede FAST 300 ms og soegte saa
    //    - og under en fuld suite var tilgaengeligheds-traeet ikke bygget endnu:
    //    «0 felt(er)». Femte proeve samme dag der ventede paa et tidspunkt i
    //    stedet for et udfald. Nu ventes der paa feltet, op til 10 sek. Kommer
    //    det aldrig, falder 10a stadig - med den rigtige grund.
    let fund = null;
    const frist10 = Date.now() + 60_000;   // tid, ikke antal (load 15-30 maalt 24/9)
    while (Date.now() < frist10) {
      fund = await run10(['find', '--app', 'sikkert-felt', '--role', 'AXTextField', '--limit', '3']);
      if (fund && fund.count > 0) break;
      await new Promise(r => setTimeout(r, 500));
    }
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
  const gemtBg = process.env.CMCP_BACKGROUND;
  process.env.CMCP_MODE = 'allow';
  process.env.CMCP_ASK_TIMEOUT = '2';
  process.env.CMCP_BACKGROUND = '0';
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
  // ⛔ 20/9: her stod at programNAVNET skulle staa i loggen. Det goer det ikke
  //    laengere, og det er med vilje: `app` er modellens ord, og en
  //    indsproejtning kunne laegge en hemmelighed der. Loggen svarer i stedet
  //    paa programmet via `target`, som SERVEREN selv har slaaet op - et
  //    rigtigt bundle-id. Proeven maaler nu det felt der baerer sandheden.
  const harMaal = /"target":"com\.apple\.finder"/.test(log);
  check('16b. loggen kan stadig laeses: handling og program staar der',
        log.includes('computer_set_value') && harMaal,
        harMaal ? 'vaerktoejerne staar der, og programmet via serverens eget target'
                : 'hverken programnavn eller target - loggen er ulaeselig');
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
  const afvist = /read-only|refused|write tool/i.test(tekst) || usloeret?.isError === true;
  check('17. usloeret skaermbillede afvises i readonly', afvist,
        afvist ? 'afvist som skrivende' : 'SLAP IGENNEM: ' + tekst.slice(0, 160));
  const almTekst = JSON.stringify(alm || {});
  check('17b. det sloerede skaermbillede virker stadig i readonly',
        !/read-only|refused/i.test(almTekst) && !alm?.isError,
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
  const afvist = /read-only|refused|write tool/i.test(t19);
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
  await h21.roligt();
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
  await h22.roligt();
  check('22b. i readonly naar traekket ALDRIG maskinen',
        h22.handlingerNaaedeFrem().length === 0,
        h22.handlingerNaaedeFrem().map(k => k.argv[0]).join(', ') || 'intet naaede frem');

  // allow: naar frem, og argumenterne skal vaere dem agenten bad om
  // ⛔ 22/9: proevens udfald afhang af hvilket program MENNESKET havde forrest.
  //    `computer_drag` navngiver intet program, saa maalet bliver det forreste
  //    - og da editorer kom paa session-listen, blev det pludselig et program
  //    der spoerger. Med den almindelige attrap (der lader dialogen udloebe)
  //    blev kaldet afvist, og «argumenterne naar hjaelperen» faldt af en grund
  //    der intet havde med argumenter at goere.
  //
  //    En proeve hvis svar afhaenger af hvad der tilfaeldigvis staar forrest
  //    paa en anden persons skaerm, maaler ikke koden. Den her giver samtykke,
  //    saa den kan naa det den paastaar at maale.
  const jaAttrap22 = lavFalskSpoerger('ja', 'cmcp-claims22-ja');
  const cA = client({ CMCP_MODE: 'allow', CMCP_BACKGROUND: '0', CMCP_HELPER: h22.sti,
                      CMCP_OSASCRIPT: jaAttrap22.sti,
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
    const afvist24 = /read-only|refused|write tool/i.test(JSON.stringify(r24 || {}));
    await h24.roligt();
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
    if (/the same action has now been tried/i.test(JSON.stringify(r || {}))) afvist++; else igennem++;
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
    if (!/the same action has now been tried/i.test(JSON.stringify(r || {}))) rulIgennem++;
  }
  check('25c. men tolv ens rulninger gaar fri - lovlig gentagelse spaerres ikke',
        rulIgennem === 12, `${rulIgennem} af 12 kom igennem`);

  // Og et klik et ANDET sted er ikke den samme handling.
  const andet = await c25.rpc('tools/call', {
    name: 'computer_click', arguments: { x: 401, y: 400 } });
  // ⛔ 25d ledte foer efter ordet 'sloejfe' i en afvisning der er ENGELSK -
  //    den kunne aldrig blive roed. Nu maales den paa den tekst der faktisk
  //    skrives, og paa at klikket NAAEDE maskinen.
  check('25d. et klik et andet sted er ikke samme handling',
        !/the same action has now been tried/i.test(JSON.stringify(andet || {})),
        'én punkts forskel nulstiller taelleren');
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
    // ⛔ 23/9: den skaerpede vagt fandt et hul den gamle havde: `touchid-manuel.mjs`
    //    skrev stien som EEN streng (`'mcp-server/index.js'`), saa det gamle
    //    moenster - der ledte efter to strenge - havde aldrig set den. Den
    //    starter en rigtig server UDEN attrap, med vilje: den maaler Touch ID
    //    med et menneskes finger. Derfor er den undtaget VED NAVN - og
    //    undtagelsen er selv-tjekkende: staar den nogensinde i suiten, falder
    //    paastanden. En undtagelse ingen kontrollerer, er et hul.
    if (f === 'failclosed.mjs' || f === 'falsk-hjaelper.mjs') continue;
    if (f === 'touchid-manuel.mjs') {
      const runall = fs26.readFileSync(join(ROOT, 'test', 'run-all.sh'), 'utf8');
      if (runall.includes('touchid-manuel')) syndere.push(`${f}: er manuel, men staar i run-all.sh`);
      continue;
    }
    const t = fs26.readFileSync(join(ROOT, 'test', f), 'utf8');
    // ⛔ 23/9: vagten var for BRED. Den flagede enhver fil der NAEVNTE stien
    //    til serveren - ogsaa `test/vagt.mjs`, som kun LAESER index.js for at
    //    se om foraeldre-vagten bliver startet. En falsk alarm paa en vagt er
    //    ikke gratis: den naeste der rammer den, slaar vagten fra i stedet for
    //    at laese den.
    //
    //    En dialog kan kun komme fra en KOERENDE server. En fil starter en,
    //    naar den koerer NODE paa index.js. Nye maader at starte serveren paa
    //    skal tilfoejes her - det er prisen for at vagten ikke lyver.
    const spawner = new RegExp(
      "(spawn|spawnSync|exec|execFile|execFileSync|fork)\\s*\\(\\s*" +
      "(['\"]node['\"]|process\\.execPath)[^\\n]*index\\.js").test(t);
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

// ---------------------------------------------------------------- paastand 27
// Alt mennesket og modellen kan LAESE, skal vaere paa engelsk.
//
// ⛔ Sitet er 100 % engelsk. Samtykke-dialogen sagde "En agent vil styre din
//    Mac ... Nej / Ja". En amerikansk udvikler installerer fra en engelsk side,
//    faar en dansk boks han ikke kan laese, og klikker Ja uden at vide hvad han
//    giver lov til. Informeret samtykke paa et sprog brugeren ikke forstaar, ER
//    IKKE SAMTYKKE - og samtykket er hele produktet.
//
// ⛔ ANDEN UDGAVE, og den foerste var STRUKTURELT BLIND. Den fandt strenge med
//    et regex: /"[^"]{12,}"/. Paa enhver linje med TO strenge parrede den dem
//    forkert - `Out.fail("--app mangler", code: "bad-args")` gav den
//    `", code: "` , altsaa KODEN mellem strengene, mens selve beskeden aldrig
//    blev set. Og 12-tegns-graensen sprang alt kort over.
//    MAALT med en aegte tegn-for-tegn-laeser: 36 danske strenge naaede stadig
//    mennesket - hvert eneste svar paa et klik, et tastetryk, et skaermbillede.
//    Vagten sagde groent hele tiden.
//
//    Kommentarer i koden er og bliver danske. Reglen gaelder det der forlader
//    serveren.
{
  const fs27 = await import('fs');

  // En rigtig strengfinder: tegn for tegn, med escape-haandtering. Et regex
  // kan ikke parre anfoerselstegn korrekt, og det var praecis fejlen.
  const strengeI = (linje) => {
    const ud = []; let i = 0;
    while (i < linje.length) {
      const c = linje[i];
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1, s2 = '';
        while (j < linje.length) {
          // ⛔ Bevar backslashen foran en Swift-interpolation. Foerste udgave
          //    smed den vaek som en almindelig escape - og saa var maerket
          //    borte inden interpolationen kunne fjernes, saa danske
          //    VARIABELNAVNE blev laest som dansk TEKST.
          if (linje[j] === '\\') {
            s2 += (linje[j + 1] === '(' ? '\\(' : (linje[j + 1] || ''));
            j += 2; continue;
          }
          if (linje[j] === c) break;
          s2 += linje[j]; j++;
        }
        if (j < linje.length) ud.push(s2);
        i = j + 1; continue;
      }
      i++;
    }
    return ud;
  };

  const STAMMER = ['ikke', 'foer', 'mennesk', 'vaerktoej', 'afvist', 'skaerm',
    'adgangskode', 'tilladelse', 'handling', 'sloejfe', 'taster', 'spoerg',
    'koerer', 'giver', 'mangler', 'findes', 'programmet', 'vinduet', 'klikk',
    'punkter', 'skrev', 'trykkede', 'flyttet', 'fandt', 'passer', 'indsat',
    'startet', 'ukendt', 'praecis', 'sloer', 'tastetryk', 'graense', 'svarede',
    'nej', 'annuller', 'faerdig', 'tilladt'];

  // ⛔ 23/9: listen var haandholdt, og de fire nyeste server-filer stod ikke
  //    paa den. En dansk saetning i godkend.js eller status.js - som begge
  //    skriver tekst mennesket LAESER i ikonet - ville vagten aldrig se.
  //    En liste nogen skal huske at udvide, er hullet. Alle .js i mcp-server.
  const FILER27 = [...fs27.readdirSync(join(ROOT, 'mcp-server'))
      .filter(f2 => f2.endsWith('.js'))
      .map(f2 => `mcp-server/${f2}`),
    ...['Capture', 'Accessibility', 'Permissions', 'Input', 'main']
        .map(n2 => `helper/Sources/cmcp-helper/${n2}.swift`)]
    .filter(f2 => fs27.existsSync(join(ROOT, f2)));

  const syndere = [];
  for (const fil of FILER27) {
    fs27.readFileSync(join(ROOT, fil), 'utf8').split('\n').forEach((l, i) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      // ⛔ 23/9: vagten faeldede `import { taelOgTael } from './sloejfe.js'`.
      //    Et FILNAVN er ikke tekst et menneske laeser i et svar - husets egne
      //    moduler hedder programlaas.js, godkend.js, sloejfe.js med vilje.
      //    En falsk positiv laerer én at se bort fra roede linjer, saa import-
      //    og require-linjer hoerer ikke til her.
      if (/^(import|export)\b.*\bfrom\b/.test(t) || /\brequire\(/.test(t)) return;
      for (const str of strengeI(l)) {
        if (str.length < 6) continue;
        // Et FILNAVN er ikke tekst nogen laeser i et svar. Husets egne filer
        // hedder programlaas.js, godkend.js, sloejfe.jsonl - med vilje.
        if (/^[\w.\-\/]+\.(js|mjs|jsonl|json|sock|pid|lock|tmp|swift|app|png|sh|md)$/.test(str.trim())) continue;
        // Interpolationer er VARIABELNAVNE, ikke tekst mennesket laeser.
        //
        // Foerste udgave brugte [^)]* til Swifts interpolation - og det stopper
        // ved den FOERSTE parentes, saa et indlejret kald efterlod de danske
        // variabelnavne synlige. Vagten faeldede to saetninger der er engelske.
        // En falsk positiv i en vagt er ikke harmloes: den laerer een at se
        // bort fra roede linjer.
        const udenInterpolation = (t2) => {
          let ud = t2.replace(/\$\{[^}]*\}/g, ' ');
          let i2;
          while ((i2 = ud.indexOf('\\(')) >= 0) {
            let dybde = 1, j2 = i2 + 2;
            while (j2 < ud.length && dybde > 0) {
              if (ud[j2] === '(') dybde++;
              else if (ud[j2] === ')') dybde--;
              j2++;
            }
            if (dybde > 0) break;
            ud = ud.slice(0, i2) + ' ' + ud.slice(j2);
          }
          return ud;
        };
        const lav = udenInterpolation(str).toLowerCase();
        if (/[æøå]/.test(lav) || STAMMER.some(o => lav.includes(o))) {
          syndere.push(`${fil.split('/').pop()}:${i + 1}: ${str.slice(0, 44)}`);
        }
      }
    });
  }
  check('27. intet mennesket kan laese er paa dansk', syndere.length === 0,
        syndere.length ? `${syndere.length} strenge, fx: ` + syndere.slice(0, 2).join(' | ')
                       : `${FILER27.length} filer gennemgaaet tegn for tegn, alle strenge er engelske`);
}

// ---------------------------------------------------------------- paastand 33
// Naar der er brug for et menneske, skal det kunne SES - og koeen maa ikke
// kunne bruges til at give lov.
//
// ⛔ Gustav, 20/9: naar produktet aldrig maa tage skaermen, kan det heller ikke
//    banke paa. En handling der ville kraeve en dialog, AFVISES - og
//    forklaringen gaar til modellen, som skal sige det i chatten. Det virker
//    kun hvis nogen laeser praecis den chat.
//
//    Anden halvdel er den vigtigste: koeen er en LISTE, ikke en knap. Kunne man
//    godkende derfra, havde vi bygget et samtykke uden et menneske - praecis
//    det porten findes for.
{
  const { lavFalskHjaelper: lfh33, lavFalskSpoerger: lfs33 } = await import('./falsk-hjaelper.mjs');
  const h33 = lfh33('cmcp-koe'); const sp33 = lfs33('udloeb', 'cmcp-koe-sp');
  const fs33 = await import('fs');
  const { mkdtempSync: mk33 } = fs33;
  const { tmpdir: td33 } = await import('os');
  const stat33 = join(mk33(join(td33(), 'cmcp-koe-')), 'state');

  const c33 = client({ CMCP_MODE: 'ask', CMCP_BACKGROUND: '1', CMCP_ASK_TIMEOUT: '1',
                       CMCP_HELPER: h33.sti, CMCP_OSASCRIPT: sp33.sti, CMCP_STATE_DIR: stat33 });
  await c33.ready();
  for (const [navn, arg] of [
    ['computer_click', { x: 10, y: 10 }],
    ['computer_press', { app: 'com.apple.finder', title: 'x' }],
    ['computer_space', { direction: 'right' }],
  ]) await c33.rpc('tools/call', { name: navn, arguments: arg });

  const svar = await c33.rpc('tools/call', { name: 'computer_pending', arguments: {} });
  const tekst = svar.result?.content?.[0]?.text || '';
  c33.srv.kill();

  let koe = null; try { koe = JSON.parse(tekst); } catch {}
  check('33. de tre afviste handlinger staar i koeen',
        koe && koe.waiting === 3 && (koe.entries || []).length === 3,
        koe ? `${koe.waiting} venter` : tekst.slice(0, 70));
  check('33b. og koeen siger HVAD der blev bedt om, ikke bare at noget skete',
        koe && (koe.entries || []).every(e => e.describe && e.reason),
        koe ? (koe.entries || [])[0]?.describe : 'ingen koe');

  // ⛔ Modvaegten: koeen er en liste, ikke en knap.
  const { TOOLS: T33 } = await import(join(ROOT, 'mcp-server', 'tools.js') + '?p33');
  const koeVaerktoej = T33.find(t2 => t2.name === 'computer_pending');
  check('33c. koeen er LAESENDE - man kan ikke godkende noget fra den',
        koeVaerktoej && koeVaerktoej.tier === 'read'
          && !/approve|godkend|allow=/i.test(JSON.stringify(koeVaerktoej.inputSchema)),
        koeVaerktoej ? `tier=${koeVaerktoej.tier}, ingen godkend-parameter` : 'mangler');
  await h33.roligt();
  check('33d. og intet af det naaede maskinen',
        h33.handlingerNaaedeFrem().length === 0 && sp33.gangeSpurgt() === 0,
        `${h33.handlingerNaaedeFrem().length} handlinger, ${sp33.gangeSpurgt()} dialoger`);
}

// ---------------------------------------------------------------- paastand 34
// "Append-only" skal vaere en mekanisme, ikke en hensigt.
//
// ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9: det var appendFileSync plus chmod 0600,
//    og intet kunne opdage at en linje var fjernet - mens sitet sagde "a log
//    that can only be added to, never edited". Et loefte uden en proeve er en
//    paastand med flere ord.
//
//    Nu baerer hver linje et fingeraftryk af sig selv OG af den foregaaende.
//    Den aerlige graense staar samme sted paa sitet: kaeden beviser at ingen
//    LINJE er fjernet eller aendret. Den forhindrer ikke at hele filen slettes,
//    og den kan ikke - en log paa din egen maskine ejes af dig.
{
  const fs34 = await import('fs');
  const { mkdtempSync: mk34 } = fs34;
  const { tmpdir: td34 } = await import('os');
  const d34 = mk34(join(td34(), 'cmcp-kaede-'));
  process.env.CMCP_STATE_DIR = d34;
  const a34 = await import(join(ROOT, 'mcp-server', 'audit.js') + '?p34');
  for (let i = 0; i < 5; i++) a34.record({ tool: 'handling-' + i });
  const F = join(d34, 'audit.jsonl');

  check('34. kaeden holder paa en uroert log', a34.kaedenHolder().ok === true,
        JSON.stringify(a34.kaedenHolder()));

  const linjer = fs34.readFileSync(F, 'utf8').trim().split('\n');
  fs34.writeFileSync(F, linjer.filter((_, i) => i !== 2).join('\n') + '\n');
  const fjernet = a34.kaedenHolder();
  check('34b. en FJERNET linje bryder kaeden, og den siger hvor',
        fjernet.ok === false && fjernet.brudtVedLinje === 3,
        JSON.stringify(fjernet));

  const aendret = [...linjer];
  aendret[3] = aendret[3].replace('handling-3', 'handling-X');
  fs34.writeFileSync(F, aendret.join('\n') + '\n');
  const ae = a34.kaedenHolder();
  check('34c. og ét aendret tegn goer det samme',
        ae.ok === false && ae.brudtVedLinje === 4, JSON.stringify(ae));
  delete process.env.CMCP_STATE_DIR;
}

// ---------------------------------------------------------------- paastand 35
// Loggen maa ikke kunne paastaa at et menneske svarede, naar det ikke gjorde.
//
// ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9. `CMCP_OSASCRIPT` giver ingen ny magt -
//    den der kan saette den, kan ogsaa saette CMCP_MODE=allow. Men de to lyver
//    ikke ens: `allow` skriver aerligt reason=CMCP_MODE=allow, asked=false,
//    mens en omdirigeret spoerger der svarer "Yes" giver asked=true,
//    reason="the person said yes" - i den fil hvis hele formaal er at kunne
//    besvare hvad der SKETE. Ingen hemmelighed slipper ud; beviset bliver falsk.
//
//    Proeven er ogsaa et selvtjek: vores egen suite bruger en attrap-spoerger
//    overalt, saa uden dette felt ville hver eneste af vores egne
//    samtykke-linjer se ud som om et menneske sad og klikkede.
{
  const { lavFalskSpoerger: lfs35, lavFalskHjaelper: lfh35 } = await import('./falsk-hjaelper.mjs');
  const sp35 = lfs35('ja', 'cmcp-asker'); const h35 = lfh35('cmcp-asker-h');
  const fs35 = await import('fs');
  const { mkdtempSync: mk35 } = fs35;
  const { tmpdir: td35 } = await import('os');
  const d35 = mk35(join(td35(), 'cmcp-asker-'));
  const c35 = client({ CMCP_MODE: 'ask', CMCP_BACKGROUND: '0', CMCP_ASK_TIMEOUT: '2',
                       CMCP_OSASCRIPT: sp35.sti, CMCP_HELPER: h35.sti,
                       CMCP_STATE_DIR: join(d35, 'state') });
  await c35.ready();
  await c35.rpc('tools/call', { name: 'computer_click', arguments: { x: 5, y: 5 } });
  c35.srv.kill();
  await new Promise(r => setTimeout(r, 400));

  const f35 = join(d35, 'state', 'audit.jsonl');
  const linjer = fs35.existsSync(f35)
    ? fs35.readFileSync(f35, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  const medSamtykke = linjer.filter(l => l.asked === true);
  check('35. en omdirigeret spoerger maerkes i loggen',
        medSamtykke.length > 0 && medSamtykke.every(l => l.asker === 'custom'),
        medSamtykke.length ? `${medSamtykke.length} samtykke-linjer, alle maerket asker=custom`
                           : 'ingen samtykke-linje at bedoemme');
}

// ---------------------------------------------------------------- paastand 36
// Et felt der ser struktureret ud, baerer stadig det MODELLEN skrev.
//
// ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9. `path`, `app`, `combo`, `button` og
//    `direction` blev logget ordret, fordi de beskriver handlingen - men
//    vaerdien kommer fra modellen. En indsproejtning kunne laegge en
//    hemmelighed i `path` og faa den skrevet i klartekst i netop den fil hvis
//    loefte er at den aldrig indeholder klartekst.
//
//    Nu skal vaerdien ogsaa have den FORM feltet plejer at have. Og `app` blev
//    taget HELT af listen: et formkrav paa fritekst er en kapdyst man taber -
//    en 66-tegns hemmelighed af bogstaver og bindestreger bestod det foerste
//    forsoeg. Loggen skriver i stedet serverens eget `target`, som den selv
//    har slaaet op.
{
  const { scrubArgs: sa36 } = await import(join(ROOT, 'mcp-server', 'audit.js') + '?p36');
  const HEM36 = 'HEMMELIG-abc123-xyz789-og-mere-tekst-her-som-ikke-ligner-en-menusti';
  const sloeret = (k, v) => typeof sa36({ [k]: v })[k] === 'object';

  const laek = ['path', 'app', 'combo', 'button', 'direction', 'title', 'contains']
    .filter(k => !sloeret(k, HEM36));
  check('36. en hemmelighed slipper ikke igennem paa et struktureret felt',
        laek.length === 0, laek.length ? 'LAEKKER via: ' + laek.join(', ') : 'syv felter proevet, alle sloeret');

  // ⛔ Modvaegten: en RIGTIG menusti og tastekombination skal stadig kunne
  //    laeses. Uden den ville "sloer alt" ogsaa bestaa proeven - og en log man
  //    ikke kan laese, svarer ikke paa hvad agenten gjorde.
  const laesbare = [['path', 'File > Save As…'], ['combo', 'cmd+shift+s'],
                    ['button', 'close'], ['role', 'AXButton']]
    .filter(([k, v]) => !sloeret(k, v));
  check('36b. men en rigtig menusti og tastekombination staar stadig ordret',
        laesbare.length === 4,
        `${laesbare.length} af 4 er laesbare: ${laesbare.map(([k]) => k).join(', ')}`);
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
  // ⛔ 20/9: `gemini-extension.json` sagde 18 og `server.json` er den fil
  //    MCP-registret hoester. Begge er tekstflader, og begge laa uden for
  //    vagten. En flade er ikke kun en html-side.
  const FLADER = ['README.md', 'mcp-server/README.md',
                  'gemini-extension.json', 'server.json'].filter(f =>
                    fs15.existsSync(join(ROOT, f)));
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

// 35. ⛔ FUNDET AF KONSULENTEN 22/9: serveren spoerger hver gang om ni
//     programmer, men hjaelperen sloerede kun syv af dem. To adgangskode-
//     programmer (1Password 6 og Secretive) var vigtige nok til at spoerge om
//     - og stod alligevel usloerede paa et skaermbillede og aabne i traeet.
//     To lister der skal sige det samme, driver fra hinanden. Nu maales det.
{
  const { ALWAYS_ASK_APPS } = await import(join(ROOT, 'mcp-server', 'policy.js'));
  const fs41 = await import('node:fs');
  const sw = fs41.readFileSync(join(ROOT, 'helper/Sources/cmcp-helper/Accessibility.swift'), 'utf8');
  const blok = (sw.match(/defaultDenyBundles: Set<String> = \[([\s\S]*?)\]/) || [])[1] || '';
  const sloeret = (blok.match(/"[^"]+"/g) || []).map(x => x.replace(/"/g, ''));
  const kunSpurgt = [...ALWAYS_ASK_APPS].filter(b => !sloeret.includes(b));
  check('41. hvert program der spoerger hver gang, bliver ogsaa sloeret',
        kunSpurgt.length === 0,
        kunSpurgt.length ? `sloeres IKKE: ${kunSpurgt.join(', ')}` : `${sloeret.length} programmer paa begge lister`);
}

// 42. ⛔ FUNDET AF KONSULENTEN 23/9: README sagde at standardtilstanden er
//     «ask» og at ni programmer spoerger hver gang. Koden siger «allow» og
//     syv + Keychain + 1Password. Et produkt hvis salgsargument ER porten,
//     maa ikke beskrive porten forkert. Tallene udledes nu af koden.
{
  const { ALWAYS_ASK_APPS: A42, TAGER_SKAERMEN: T42, KAN_STILLES: K42, currentMode } = await import(join(ROOT, 'mcp-server', 'policy.js'));
  const fs42 = await import('node:fs');
  const readme = fs42.readFileSync(join(ROOT, 'README.md'), 'utf8');
  const tilstand = process.env.CMCP_MODE;
  delete process.env.CMCP_MODE;
  const standard = currentMode();
  if (tilstand !== undefined) process.env.CMCP_MODE = tilstand;
  const raekke = (readme.match(new RegExp('\\| `' + standard + '` \\| [^\\n]*', 'i')) || [''])[0];
  check('42a. README udpeger den tilstand koden faktisk starter i', /\*\*Default\.\*\*/.test(raekke),
        `koden starter i «${standard}»; README-raekken: ${raekke.slice(0, 60) || 'ikke fundet'}`);
  const ORD = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
  const andre = A42.size - 2;                       // Keychain og 1Password naevnes ved navn
  check('42b. antallet af adgangskode-programmer i README stemmer med listen',
        readme.includes(`1Password and ${ORD[andre]} others`),
        `listen har ${A42.size}, saa teksten skal sige «${ORD[andre]} others»`);
  const skjult = T42.size - K42.size;
  const side = fs42.existsSync(join(ROOT, 'docs/index.html')) ? fs42.readFileSync(join(ROOT, 'docs/index.html'), 'utf8') : '';
  check('42c. forsidens tal for skjulte vaerktoejer stemmer', !side || side.includes(`adds the ${ORD[skjult]} that do`),
        `koden skjuler ${skjult} i baggrund`);
}

// 43. ⛔ KONSULENTEN 22/9: revisionsloggen fingeraftrykker `title`/`contains`
//     fordi de kan baere en hemmelighed - men `pending.jsonl` gemte de samme
//     ord i klartekst via describe(). To filer om samme handling, to regler.
//     Koeen bruger nu den sikre linje. Proeven planter en hemmelighed.
{
  const fs43 = await import('node:fs');
  // Det afgoerende er kildekoden: intet kaldested maa sende describe() i koeen.
  const idx = fs43.readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
  const raa = (idx.match(/noterVentende\(\{[^}]*describe:\s*describe\(/g) || []).length;
  check('43. koeen gemmer aldrig modellens soegetekst',
        raa === 0, raa ? `${raa} kaldesteder sender stadig describe()` : 'alle kaldesteder bruger den sikre linje');
}

// 44. ⛔ MAALT 23/9: et skaermbillede tog 86 sekunder - ikke optagelsen, men
//     SLOERINGEN, som gik hvert synligt programs trae igennem. IDE'en alene
//     tog 54 sek. Vi sloerer nu kun det billedet daekker. Vagten holder den
//     beslutning paa plads: optagelsen SKAL give sloeringen det omraade.
{
  const fs44 = await import('node:fs');
  const cap = fs44.readFileSync(join(ROOT, 'helper/Sources/cmcp-helper/Capture.swift'), 'utf8');
  const ax = fs44.readFileSync(join(ROOT, 'helper/Sources/cmcp-helper/Accessibility.swift'), 'utf8');
  check('44a. optagelsen giver sloeringen det omraade billedet daekker',
        /secureRects\([^)]*indenfor:/s.test(cap), 'Capture.swift kalder uden `indenfor:`');
  check('44b. et vindue uden for billedet gaas ikke igennem',
        /let omr = indenfor.*!f\.cg\.intersects\(omr\.cg\).*continue/s.test(ax), 'geometri-tjekket mangler');
  check('44c. loeber tiden ud, sloeres HELE vinduet - aldrig et ugennemgaaet vindue',
        // ⛔ 24/9: sloeringen fik sit EGET loft (`sloeringsGraense`), adskilt fra
        //    inspect's `tidsgraense`. Tjekket her hvilede paa ordet `tidsgraense` -
        //    en regel paa et NAVN - og ville have meldt «faldbagen mangler» om en
        //    faldbag der stod lige der. Den maales nu for alvor i stille-vej.mjs.
        // ⛔ 24/9, anden gang samme dag: A4-rettelsen fjernede `out.append(f)` -
        //    den svaertede INTET naar vinduets ramme ikke kunne laeses, mens noten
        //    paastod det modsatte. Regexet ledte efter praecis den linje og blev
        //    roedt paa rettelsen af den fejl det skulle vogte mod. Et tekst-tjek
        //    over kilden er en svag vagt; den STAERKE er adfaerds-proeven i
        //    stille-vej.mjs («med CMCP_BUDGET_SEK=0 svaertes HVERT vindue helt»),
        //    der blev roed paa min egen regression (M21: 0 af 11 vinduer).
        //    Det her tjek staar tilbage som en billig ekstra linje, ikke som beviset.
        /sloeringStoppede\.append/.test(ax) && /(tidsgraense|sloeringsGraense)[\s\S]{0,400}out\.append\(contentsOf:/.test(ax),
        'faldbagen mangler');
}

// 45. npm-README'en ER repoets README - ikke en kopi der driver fra den.
//
// ⛔ FUNDET I MIT EGET ARBEJDSTRAE 23/9: `mcp-server/README.md` havde mistet
//    hele det aerlige forbehold («npx serverer 0.1.0, som har 12 vaerktoejer»)
//    mens repoets README stadig havde det. npm viser DEN fil, og en npm-README
//    er frosset pr. version - saa den ville have staaet forkert for evigt.
//
//    Afledningen sker i `build-release.sh` trin 5, altsaa foerst naar nogen
//    bygger. Indtil da kan de to filer sige forskellige ting uden at noget
//    siger fra. To filer der skal sige det samme, driver fra hinanden hver
//    gang nogen retter den ene - det er praecis derfor afledningen findes.
{
  const fs45 = await import('node:fs');
  const rep = fs45.readFileSync(join(ROOT, 'README.md'), 'utf8');
  const npm = fs45.readFileSync(join(ROOT, 'mcp-server/README.md'), 'utf8');
  // Samme to omskrivninger som build-release.sh laver, og kun dem.
  const vent = rep.replace(/<img src="docs\/[^>]*>\n\n/, '')
                  .replace(/\]\(docs\//g, '](https://github.com/Agent360dk/computerMCP/blob/main/docs/');
  check('45. npm-README\'en er afledt af repoets - ingen drift',
        npm === vent,
        npm.length === vent.length ? 'samme laengde, andet indhold'
          : `npm: ${npm.length} tegn, afledt: ${vent.length} tegn - koer scripts/build-release.sh`);
}

// 46. Frigives `computer_window`, SKAL titlen flytte fra kommandolinjen til stdin.
//
// ⛔ ASTRA 23/9. To fakta der hver for sig er harmloese og sammen ikke er det:
//    (a) `computer_window` sender `--title` som ARGV (index.js), og enhver bruger
//        paa maskinen kan laese argv med `ps`. Vinduestitler baerer dokumentnavne,
//        kundenavne, mail-emner.
//    (b) revisionsloggen behandler praecis det felt som en hemmelighed: `title`
//        staar IKKE i `STRUKTUR_NOEGLER`, saa den saltes og hashes (audit.js).
//    Loggen siger «det her er foelsomt»; kommandolinjen siger det modsatte.
//    `find`, `set_value`, `wait_for` og `press` fik alle den rettelse 20/9.
//    `window` er den sidste der mangler.
//
//    I DAG er lækagen uopnaaelig: `computer_window` staar i `TAGER_SKAERMEN` og
//    filtreres helt ud i baggrundstilstand, som er standard. Derfor haster den
//    ikke - OG derfor maa den ikke bare skrives ned et sted. Den dag nogen
//    frigiver `window`, aabner (a) sig selv, tavst.
//
//    Vagten binder de to sammen: staar `window` ikke laengere paa listen, skal
//    stien bruge stdin. Ellers roed. Saa skal koblingen ikke huskes.
{
  const fs46 = await import('node:fs');
  const pol = fs46.readFileSync(join(ROOT, 'mcp-server/policy.js'), 'utf8');
  const idx = fs46.readFileSync(join(ROOT, 'mcp-server/index.js'), 'utf8');
  const NAVN = 'computer_' + 'window';
  const STDIN = '--match-' + 'stdin';

  const listen = pol.match(/TAGER_SKAERMEN = new Set\(\[([\s\S]*?)\]\)/);
  const stien  = idx.match(new RegExp("case '" + NAVN + "': \\{([\\s\\S]*?)\\n    \\}"));

  // ⛔ KALIBRERING FOERST. Matcher et af de to moenstre ingenting, maaler vagten
  //    ikke noget - den bestaar bare. Det er den fejlklasse der kostede mest i
  //    dag (et tjek der ikke kunne fejle, groent og committet). Saa: kan vagten
  //    ikke finde det den skal laese, er DET det roede.
  if (!listen || !stien) {
    check(`46. koblingen mellem ${NAVN} og ${STDIN} er vogtet`, false,
          `vagten kunne ikke laese sit eget grundlag - listen:${!!listen} stien:${!!stien}`);
  } else {
    const spaerret = listen[1].includes(`'${NAVN}'`);
    const brugerStdin = stien[1].includes(STDIN);
    check(`46. ${NAVN}: enten spaerret i baggrund, eller titlen gaar via stdin`,
          spaerret || brugerStdin,
          spaerret ? 'spaerret i baggrund - titlen kan ikke naas' : `FRIGIVET uden ${STDIN}: titlen staar i argv og kan laeses med ps`);
  }
}

// 47. Tallet paa LAESENDE vaerktoejer, uanset hvordan saetningen er formuleret.
//
// ⛔ MAALT 23/9: syv flader sagde «Only the 9 read tools» mens koden har 12 -
//    og en server med CMCP_MODE=readonly lister MAALT 12. Det stod i praecis
//    den raekke der beskriver den tilstand dokumentationen selv siger man skal
//    STARTE i. En fremmed traf sit foerste valg paa et forkert tal.
//
//    Det er FJERDE formulering der slipper forbi: «N tools» ->
//    «The N on this page» -> «The source has N» -> «Only the N read tools».
//    Vagt 15 kendte de tre foerste. At jagte formuleringer er en tabt kamp.
//
//    Derfor leder den her ikke efter en VENDING, men efter et MOENSTER:
//    ethvert tal - ciffer eller ord - der staar lige foer «read tool».
//    Den femte formulering skal ogsaa fanges.
{
  const fs47 = await import('node:fs');
  const mod47 = await import(new URL('../mcp-server/tools.js', import.meta.url).href);
  const L = mod47.TOOLS.filter(t => t.tier === 'read').length;
  const ORD47 = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
    'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty',
    'twenty-one','twenty-two','twenty-three','twenty-four','twenty-five','twenty-six','twenty-seven','twenty-eight'];
  const flader47 = ['README.md', 'mcp-server/README.md'];
  (function gaa(mappe) {
    for (const navn of fs47.readdirSync(join(ROOT, mappe), { withFileTypes: true })) {
      const sti = join(mappe, navn.name);
      if (navn.isDirectory()) { gaa(sti); continue; }
      if (/\.(html|md|txt)$/.test(navn.name)) flader47.push(sti);
    }
  })('docs');

  const forkerte = [], fundet = [];
  for (const f of flader47) {
    const sti = join(ROOT, f);
    if (!fs47.existsSync(sti)) continue;
    const t = fs47.readFileSync(sti, 'utf8');
    // ⛔ 24/9: «the nine READING tools» slap forbi - moenstret sagde kun «read».
      //    Solgt som «ethvert tal foran read tool», og det var det ikke.
      for (const m of t.matchAll(/([A-Za-z-]+|\d+)\s+read[- ]?only\s+tools|([A-Za-z-]+|\d+)\s+read(?:ing)?\s+tools/gi)) {
      const raa = (m[1] ?? m[2] ?? '').toLowerCase();
      const tal = /^\d+$/.test(raa) ? Number(raa) : ORD47.indexOf(raa);
      if (tal < 0) continue;                 // "the read tools" - intet tal, intet at tjekke
      fundet.push(`${f}: ${m[0].trim()}`);
      if (tal !== L) forkerte.push(`${f}: "${m[0].trim()}" (koden: ${L})`);
    }
  }
  // ⛔ KALIBRERING: finder moenstret INGENTING, maaler vagten ikke noget - og
  //    saa skal den vaere roed, ikke groen. Det er den fejl der kostede mest i
  //    dag: et tjek der bestod fordi det ikke kunne se noget.
  if (!fundet.length) {
    check('47. tallet paa laesende vaerktoejer holder i enhver formulering', false,
          'vagten fandt INGEN forekomster af "N read tools" - den maaler ikke noget');
  } else {
    check('47. tallet paa laesende vaerktoejer holder i enhver formulering',
          forkerte.length === 0,
          forkerte.length ? forkerte.slice(0, 4).join(' | ')
                          : `${fundet.length} forekomster, alle siger ${L}`);
  }
}

// 48. Det en fremmed KOPIERER IND skal virke.
//
// ⛔ Ingen vagt roerte install-siderne foer 23/9 - og de baerer den eneste kode
//    en ny bruger nogensinde skriver af: konfigurations-JSON og en raekke
//    `mcp add`-kommandoer, seks klienter, fjorten blokke i alt.
//    En manglende tuborg eller et omdoebt pakkenavn braekker HVER ny bruger,
//    og vi ville hoere det fra dem, ikke fra en proeve.
//
//    MAALT 23/9 da vagten blev skrevet: 14 blokke, 7 rene JSON, 7 skal-
//    kommandoer - og VS Codes to har JSON inde i en skal-quote. Alle 14 var
//    korrekte. Vagten findes for at de bliver ved med at vaere det.
//
//    Pakkenavnet laeses af `package.json`, ikke skrevet af. En vagt der
//    gentager en streng fra det den vogter, vogter ingenting.
{
  const fs48 = await import('node:fs');
  const PAKKE = JSON.parse(fs48.readFileSync(join(ROOT, 'mcp-server/package.json'), 'utf8')).name;
  const afkod = (t) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const sider = fs48.readdirSync(join(ROOT, 'docs/docs')).filter(d => d.startsWith('install-'));
  const problemer = [];
  let blokke = 0, medPakke = 0;
  for (const side of sider) {
    const t = fs48.readFileSync(join(ROOT, 'docs/docs', side, 'index.html'), 'utf8');
    for (const m of t.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)) {
      const b = afkod(m[1]).trim();
      blokke++;
      // Hver JSON-krop i blokken skal parse - ogsaa den der ligger inde i en
      // skal-kommando (`code --add-mcp '{...}'`).
      for (const j of b.matchAll(/\{[\s\S]*\}/g)) {
        try { JSON.parse(j[0]); }
        catch (e) { problemer.push(`${side}: JSON parser ikke - ${String(e.message).slice(0, 50)}`); }
      }
      // ⛔ Kun blokke der FAKTISK opsaetter serveren skal naevne pakken.
      //    Foerste udgave kraevede det af ALLE blokke og flagede en filsti
      //    (`~/Library/Application Support/...`). En vagt der raaber paa noget
      //    rigtigt, bliver slaaet fra.
      const opsaetter = /mcpServers|"servers"|--add-mcp|mcp add/.test(b);
      if (!opsaetter) continue;
      medPakke++;
      if (!b.includes(PAKKE)) problemer.push(`${side}: opsaetnings-blok naevner ikke ${PAKKE}`);
    }
  }
  // ⛔ KALIBRERING: finder den for faa blokke, laeser den forkert og skal vaere
  //    roed. Maalt grundlag: 6 sider, 14 blokke, 13 opsaetnings-blokke.
  if (sider.length < 6 || blokke < 12 || medPakke < 10) {
    check('48. det en fremmed kopierer ind parser og peger paa den rigtige pakke', false,
          `vagten laeser for lidt: ${sider.length} sider, ${blokke} blokke, ${medPakke} opsaetnings-blokke`);
  } else {
    check('48. det en fremmed kopierer ind parser og peger paa den rigtige pakke',
          problemer.length === 0,
          problemer.length ? problemer.slice(0, 3).join(' | ')
                           : `${blokke} blokke paa ${sider.length} sider, ${medPakke} opsaetter serveren - alle peger paa ${PAKKE}`);
  }
}

// 49. Afinstallations-siden skal sige sandt om hvad produktet efterlader.
//
// ⛔ MAALT 23/9: siden sagde «Delete the one file it created» og «That is the
//    only thing it has ever written outside the npm cache». Produktet skriver
//    OTTE ting i den mappe: revisionsloggen, dens kaede-anker, koeen af
//    afvisninger, sessionsfilerne menulinje-ikonet laeser, gentagelses-
//    taelleren, en laase-mappe pr. program, ikonets socket og dens pid-fil.
//    Fjernelses-raadet var stadig komplet - alle otte ligger i den ene mappe -
//    men saetningen var usand, og produktets salgsargument er praecis at det
//    fortaeller hvad det roerer. Saa er det den slags saetning der skal holde.
//
//    ⛔ OG UDTRAEKKEREN VAR SELV BLIND FOERST: den fandt 7 af 8, fordi jeg
//    talte én parentes forkert i moenstret og dermed missede laase-mappen.
//    En udtraekker der underfinder, er en vagt der bestaar for tidligt.
//    Derfor kraever den nu mindst 6 fund, ellers er DEN det roede.
{
  const fs49 = await import('node:fs');
  const navne = new Set();
  for (const f of fs49.readdirSync(join(ROOT, 'mcp-server')).filter(f => f.endsWith('.js'))) {
    const t = fs49.readFileSync(join(ROOT, 'mcp-server', f), 'utf8');
    for (const m of t.matchAll(/join\(DIR,\s*'([^']+)'\)/g)) navne.add(m[1]);
    for (const m of t.matchAll(/'computer-mcp'\),\s*'([^']+)'\)/g)) navne.add(m[1]);
  }
  const ORD49 = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
                 'eleven','twelve','thirteen','fourteen'];
  const side = fs49.readFileSync(join(ROOT, 'docs/docs/uninstall/index.html'), 'utf8');
  const sagt = side.match(/([A-Za-z]+) things, one directory/i);

  if (navne.size < 6 || !sagt) {
    check('49. afinstallations-siden taeller det produktet faktisk efterlader', false,
          `vagten maaler ikke: ${navne.size} stier fundet i kilden, sætningen fundet: ${!!sagt}`);
  } else {
    const paastaaet = ORD49.indexOf(sagt[1].toLowerCase());
    check('49. afinstallations-siden taeller det produktet faktisk efterlader',
          paastaaet === navne.size,
          paastaaet === navne.size
            ? `${navne.size}: ${[...navne].sort().join(' ')}`
            : `siden siger «${sagt[1]}», koden skriver ${navne.size}: ${[...navne].sort().join(' ')}`);
  }
}

// 50. Kapabilitets-matrixens vaerktoejstabel er NAVNENE fra koden, ikke tal.
//
// ⛔ MAALT 24/9 paa den udgivne side: overskriften sagde «The twenty-eight
//    tools», raekkerne «Look (11)» og «Touch (12)» = 23, og der stod 20 navne.
//    Tre tal for én tabel. Koden har 12 laesende og 16 skrivende.
//    Og paastand 47 - bygget DAGEN FOER for at fange «den femte formulering» -
//    fangede hverken «Look (11)» eller «the nine reading tools» paa samme side.
//    En vagt paa formuleringer taber, hver gang. Det var fjerde og femte gang.
//
//    Saa den her taeller ikke ord. Den laeser NAVNENE i tabellen og holder dem
//    op mod `tools.js`, og den laeser listen over tilbageholdte vaerktoejer og
//    holder den op mod politikkens egne maengder. Et nyt vaerktoej der ikke
//    kommer paa siden, er roedt - uanset hvordan nogen formulerer tallet.
{
  const fs50 = await import('node:fs');
  const t50 = await import(join(ROOT, 'mcp-server', 'tools.js'));
  const p50 = await import(join(ROOT, 'mcp-server', 'policy.js'));
  const LAES = new Set(t50.TOOLS.filter(t => t.tier === 'read').map(t => t.name));
  const SKRIV = new Set(t50.TOOLS.filter(t => t.tier !== 'read').map(t => t.name));
  const HOLDT = new Set([...p50.TAGER_SKAERMEN].filter(n => !p50.KAN_STILLES.has(n)));
  const side = fs50.readFileSync(join(ROOT, 'docs/docs/capability-matrix/index.html'), 'utf8');
  const raekke = (navn) => {
    const m = side.match(new RegExp('<th[^>]*>' + navn + ' \\((\\d+)\\)</th><td>([\\s\\S]*?)</td>'));
    return m ? { tal: Number(m[1]), navne: new Set([...m[2].matchAll(/computer_[a-z_]+/g)].map(x => x[0])) } : null;
  };
  const look = raekke('Look'), touch = raekke('Touch');
  const hm = side.match(/Held back in background mode:<\/b>([\s\S]*?)\. Each/);
  const holdtSide = hm ? new Set([...hm[1].matchAll(/computer_[a-z_]+/g)].map(x => x[0])) : null;
  const ens = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  const forskel = (a, b) => `mangler: ${[...b].filter(x => !a.has(x)).join(' ') || '-'} · for meget: ${[...a].filter(x => !b.has(x)).join(' ') || '-'}`;

  // ⛔ KALIBRERING: kan vagten ikke finde de tre steder, maaler den intet.
  if (!look || !touch || !holdtSide || look.navne.size < 5 || touch.navne.size < 5) {
    check('50. matrixens vaerktoejstabel er navnene fra koden', false,
          `vagten fandt ikke sit grundlag - Look:${!!look} Touch:${!!touch} tilbageholdte:${!!holdtSide}`);
  } else {
    check('50a. «Look» er praecis de laesende vaerktoejer, og tallet passer',
          ens(look.navne, LAES) && look.tal === LAES.size,
          `siden: ${look.tal}/${look.navne.size} navne, koden: ${LAES.size} · ${forskel(look.navne, LAES)}`);
    check('50b. «Touch» er praecis de skrivende vaerktoejer, og tallet passer',
          ens(touch.navne, SKRIV) && touch.tal === SKRIV.size,
          `siden: ${touch.tal}/${touch.navne.size} navne, koden: ${SKRIV.size} · ${forskel(touch.navne, SKRIV)}`);
    check('50c. de tilbageholdte paa siden er dem politikken faktisk holder tilbage',
          ens(holdtSide, HOLDT),
          `siden ${holdtSide.size}, politikken ${HOLDT.size} · ${forskel(holdtSide, HOLDT)}`);
  }
}

// 51. Siderne lover det samtykke koden giver - ikke det den gav foer 21/9.
//
// ⛔ MAALT 24/9: ni flader sagde «ask is the default», «Nothing clicks until you
//    say yes» og «terminals ask every single time». Koden har siden 8a1bd92
//    (21/9) `allow` som standard og siden fd8206e (22/9) terminaler én gang pr.
//    session. Produktets EGEN foerste dialog sagde det ogsaa. Vagten udleder de
//    forbudte vendinger fra koden: skifter standarden eller listen tilbage, er
//    vendingerne ikke laengere forbudt - og saa skal de to andre vagter svare.
{
  const fs51 = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const p51 = await import(join(ROOT, 'mcp-server', 'policy.js'));
  const kilde = fs51.readFileSync(join(ROOT, 'mcp-server', 'policy.js'), 'utf8');
  const stdAllow = /process\.env\.CMCP_MODE \|\| 'allow'/.test(kilde);
  const termPrSession = p51.SPOERG_PR_SESSION.has('com.apple.Terminal') && !p51.ALWAYS_ASK_APPS.has('com.apple.Terminal');
  const forbudt = [
    ...(stdAllow ? [/Nothing clicks until/i, /<code>ask<\/code> is the default/i, /`ask` is the default/i,
                    /Default mode `ask`/i, /The first write action opens/i,
                    /<code>ask<\/code><\/td><td>The default/i, /\| `ask` \| \*\*Default/i] : []),
    ...(termPrSession ? [/terminals?\b[^.]{0,40}\bevery (single )?time/i] : [])
  ];
  // Flader en fremmed laeser. CHANGELOG er historik og maa beskrive det gamle.
  const flader = execFileSync('git', ['ls-files', '*.md', '*.html', '*.txt'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(f => f && !f.startsWith('test/') && !f.startsWith('videos/') && f !== 'CHANGELOG.md');
  // ⛔ KALIBRERING begge veje: vagten skal kende sit grundlag OG fange en plantet saetning.
  const plantet = 'Password managers and terminals ask every single time. Nothing clicks until you say yes.';
  const fanger = forbudt.filter(r => r.test(plantet)).length;
  if (!stdAllow || !termPrSession || flader.length < 20 || fanger < 2) {
    check('51. siderne lover det samtykke koden giver', false,
          `vagten fandt ikke sit grundlag - standard allow:${stdAllow} terminal pr. session:${termPrSession} flader:${flader.length} plantet fanget:${fanger}`);
  } else {
    const fund = [];
    for (const f of flader) {
      const tekst = fs51.readFileSync(join(ROOT, f), 'utf8').replace(/\s+/g, ' ');
      for (const r of forbudt) { const m = tekst.match(r); if (m) fund.push(`${f}: «${m[0]}»`); }
    }
    check('51. siderne lover det samtykke koden giver (standard allow, terminaler én gang pr. session)',
          fund.length === 0, fund.length ? fund.slice(0, 6).join(' · ') : `${flader.length} flader`);
  }
}

console.log();
if (skips.length) console.log(`SPRUNGET OVER: ${skips.length} (bevist intet - ikke bestaaet)`);
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
