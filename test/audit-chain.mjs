// Revisionskaeden under SAMTIDIGHED.
//
// ⛔ HVORFOR DEN FINDES (21/9-2026)
//    Produktet lover to ting paa samme flade: «several can run at once - no
//    lock file» og «append-only log» med en kaede der opdager en fjernet linje.
//    De to loefter kolliderede: hver server-proces huskede SELV hvor kaeden
//    slap, saa to samtidige servere skrev hver sin kaede i den samme fil.
//
//    MAALT i menneskets egen log foer rettelsen: 3.804 linjer, 3 brud, og
//    alle tre laa praecis paa et sessionsskift. `computer_audit` sagde
//    «a line was removed or edited» hvor intet var fjernet. En falsk alarm
//    paa et sikkerhedsloefte laerer folk at ignorere den.
//
//    Proeven her koerer det der braekkede den: flere processer, samme fil.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };

const DIR = mkdtempSync(join(tmpdir(), 'cmcp-kaede-'));
const FIL = join(DIR, 'audit.jsonl');
const miljoe = { ...process.env, CMCP_STATE_DIR: DIR };

// Skriver N linjer fra en SELVSTAENDIG proces - det er hele pointen.
const skriver = `
import { record } from ${JSON.stringify(join(ROOT, 'mcp-server', 'audit.js'))};
for (let i = 0; i < Number(process.argv[1]); i++) record({ tool: 'proeve', i });
`;
const kaed = () => execFileSync(process.execPath, ['--input-type=module', '-e',
  `import { kaedenHolder } from ${JSON.stringify(join(ROOT, 'mcp-server', 'audit.js'))};
   console.log(JSON.stringify(kaedenHolder()));`], { env: miljoe, encoding: 'utf8' }).trim();

// 1. ÉN skriver: kaeden skal holde. Kalibrering - virker instrumentet overhovedet?
execFileSync(process.execPath, ['--input-type=module', '-e', skriver, '30'], { env: miljoe });
let k = JSON.parse(kaed());
check('én skriver: kaeden holder', k.ok && k.aegte === 0 && k.checked === 30,
      `${k.checked} linjer, ${k.aegte} aegte brud`);

// 2. FIRE SAMTIDIGE skrivere i den samme fil. Det var her den braekkede.
const boern = [];
for (let n = 0; n < 4; n++) {
  boern.push(new Promise((res, rej) => {
    import('node:child_process').then(({ execFile }) => {
      execFile(process.execPath, ['--input-type=module', '-e', skriver, '40'],
               { env: miljoe }, (e) => e ? rej(e) : res());
    });
  }));
}
await Promise.all(boern);
k = JSON.parse(kaed());
const linjer = readFileSync(FIL, 'utf8').trim().split('\n').length;
check('fire samtidige skrivere: kaeden holder stadig',
      k.ok && k.aegte === 0 && k.gamle === 0,
      `${linjer} linjer, ${k.aegte} aegte brud, ${k.gamle} gamle`);
check('og alle linjer kom med - ingen gik tabt under laasen',
      linjer === 30 + 4 * 40, `${linjer} af ${30 + 4 * 40}`);

// 3. KALIBRERING DEN ANDEN VEJ: en aendret linje SKAL findes.
//    En vagt der aldrig kan blive roed, maaler ingenting.
const alle = readFileSync(FIL, 'utf8').trim().split('\n');
const midt = Math.floor(alle.length / 2);
const pillet = [...alle];
pillet[midt] = pillet[midt].replace('"tool":"proeve"', '"tool":"snydt"');
writeFileSync(FIL, pillet.join('\n') + '\n');
k = JSON.parse(kaed());
check('en AENDRET linje opdages som aegte brud', !k.ok && k.aegte >= 1,
      `aegte=${k.aegte}, gamle=${k.gamle}, linje ${k.brudtVedLinje}`);

// 4. ...og en FJERNET linje ogsaa.
writeFileSync(FIL, alle.filter((_, i) => i !== midt).join('\n') + '\n');
k = JSON.parse(kaed());
check('en FJERNET linje opdages som aegte brud', !k.ok && k.aegte >= 1,
      `aegte=${k.aegte}, linje ${k.brudtVedLinje}`);

// 5. ⛔ DEN VIGTIGSTE, og den blev VENDT OM af et modstander-review 21/9.
//
//    Foerste udgave af den her paastand laaste FEJLEN fast som korrekt:
//    den kraevede at en linje uden maerket blev meldt som «gammel». Men
//    maerket sidder inde i den linje der er under mistanke, saa den der
//    piller kunne fjerne seks tegn og blive frikendt. MAALT af reviewet:
//    linje redigeret + maerket fjernet -> {ok:true, aegte:0, gamle:1}.
//
//    Nu klassificeres paa POSITION: laase-aeraen begynder ved filens foerste
//    maerkede linje, og alt derefter maa vaere maerket.
writeFileSync(FIL, alle.join('\n') + '\n');
const strippet = [...alle];
strippet[midt] = strippet[midt].replace(',"l":1', '').replace('"tool":"proeve"', '"tool":"snydt"');
writeFileSync(FIL, strippet.join('\n') + '\n');
k = JSON.parse(kaed());
check('at fjerne maerket frikender IKKE en aendret linje', !k.ok && k.aegte >= 1,
      `aegte=${k.aegte}, gamle=${k.gamle}`);

