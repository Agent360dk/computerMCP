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

// ---- R39 (Astra + Opus) ----
// 7. Ét ja, to ventende genkald: hoejst ét faar ja. (Spoergsmaalet fra 6 skal foerst udloebe.)
await vent(4200);
opfoersel = { forsinkelse: 1800, svar: { ok: true, verified: 'owner' } };
const t7 = { ...sp, text: 'Atomic one' };
const a7 = await G.spoergIkonet(t7, 4);
const [b7, c7] = await Promise.all([G.spoergIkonet(t7, 4), G.spoergIkonet(t7, 4)]);
check('7 ét ja giver hoejst én tilladelse - ogsaa med to ventende genkald', a7.venterStadig === true && [b7, c7].filter(x => x.ok === true).length === 1, JSON.stringify([b7.ok, c7.ok, b7.grund?.slice(0, 40), c7.grund?.slice(0, 40)]));

// 8. Et genkald der starter FOER vinduet er gaaet, mens det oprindelige kald faar ja: genkaldet faar besked.
await vent(1500);
opfoersel = { forsinkelse: 300, svar: { ok: true, verified: 'owner' } };
const t8 = { ...sp, text: 'Early recall' };
const [a8, b8] = await Promise.all([G.spoergIkonet(t8, 4), (async () => { await vent(100); return G.spoergIkonet(t8, 4); })()]);
check('8 det oprindelige kald faar ja; et samtidigt genkald faar «gik til et andet kald», ikke «venter stadig»', a8.ok === true && b8.ok === false && !b8.venterStadig && /went to another call/.test(b8.grund || ''), JSON.stringify([a8.ok, b8.ok, b8.grund?.slice(0, 50)]));

// 9. Bundet til handlingen: samme viste tekst, andet argument (knap nummer 0 og 1).
await vent(1500);
opfoersel = { forsinkelse: 1500, svar: { ok: true, verified: 'owner' } };
const t9 = { ...sp, text: 'Press "Delete" in com.apple.Notes' };
const a9 = await G.iHandling('computer_press', { app: 'Notes', title: 'Delete', index: 0 }, () => G.spoergIkonet(t9, 4));
await vent(1000);
opfoersel = { forsinkelse: null };
const foer9 = modtaget.length;
const b9 = await G.iHandling('computer_press', { app: 'Notes', title: 'Delete', index: 1 }, () => G.spoergIkonet(t9, 4));
check('9 et senere ja til knap nummer 0 kan ikke bruges til knap nummer 1 (samme viste tekst)', a9.venterStadig === true && b9.ok !== true && modtaget.length === foer9 + 1, `ok=${b9.ok} spurgt=${modtaget.length - foer9}`);
const c9 = await G.iHandling('computer_press', { index: 1, title: 'Delete', app: 'Notes' }, () => G.spoergIkonet(t9, 4));
check('9b ...men samme argumenter i en anden raekkefoelge er samme handling', c9.venterStadig === true && modtaget.length === foer9 + 1, `spurgt=${modtaget.length - foer9}`);
await vent(4200);

// 10. Et ikon der lukker efter vinduet: ikke et gemt svar - samme kald spoerger paa ny.
const lukker = [];
srv.removeAllListeners('connection');
srv.on('connection', (sock) => { let buf = ''; sock.on('data', d => { buf += d; if (buf.includes('\n')) { modtaget.push(JSON.parse(buf.split('\n')[0])); lukker.push(sock); } }); sock.on('error', () => {}); });
const t10 = { ...sp, text: 'Icon closes' };
const a10 = await G.spoergIkonet(t10, 4);
lukker.forEach(x => x.destroy()); await vent(200);
const foer10 = modtaget.length;
const b10 = await G.spoergIkonet(t10, 4);
check('10 et ikon der lukkede, er ikke et svar: samme kald spoerger paa ny', a10.venterStadig === true && b10.venterStadig === true && modtaget.length === foer10 + 1, `spurgt=${modtaget.length - foer10} ${b10.grund?.slice(0, 40)}`);
lukker.forEach(x => x.destroy()); await vent(4200);

// 11. Slags og omfang er en del af bindingen: et «done» bliver aldrig et samtykke, et ja til én handling aldrig til sessionen.
srv.removeAllListeners('connection');
srv.on('connection', (sock) => { let buf = ''; sock.on('data', d => { buf += d; const i = buf.indexOf('\n'); if (i < 0) return; const q = JSON.parse(buf.slice(0, i)); modtaget.push(q);
  setTimeout(() => { try { sock.write(JSON.stringify({ nonce: q.nonce, ok: true, verified: q.kind === 'goer-selv' ? 'done' : 'owner' }) + '\n'); } catch {} }, 1500); }); sock.on('error', () => {}); });
const t11 = { ...sp, text: 'Log in to Example', target: 'com.example', targetBundle: 'com.example' };
await G.spoergIkonet({ ...t11, kind: 'goer-selv' }, 4); await vent(1000);
const foer11 = modtaget.length;
const b11 = await G.spoergIkonet({ ...t11 }, 4);
check('11a et senere «done» kan ikke hentes som et samtykke', b11.ok !== true && modtaget.length === foer11 + 1, `ok=${b11.ok}`);
await vent(4200);
const t12 = { ...sp, text: 'Type in Terminal', scope: 'If you allow it, this one action only.' };
await G.spoergIkonet(t12, 4); await vent(1000);
const foer12 = modtaget.length;
const b12 = await G.spoergIkonet({ ...t12, scope: 'If you allow it, the agent may work in com.apple.Terminal for the rest of this session.' }, 4);
check('11b et senere ja til «denne ene handling» kan ikke hentes som «resten af sessionen»', b12.ok !== true && modtaget.length === foer12 + 1, `ok=${b12.ok}`);

// 12. Serveren: «venter stadig» er hverken et afslag i koeen eller et «spoerg ikke igen» (kildekontrakt).
{
  const { readFileSync } = await import('node:fs');
  const ix = readFileSync(join(ROOT, 'mcp-server', 'index.js'), 'utf8');
  check('12 serveren: iHandling om hvert kald; «Waiting:» uden koe; ask_user «waiting» uden «Do not ask again»; logget «waiting»',
    /svar = await iKald\(\(\) => iHandling\(navn, a, \(\) => haandterKald\(request\)\)\);/.test(ix)
    && /if \(handlingVenterStadig\(\)\) \{\n\s+return errorResult\(\n\s+`Waiting: /.test(ix)
    && /\? \{ done: false, waiting: true, hvor: hvorIkon, via: 'menu bar', note: svar\.grund \}/.test(ix)
    && /decision: verdict\.allow \? 'allowed' : \(handlingVenterStadig\(\) \? 'waiting' : 'denied'\)/.test(ix));
}

srv.close();
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
