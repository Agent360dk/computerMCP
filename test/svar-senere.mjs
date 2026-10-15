// S3 (15/10, R38 Astra + Opus): et kald maa ikke haenge til klienten skaerer det af (60 s), og et
// spoergsmaal mennesket ser for sent, maa ikke vaere tabt. Kaldet svarer efter VINDUET med «venter
// stadig», spoergsmaalet staar i boksen i LEVETIDEN, og et senere svar hentes ved at kalde igen med
// PRÆCIS de samme argumenter - et ja bruges én gang. Proeven bruger et falsk ikon (ingen skaerm).
import './ryd-op.mjs';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const vent = ms => new Promise(r => setTimeout(r, ms));

const STATE = mkdtempSync(join(tmpdir(), 'cmcp-senere-'));
process.env.CMCP_STATE_DIR = STATE;
process.env.CMCP_STATUS_IKON = '0';
process.env.CMCP_ASK_WINDOW = '1';
process.env.CMCP_ASK_LIFE = '4';
// Spoergsmaalets tilstedevaerelses-maaling kalder ellers den rigtige hjaelper (op til 2 x 1,5 s).
process.env.CMCP_HELPER = '/usr/bin/false';

// Falsk ikon: svarer efter `forsinkelse` ms med `svar` (eller aldrig).
const modtaget = []; let opfoersel = { forsinkelse: null, svar: null };
const srv = createServer(sock => {
  let buf = '';
  sock.on('data', d => {
    buf += d; const i = buf.indexOf('\n'); if (i < 0) return;
    const q = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); modtaget.push(q);
    const { forsinkelse, svar } = opfoersel;
    if (forsinkelse != null) setTimeout(() => { try { sock.write(JSON.stringify({ nonce: q.nonce, ...svar }) + '\n'); } catch {} }, forsinkelse);
  });
  sock.on('error', () => {});
});
await new Promise(r => srv.listen(join(STATE, 'ikon.sock'), r));

const G = await import(join(ROOT, 'mcp-server', 'godkend.js'));
const sp = { session: 's1', client: 'proeve', text: 'Press Quit in Noter', scope: 'If you allow it, this one action only.', target: 'com.apple.Notes' };

// 1. Svar efter vinduet: kaldet svarer «venter stadig» inden for vinduet - spoergsmaalet lever.
opfoersel = { forsinkelse: 2000, svar: { ok: true, verified: 'owner' } };
let t0 = Date.now();
const a = await G.spoergIkonet(sp, 4);
const ms = Date.now() - t0;
check('1a et ubesvaret spoergsmaal: kaldet svarer efter vinduet (ikke efter fristen) med «venter stadig»',
  a.ok === false && a.venterStadig === true && ms < 2500 && /call this again with exactly the same arguments/.test(a.grund), `${ms} ms · ${a.grund.slice(0, 80)}`);
await vent(1800);   // mennesket svarer ja efter 2 s
const b = await G.spoergIkonet(sp, 4);
check('1b kald igen med samme argumenter: det senere ja hentes - uden et nyt spoergsmaal', b.ok === true && modtaget.length === 1, `ok=${b.ok} spurgt=${modtaget.length}`);
opfoersel = { forsinkelse: 50, svar: { ok: true, verified: 'owner' } };
const c = await G.spoergIkonet(sp, 4);
check('1c et ja bruges én gang: naeste kald spoerger paa ny', c.ok === true && modtaget.length === 2, `spurgt=${modtaget.length}`);

// 2. Et andet spoergsmaal mens det foerste staar i boksen: afvist, ikke stillet.
opfoersel = { forsinkelse: null };
const d1 = await G.spoergIkonet({ ...sp, text: 'Press Delete in Noter' }, 4);
const d2 = await G.spoergIkonet({ ...sp, text: 'Press Send in Mail' }, 4);
check('2 mens et spoergsmaal staar i boksen, stilles intet andet', d1.venterStadig === true && d2.ok === false && d2.ikkeSpurgt === true && /already has a question waiting/.test(d2.grund) && modtaget.length === 3, `${d2.grund} · spurgt=${modtaget.length}`);

// 3. Et ja bundet til PRÆCIS handlingen: samme tekst men andet maal er et andet spoergsmaal.
await vent(4200);  // levetiden (4 s) udloeber uden svar
const e = await G.spoergIkonet({ ...sp, text: 'Press Delete in Noter' }, 4);
check('3a efter levetiden er spoergsmaalet vaek - samme kald stiller det paa ny', e.venterStadig === true && modtaget.length === 4, `spurgt=${modtaget.length}`);
await vent(4200);

// 4. Et senere NEJ: hentes som et menneskes nej (og giver pausen).
opfoersel = { forsinkelse: 1500, svar: { ok: false } };
const f1 = await G.spoergIkonet({ ...sp, text: 'Empty Trash in Finder' }, 4);
await vent(1200);
const f2 = await G.spoergIkonet({ ...sp, text: 'Empty Trash in Finder' }, 4);
const f3 = await G.spoergIkonet({ ...sp, text: 'Something else' }, 4);
check('4 et nej der kom senere: hentes som nej, og pausen gaelder', f1.venterStadig === true && f2.ok === false && f2.menneske === true && /said no/.test(f2.grund) && /just said no/.test(f3.grund), `${f2.grund} · ${f3.grund}`);

// 5. Korte frister (alle de gamle proever) opfoerer sig som foer: intet «venter stadig», et rent udloeb.
await vent(31_000 - 1200 - 0);
opfoersel = { forsinkelse: null };
t0 = Date.now();
const g = await G.spoergIkonet({ ...sp, text: 'Short one' }, 1);
check('5 en frist under vinduet: rent udloeb som foer', g.ok === false && !g.venterStadig && /nobody answered/.test(g.grund) && Date.now() - t0 < 2500, `${g.grund} · ${Date.now() - t0} ms`);

// 6. Et senere ja er bundet til PRÆCIS handlingen: samme tekst til et andet program faar det ikke.
opfoersel = { forsinkelse: 1500, svar: { ok: true, verified: 'owner' } };
const h1 = await G.spoergIkonet({ ...sp, text: 'Bound one' }, 4);
await vent(1000);   // ja'et er nu gemt til target com.apple.Notes
opfoersel = { forsinkelse: null };
const foer6 = modtaget.length;
const h2 = await G.spoergIkonet({ ...sp, text: 'Bound one', target: 'com.apple.mail' }, 4);
check('6 et senere ja til ét program kan ikke bruges til et andet', h1.venterStadig === true && h2.ok !== true && modtaget.length === foer6 + 1, `ok=${h2.ok} spurgt=${modtaget.length - foer6}`);

srv.close();
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
