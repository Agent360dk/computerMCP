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

// 5. En gammel linje uden `l:1` maa IKKE meldes som manipulation.
//    Det er hele grunden til at skelnen findes.
writeFileSync(FIL, alle.join('\n') + '\n');
const uden = [...alle];
uden[midt] = uden[midt].replace(',"l":1', '');
writeFileSync(FIL, uden.join('\n') + '\n');
k = JSON.parse(kaed());
check('en gammel linje uden maerket meldes som GAMMEL, ikke manipulation',
      k.gamle >= 1 && k.aegte === 0 && k.ok,
      `gamle=${k.gamle}, aegte=${k.aegte}`);

rmSync(DIR, { recursive: true, force: true });
console.log();
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