// 6. ...og kalibrering den anden vej: aegte gamle linjer, FRA FOER laasen
//    fandtes, skal stadig frikendes. Ellers raaber vagten ulv om hver
//    installation der opgraderer.
const gammelLinje = JSON.stringify({ ts: '2026-09-01T00:00:00.000Z', session: 'gl', tool: 'gammel', kaede: 'deadbeefdeadbeef' });
writeFileSync(FIL, gammelLinje + '\n' + alle.join('\n') + '\n');
k = JSON.parse(kaed());
check('men en linje fra FOER laase-aeraen frikendes stadig', k.gamle >= 1,
      `gamle=${k.gamle}, aegte=${k.aegte}`);

// ⛔ KONSULENTEN 22/9: kaeden binder hver linje til den FORRIGE, saa fjernes
//    de sidste linjer, er resten stadig en gyldig kaede - halen kan forsvinde
//    i stilhed. Ankeret (sidste fingeraftryk, skrevet under samme laas) lukker
//    det. Og et laesefejl svarede «ok: true»; nu svarer det «vi ved det ikke».
{
  const { mkdtempSync: mk } = await import('node:fs');
  const st = mk(join((await import('node:os')).tmpdir(), 'cmcp-hale-'));
  const linjer = (await import('node:child_process')).execFileSync(process.execPath, ['-e', `
    process.env.CMCP_STATE_DIR = ${JSON.stringify(st)};
    const { record, kaedenHolder, AUDIT_PATH } = await import(${JSON.stringify(join(ROOT, 'mcp-server', 'audit.js'))});
    const fs = await import('node:fs');
    for (let i = 0; i < 6; i++) record({ tool: 'computer_apps', outcome: 'ok', nr: i });
    const helt = kaedenHolder();
    const l = fs.readFileSync(AUDIT_PATH, 'utf8').trim().split('\\n');
    fs.writeFileSync(AUDIT_PATH, l.slice(0, -2).join('\\n') + '\\n');
    const uden_hale = kaedenHolder();
    // ⛔ ASTRA 23/9: det foerste anker gemte kun sidste fingeraftryk, og
    //    record() overskrev det ved hver skrivning. EET normalt kald mere
    //    gjorde sporet «helt» igen. Nu taeller ankeret linjer.
    for (let i = 0; i < 6; i++) record({ tool: 'computer_apps', outcome: 'ok', nr: 100 + i });
    const efter_nye_kald = kaedenHolder();
    fs.writeFileSync(AUDIT_PATH, '');
    const tom = kaedenHolder();
    console.log(JSON.stringify({ helt, uden_hale, efter_nye_kald, tom }));
  `], { encoding: 'utf8' }).trim().split('\n');
  const ud = JSON.parse(linjer[linjer.length - 1]);
  check('et helt spor melder helt', ud.helt.ok === true && ud.helt.checked === 6, JSON.stringify(ud.helt));
  check('en FJERNET HALE opdages', ud.uden_hale.ok === false && ud.uden_hale.tail_removed === true, JSON.stringify(ud.uden_hale));
  check('...og seks nye kald skjuler den IKKE', ud.efter_nye_kald.ok === false && ud.efter_nye_kald.tail_removed === true,
        JSON.stringify(ud.efter_nye_kald));
  check('en toemt log opdages ogsaa', ud.tom.ok === false, JSON.stringify(ud.tom));
}

// Og et laesefejl: «vi ved det ikke» er ikke det samme som «kaeden holder».
{
  const { mkdtempSync: mk2, chmodSync: cm2 } = await import('node:fs');
  const st2 = mk2(join((await import('node:os')).tmpdir(), 'cmcp-ulaeselig-'));
  const raa = (await import('node:child_process')).execFileSync(process.execPath, ['-e', `
    process.env.CMCP_STATE_DIR = ${JSON.stringify(st2)};
    const { record, kaedenHolder, AUDIT_PATH } = await import(${JSON.stringify(join(ROOT, 'mcp-server', 'audit.js'))});
    const fs = await import('node:fs');
    record({ tool: 'computer_apps', outcome: 'ok' });
    fs.chmodSync(AUDIT_PATH, 0o000);
    console.log(JSON.stringify(kaedenHolder()));
    fs.chmodSync(AUDIT_PATH, 0o600);
  `], { encoding: 'utf8' }).trim().split('\n');
  const u = JSON.parse(raa[raa.length - 1]);
  check('en log der ikke kan laeses melder UKENDT, ikke «i orden»',
        u.ok === null && u.ukendt === true, JSON.stringify(u));
}

rmSync(DIR, { recursive: true, force: true });
console.log();
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
