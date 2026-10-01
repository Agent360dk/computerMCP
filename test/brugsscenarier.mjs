// BRUGSSCENARIERNE: de 19 ting et menneske gør på sin Mac - én prøve hver.
//
// ⛔ HVORFOR DEN FINDES (27/9-2026)
//    Gustav: «gør den fuldt færdig, så den kan alt på computeren som et menneske,
//    og bevis det med en test pr. use case». Chat 88 nåede 1 af 19 i hånden
//    (Lommeregner). Et bevis i hånden kan ikke køres igen på en anden maskine,
//    og det er dér, det skal bestå (STAND, slutkriterie 1).
//
//    Hvert scenarie går gennem HELE kæden - MCP-kald, port, hjælper, program - med
//    sin egen friske server, og beviset er det, programmet SELV viser bagefter,
//    læst som tekst. Aldrig produktets eget svar alene.
//
// ⛔ KØRER ALDRIG MOD RIGTIGE PROGRAMMER AF SIG SELV.
//    Uden flag kører kun selvprøven: maskineriet mod attrappen, og hvert af de 19
//    meldes «ikke kørt» med grunden - aldrig grønt. Et scenarie kører kun, når:
//      CMCP_BRUG=<klasser>        fx «laes» eller «laes,lokal» - hvad må prøven gøre
//      CMCP_FREMMED_MASKINE=1     alt andet end «laes» kræver en maskine der ikke er Gustavs
//      CMCP_BRUG_TAG_SKAERMEN=1   kun sammen med CMCP_BRUG_TILSTAND=forgrund
//    Klasserne:
//      laes       læser et program der allerede er åbent med et vindue; starter og ændrer intet
//      lokal      starter eller ændrer noget på maskinen og rydder op efter sig
//      mennesker  når et andet menneske (WhatsApp) - kræver en navngivet modtager
//      penge      App Store - kun en gratis app et menneske har navngivet
//      kamera     tænder kameraets lys
//    Spørg Gustav før noget går til rigtige mennesker, før App Store, og før
//    prøverne tager skærmen (opgaven 27/9). Flagene er det spørgsmål, skrevet ned.
//
// ⚠️ Scenarierne er skrevet 27/9 og er IKKE kørt mod de rigtige programmer endnu.
//    Et rødt scenarie siger hvilket trin der fejlede; dér starter næste skive.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger, lavVagtHjaelper } from './falsk-hjaelper.mjs';
import { startFilm } from './film.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AEGTE = join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
process.env.CMCP_STATUS_IKON = '0';   // aldrig det rigtige ikon i menneskets menulinje
const vent = (ms) => new Promise(r => setTimeout(r, ms));
const tilfaeldig = () => Math.random().toString(36).slice(2, 8);

// Titler i programmerne står på systemets sprog. Kun dansk og engelsk er skrevet.
const SPROG = (() => {
  try { return /^\s*\(?\s*"?da/.test(execFileSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8' })) ? 'da' : 'en'; }
  catch { return 'en'; }
})();
const L = (o) => o[SPROG] ?? o.en;

// ---------------------------------------------------------------------------
// PORTEN: må dette scenarie køre her? Ren funktion, så selvprøven kan måle den.
// ---------------------------------------------------------------------------
export const KLASSER = ['laes', 'lokal', 'mennesker', 'penge', 'kamera'];
export function maaKoere(s, env, aabentAllerede = false) {
  const bedt = String(env.CMCP_BRUG || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!bedt.length) return { ja: false, grund: 'ikke bedt om (CMCP_BRUG er tom)' };
  const klasse = s.laesHvisKoerer && aabentAllerede ? 'laes' : s.klasse;
  if (!bedt.includes(klasse)) return { ja: false, grund: `klassen «${klasse}» er ikke slået til` };
  if (klasse !== 'laes' && env.CMCP_FREMMED_MASKINE !== '1') {
    return { ja: false, grund: `«${klasse}» ændrer noget, og maskinen kan være Gustavs - kræver CMCP_FREMMED_MASKINE=1` };
  }
  for (const [navn, hvorfor] of Object.entries(s.kraever || {})) {
    if (!String(env[navn] || '').trim()) return { ja: false, grund: `mangler ${navn}: ${hvorfor}` };
  }
  if (env.CMCP_BRUG_TILSTAND === 'forgrund' && env.CMCP_BRUG_TAG_SKAERMEN !== '1') {
    return { ja: false, grund: 'forgrund tager skærmen - kræver CMCP_BRUG_TAG_SKAERMEN=1' };
  }
  return { ja: true, klasse };
}

// ---------------------------------------------------------------------------
// EN FRISK SERVER pr. scenarie: egen tilstandsmappe, egen revisionslog, og et
// sikkerhedsnet der kun lader handlinger nå scenariets egne programmer.
// ---------------------------------------------------------------------------
async function nyServer({ tilladte, forgrund }) {
  const vagt = lavVagtHjaelper(process.env.CMCP_HELPER || AEGTE);
  vagt.tillad(...tilladte);
  // Samtykke: prøven svarer ja - men kun scenariets egne programmer kan nå
  // hjælperen, og hvert spørgsmål står i rapporten bagefter.
  const spoerger = lavFalskSpoerger('ja', 'cmcp-brug');
  const state = mkdtempSync(join(tmpdir(), 'cmcp-brug-'));
  const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
    env: { ...process.env, CMCP_HELPER: vagt.sti, CMCP_STATE_DIR: state, CMCP_OSASCRIPT: spoerger.sti,
           CMCP_BACKGROUND: forgrund ? '0' : '1' },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', n = 0; const w = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'brugsscenarier', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const kald = async (navn, args = {}) => {
    const r = await rpc('tools/call', { name: navn, arguments: args });
    const tekst = r.result?.content?.[0]?.text ?? JSON.stringify(r.error ?? {});
    let data = null; try { data = JSON.parse(tekst); } catch {}
    return { fejl: !!r.result?.isError || !!r.error, tekst, data };
  };
  const luk = () => { try { srv.kill(); } catch {} rmSync(state, { recursive: true, force: true }); };
  return { kald, luk, vagt, spoerger };
}

class TrinFejl extends Error {}
/// Målt umuligt i baggrunden - ikke en fejl i produktet, men heller ikke bevist.
class KunForgrund extends Error {}

// Det et scenarie får at arbejde med. Hvert kald skrives i `spor`, så et rødt
// scenarie kan sige præcis hvor det gik galt.
function vaerktoej(srv, { forgrund, startede, spor, apps, udenfor, tog }) {
  const c = {
    token: 'cmcp' + tilfaeldig(),
    L, SPROG, forgrund,
    async k(navn, args = {}, { maaFejle = false } = {}) {
      // Prøvens egen vagt, før serveren og før sikkerhedsnettet: et scenarie
      // rører kun sine egne programmer. Rødt, også hvis scenariet selv fanger fejlen.
      if (args.app && !apps.includes(args.app)) {
        udenfor.push(`${navn} -> ${args.app}`);
        throw new TrinFejl(`${navn} mod ${args.app}, som ikke er scenariets program`);
      }
      const r = await srv.kald(navn, args);
      spor.push(`${navn} ${JSON.stringify(args).slice(0, 90)} -> ${r.fejl ? 'FEJL ' : ''}${r.tekst.replace(/\s+/g, ' ').slice(0, 260)}`);
      // Løftet pr. kald: tog et kald skærmen i baggrunden, skal forgrunden være givet tilbage.
      if (!forgrund && r.data?.took_screen === true) tog.push({ navn, givetTilbage: r.data.gave_back === true, hvorfor: r.data.why || '' });
      if (r.fejl && !maaFejle) throw new TrinFejl(`${navn}: ${r.tekst.replace(/\s+/g, ' ').slice(0, 200)}`);
      return r;
    },
    async koerer(app) {
      const r = await c.k('computer_apps');
      return (r.data?.apps || []).some(a => a.bundleId === app);
    },
    async start(app) {
      if (!(await c.koerer(app))) startede.add(app);
      return c.k('computer_launch', { app, background: !forgrund });
    },
    async vinduer(app) { return (await c.k('computer_windows', { app }, { maaFejle: true })).data?.windows || []; },
    async ventVindue(app, { sek = 30, flereEnd = 0, titel } = {}) {
      const frist = Date.now() + sek * 1000;
      while (Date.now() < frist) {
        const v = await c.vinduer(app);
        if (v.length > flereEnd && (!titel || v.some(x => titel.test(x.title || '')))) return v;
        await vent(700);
      }
      throw new TrinFejl(`intet vindue${titel ? ' med titlen ' + titel : ''} i ${app} efter ${sek} s - ${JSON.stringify((await c.vinduer(app)).map(x => x.title))}`);
    },
    // Menupunkter findes på deres tastaturgenvej: den er ens på alle sprog.
    async menuGenvej(app, genvej) {
      // Lige efter start er menupunkter ofte grå et øjeblik (Skak, 27/9): vent op til 6 s.
      for (let i = 0; i < 8; i++) {
        // Et program der lige er startet, har ingen menulinje endnu (Safari, 28/9: no-menubar).
        const m = await c.k('computer_menus', { app, depth: 3 }, { maaFejle: true });
        const p = (m.data?.items || []).find(x => x.shortcut === genvej && x.enabled !== false);
        if (p) return c.k('computer_menu', { app, path: p.path });
        await vent(800);
      }
      throw new TrinFejl(`intet menupunkt med genvejen ${genvej} i ${app}`);
    },
    async menuTitel(app, re) {
      const m = await c.k('computer_menus', { app, depth: 3 });
      const p = (m.data?.items || []).find(x => re.test(x.title || '') && x.enabled !== false);
      if (!p) throw new TrinFejl(`intet menupunkt der matcher ${re} i ${app}`);
      return c.k('computer_menu', { app, path: p.path });
    },
    async find(app, q) { return (await c.k('computer_find', { app, ...q }, { maaFejle: true })).data?.matches || []; },
    async ventPaa(app, q, sek = 30) {
      const frist = Date.now() + sek * 1000;
      while (Date.now() < frist) { const m = await c.find(app, q); if (m.length) return m; await vent(800); }
      throw new TrinFejl(`${JSON.stringify(q)} dukkede ikke op i ${app} efter ${sek} s`);
    },
    // Tryk på den første af flere mulige titler (programmernes egne navne varierer).
    async trykEn(app, titler, ekstra = {}) {
      for (const title of titler) {
        const r = await c.k('computer_press', { app, title, ...ekstra }, { maaFejle: true });
        if (!r.fejl) return r;
      }
      throw new TrinFejl(`ingen knap med titlen ${titler.join(' / ')} i ${app}`);
    },
    skriv: (app, text) => c.k('computer_type', { app, text }),
    tast: (app, combo) => c.k('computer_key', { app, combo }),
  };
  return c;
}

// ---------------------------------------------------------------------------
// SCENARIERNE
// ---------------------------------------------------------------------------
const CHROME = 'com.google.Chrome';
const WHATSAPP = 'net.whatsapp.WhatsApp';
// ⛔ 27/9: på GitHubs Mac standsede macOS Chrome ved første åbning («hentet fra
//    internettet - vil du åbne det?»). Den dialog klikker hverken produktet
//    eller prøven sig forbi. Safari findes på hver Mac og bærer Netflix og Kort.
const SAFARI = 'com.apple.Safari';

// «Åbne X»: programmet starter, et vindue kan nås, og det viser noget.
function aabn(nr, navn, app, { laes } = {}) {
  return {
    nr, navn, apps: [app], klasse: 'lokal', laesHvisKoerer: true,
    async trin(c) {
      // Åbent med et vindue er åbent: et menneske klikker ikke på noget der er
      // åbent. Og programmet mennesket bruger lige nu, må ikke røres - porten
      // spørger om det, med rette (Agent360 IDE, 27/9).
      if ((await c.koerer(app)) && (await c.vinduer(app)).length) return;
      await c.start(app); await c.ventVindue(app);
    },
    async tjek(c) {
      const v = await c.ventVindue(app);
      if (laes) {
        try { const m = await c.ventPaa(app, laes); return `${v.length} vindue(r); «${m[0].name || m[0].subrole}» står i vinduet`; }
        catch (e) {
          if (c.forgrund) throw e;
          // Et skjult program tegner ikke altid sine tabelrækker, og det der ikke
          // er tegnet, findes ikke for tilgængeligheds-laget (Aktivitetsovervågning, 27/9).
          return { bevis: `${v.length} vindue(r) åbnet i baggrunden`, delvis: 'indholdet kunne ikke læses, mens programmet er skjult' };
        }
      }
      return `${v.length} vindue(r): ${v.map(x => `«${x.title}»`).slice(0, 3).join(', ')}`;
    },
  };
}

// Styresystemets egen fil over skrivebordsbaggrunden. Ændrer den sig, er
// baggrunden skiftet - uanset hvad produktet svarede.
function baggrundsFil() {
  try { return readFileSync(join(homedir(), 'Library', 'Application Support', 'com.apple.wallpaper', 'Store', 'Index.plist')).toString('base64'); }
  catch { return 'mangler'; }
}

// En adresse i en browser: nyt vindue, adressen skrives i adressefeltet, Retur.
function browserSide(nr, navn, url, titel, browser = SAFARI) {
  return {
    nr, navn, apps: [browser], klasse: 'lokal',
    async trin(c) {
      await c.start(browser);
      const foer = (await c.vinduer(browser)).length;
      await c.menuGenvej(browser, 'cmd+n');
      await c.ventVindue(browser, { flereEnd: foer });
      // Som et menneske: Cmd+L giver adressefeltet fokus (27/9: uden den gik
      // teksten til siden, ikke feltet, og vinduet blev ved at hedde «Start Page»).
      await c.menuGenvej(browser, 'cmd+l');
      await vent(500);
      await c.skriv(browser, url);
      await c.tast(browser, 'return');
    },
    async tjek(c) {
      const v = await c.ventVindue(browser, { titel, sek: 40 });
      return `vinduet hedder «${v.find(x => titel.test(x.title)).title}»`;
    },
    // Vinduet lukkes kun i forgrunden: i baggrunden kan vi ikke udpege netop dét
    // vindue, og menneskets egne vinduer må ikke rammes af et gæt.
    async ryd(c) {
      if (!c.forgrund) return 'browser-vinduet står åbent (kan ikke udpeges sikkert i baggrunden)';
      await c.k('computer_window', { app: browser, title: titel.source.replace(/\\/g, ''), button: 'close' }, { maaFejle: true });
    },
  };
}

// En besked i WhatsApp til den chat, et menneske har navngivet.
function whatsappBesked(nr, navn, modtagerVar, hvorfor) {
  return {
    nr, navn, apps: [WHATSAPP], klasse: 'mennesker', kraever: { [modtagerVar]: hvorfor },
    async trin(c) {
      await c.start(WHATSAPP); await c.ventVindue(WHATSAPP);
      await c.k('computer_set_value', { app: WHATSAPP, subrole: 'AXSearchField', text: process.env[modtagerVar] });
      await c.ventPaa(WHATSAPP, { contains: process.env[modtagerVar] });
      // press gætter ikke: findes navnet flere steder, fejler trinnet i stedet for at vælge.
      await c.k('computer_press', { app: WHATSAPP, contains: process.env[modtagerVar], role: 'AXButton' });
      await c.skriv(WHATSAPP, `Prøve fra computer-mcp ${c.token}`);
      await c.tast(WHATSAPP, 'return');
    },
    async tjek(c) { const m = await c.ventPaa(WHATSAPP, { contains: c.token }); return `beskeden står i chatten: «${m[0].name}»`; },
  };
}

export const SCENARIER = [
  aabn(1, 'åbne Chrome', CHROME),
  // Vinduets titel er tom; søgefeltet står ens på alle sprog.
  aabn(2, 'åbne Indstillinger', 'com.apple.systempreferences', { laes: { subrole: 'AXSearchField' } }),
  {
    nr: 3, navn: 'downloade apps', apps: ['com.apple.AppStore'], klasse: 'penge',
    kraever: { CMCP_BRUG_GRATIS_APP: 'navnet på en GRATIS app et menneske har valgt, præcis som i App Store' },
    async trin(c) {
      const app = process.env.CMCP_BRUG_GRATIS_APP;
      await c.start('com.apple.AppStore'); await c.ventVindue('com.apple.AppStore');
      await c.k('computer_set_value', { app: 'com.apple.AppStore', subrole: 'AXSearchField', text: app });
      await c.tast('com.apple.AppStore', 'return');
      // Kun én «Hent»-knap må findes: press gætter ikke, så flere resultater
      // eller en pris-knap (betalt app) giver rødt - aldrig et køb.
      await c.ventPaa('com.apple.AppStore', { role: 'AXButton', title: L({ en: 'Get', da: 'Hent' }) }, 60);
      await c.k('computer_press', { app: 'com.apple.AppStore', role: 'AXButton', title: L({ en: 'Get', da: 'Hent' }) });
    },
    async tjek() {
      const sti = `/Applications/${process.env.CMCP_BRUG_GRATIS_APP}.app`;
      for (let i = 0; i < 90 && !existsSync(sti); i++) await vent(2000);
      if (!existsSync(sti)) throw new TrinFejl(`${sti} findes ikke efter 3 min`);
      return `${sti} findes`;
    },
  },
  {
    // Brættet er knapper (MÅLT 27/9 på en fremmed Mac: «white pawn, e2» osv.).
    // Et træk er to tryk, brikken og feltet - ingen mus, så det virker også i baggrunden.
    nr: 4, navn: 'spille skak', apps: ['com.apple.Chess'], klasse: 'lokal',
    async trin(c) {
      const A = 'com.apple.Chess';
      await c.start(A); await c.ventVindue(A);
      // ⛔ Koersel 6: Skak genskabte det gamle parti (bonden stod på e4), og «Ny…»
      //    kunne ikke vælges. Et træk der passer på ethvert bræt: den første hvide
      //    bonde på række 2, hvis felt to foran er tomt.
      const knap = (t) => c.find(A, { role: 'AXButton', title: t });
      for (let i = 0; i < 12 && !(await c.find(A, { role: 'AXButton', contains: L({ en: 'white pawn', da: 'hvid bonde' }) })).length; i++) await vent(700);
      for (const f of 'edcfgbah') {
        const bonde = L({ en: `white pawn, ${f}2`, da: `hvid bonde, ${f}2` });
        if ((await knap(bonde)).length === 1 && (await knap(`${f}4`)).length === 1) {
          await c.k('computer_press', { app: A, role: 'AXButton', title: bonde });
          await c.k('computer_press', { app: A, role: 'AXButton', title: `${f}4` });
          c.traek = f; return;
        }
      }
      throw new TrinFejl('ingen hvid bonde på række 2 med et tomt felt to foran');
    },
    async tjek(c) {
      const m = await c.ventPaa('com.apple.Chess', { role: 'AXButton', title: L({ en: `white pawn, ${c.traek}4`, da: `hvid bonde, ${c.traek}4` }) });
      return `bonden er flyttet: «${m[0].name}»`;
    },
  },
  browserSide(5, 'åbne Netflix', 'https://www.netflix.com/', /Netflix/),
  {
    // ⛔ 27/9 på en fremmed Mac: tryk på «Wallpaper» i sidebjælken er tryk på en
    //    tekst og skifter ingen side, og vinduets titel er tom. Indstillinger har
    //    en Vis-menu med hver side; sidens overskrift står så ét sted mere. Hvert
    //    billede er en knap med sit navn (MÅLT). Beviset for skiftet er
    //    styresystemets egen baggrunds-fil, ikke produktets svar.
    nr: 6, navn: 'skifte skrivebordsbaggrund', apps: ['com.apple.systempreferences'], klasse: 'lokal',
    async trin(c) {
      const S = 'com.apple.systempreferences', navn = L({ en: 'Wallpaper', da: 'Baggrund' });
      await c.start(S); await c.ventVindue(S);
      const foer = (await c.find(S, { role: 'AXStaticText', title: navn })).length;
      await c.menuTitel(S, new RegExp(`^${navn}$`));
      for (let i = 0; i < 30 && (await c.find(S, { role: 'AXStaticText', title: navn })).length <= foer; i++) await vent(700);
      c.billedFoer = baggrundsFil();
      for (const billede of ['The Lake', 'The Cliffs', 'Macintosh', 'Ventura', 'Monterey']) {
        const r = await c.k('computer_press', { app: S, role: 'AXButton', title: billede }, { maaFejle: true });
        if (r.fejl) continue;
        for (let i = 0; i < 16; i++) { await vent(500); if (baggrundsFil() !== c.billedFoer) { c.billede = billede; return; } }
        // ⛔ 27/9: tryk på billedet svarede ok og skiftede intet. Et menneske
        //    klikker - og i forgrunden må prøven det samme, på billedets midte.
        const mid = r.data?.pressed?.center;
        if (c.forgrund && mid) {
          // Med program: prøvens sikkerhedsnet standser (med rette) et klik uden (koersel 5).
          await c.k('computer_click', { x: mid.x, y: mid.y, app: S }, { maaFejle: true });
          for (let i = 0; i < 16; i++) { await vent(500); if (baggrundsFil() !== c.billedFoer) { c.billede = billede; c.klikket = true; return; } }
        }
      }
    },
    async tjek(c) {
      // MÅLT 27/9 (koersel 4-6): tryk på et billede svarer ok og skifter intet, og et
      // klik i programmets egen kø heller ikke. Kun et rigtigt klik er tilbage.
      if (!c.billede) return { bevis: 'siden «Wallpaper» er åben, og billederne kan læses', delvis: 'at vælge et billede kræver et rigtigt klik - tryk og klik i programmets kø skifter intet (målt 3 gange)' };
      return `baggrunden er skiftet til «${c.billede}»${c.klikket ? ' med et klik' : ''} - styresystemets baggrunds-fil er ændret`;
    },
    async ryd(c) { return c.billede ? 'den gamle baggrund er ikke sat tilbage (kører kun på en maskine der ikke er Gustavs)' : ''; },
  },
  aabn(7, 'åbne WhatsApp', WHATSAPP),
  whatsappBesked(8, 'skrive i WhatsApp', 'CMCP_BRUG_WHATSAPP_MIG', 'chatten med dig selv, som WhatsApp viser navnet - beskeden når ingen andre'),
  {
    // Tolket som programmet Kontakter: en kontakt oprettet dér er lokal og kan
    // slettes igen. En WhatsApp-kontakt oprettes på telefonen.
    nr: 9, navn: 'oprette en ny kontakt', apps: ['com.apple.AddressBook'], klasse: 'lokal',
    async trin(c) {
      const A = 'com.apple.AddressBook';
      await c.start(A); await c.ventVindue(A);
      // I baggrunden er Arkiv > Nyt kort gråt (MÅLT 27/9); knappen «add» under listen er der stadig.
      await c.menuGenvej(A, 'cmd+n').catch((e) => {
        if (c.forgrund) throw e;
        // MÅLT 27/9 (koersel 3-9): i baggrunden er «Nyt kort» gråt, og knappen «add»
        // svarer ikke på et tryk. Trykket blev IKKE harmløst: bagefter skubbede
        // Kontakter sig frem igen og igen og forsvandt (koersel 10) - så prøves det ikke.
        throw new KunForgrund('Kontakter slår «Nyt kort» fra, når vinduet ikke har fokus');
      });
      await vent(800);
      await c.skriv(A, c.token);
      // «Færdig» findes ikke altid (MÅLT 27/9 på macOS 15: ingen knap med navnet).
      await c.trykEn(A, [L({ en: 'Done', da: 'Færdig' })], { role: 'AXButton' }).catch(() => {});
    },
    async tjek(c) { const m = await c.ventPaa('com.apple.AddressBook', { contains: c.token }); return `kontakten «${m[0].name}» står i Kontakter`; },
    // Slettes KUN hvis præcis ét kort bærer prøvens navn og det er det viste.
    async ryd(c) {
      const A = 'com.apple.AddressBook';
      await c.k('computer_set_value', { app: A, subrole: 'AXSearchField', text: c.token }, { maaFejle: true });
      await vent(1500);
      const kort = await c.find(A, { contains: c.token, role: 'AXStaticText' });
      if (kort.length < 1) return `testkontakten ${c.token} blev ikke fundet igen - slet den i hånden`;
      const r = await c.k('computer_menus', { app: A, depth: 3 });
      const slet = (r.data?.items || []).find(x => /^(Delete Card|Slet kort)/.test(x.title || '') && x.enabled !== false);
      if (!slet) return `ingen «Slet kort» i menuen - testkontakten ${c.token} står der stadig`;
      await c.k('computer_menu', { app: A, path: slet.path }, { maaFejle: true });
      await vent(1500);
      return (await c.find(A, { contains: c.token })).length ? `testkontakten ${c.token} står der stadig` : 'testkontakten er slettet igen';
    },
  },
  whatsappBesked(10, 'skrive til folk', 'CMCP_BRUG_WHATSAPP_PERSON', 'et menneske Gustav har navngivet, som ved at der kommer en prøvebesked'),
  {
    nr: 11, navn: 'oprette en gruppe', apps: [WHATSAPP], klasse: 'mennesker',
    kraever: { CMCP_BRUG_WHATSAPP_PERSON: 'et menneske Gustav har navngivet - vedkommende bliver sat i en prøvegruppe' },
    async trin(c) {
      await c.start(WHATSAPP); await c.ventVindue(WHATSAPP);
      await c.menuTitel(WHATSAPP, /^(New Group|Ny gruppe)/);
      await c.k('computer_set_value', { app: WHATSAPP, subrole: 'AXSearchField', text: process.env.CMCP_BRUG_WHATSAPP_PERSON });
      await c.k('computer_press', { app: WHATSAPP, contains: process.env.CMCP_BRUG_WHATSAPP_PERSON, role: 'AXButton' });
      await c.trykEn(WHATSAPP, [L({ en: 'Next', da: 'Næste' })]);
      await c.skriv(WHATSAPP, `Prøvegruppe ${c.token}`);
      await c.trykEn(WHATSAPP, [L({ en: 'Create', da: 'Opret' })]);
    },
    async tjek(c) { const m = await c.ventPaa(WHATSAPP, { contains: c.token }); return `gruppen «${m[0].name}» findes`; },
  },
  aabn(12, 'åbne Agent360 IDE', 'com.agent360.ide'),
  // Et procesnavn står ens på alle sprog: står det i tabellen, er tabellen læst.
  // ⛔ 27/9 på en fremmed Mac: «WindowServer» vises ikke under «Mine processer».
  //    Finder kører altid som brugeren selv; rollen holder menupunkter ude.
  //    Navnet står med et mellemrum foran (« Finder», MÅLT), så det skal være «contains».
  aabn(13, 'åbne Aktivitetsovervågning', 'com.apple.ActivityMonitor', { laes: { role: 'AXStaticText', contains: 'Finder' } }),
  {
    nr: 14, navn: 'åbne og bruge Lommeregneren', apps: ['com.apple.calculator'], klasse: 'lokal',
    async trin(c) {
      const A = 'com.apple.calculator';
      await c.start(A); await c.ventVindue(A);
      await c.trykEn(A, [L({ en: 'All Clear', da: 'Ryd alt' }), L({ en: 'Clear', da: 'Ryd' })]);
      await c.trykEn(A, ['7']);
      await c.trykEn(A, [L({ en: 'Add', da: 'Plus' }), 'Plus', '+']);
      await c.trykEn(A, ['5']);
      await c.trykEn(A, [L({ en: 'Equals', da: 'Lig med' }), '=']);
    },
    async tjek(c) { const m = await c.ventPaa('com.apple.calculator', { contains: '12' }); return `displayet viser «${m[0].name}»`; },
    async ryd(c) { await c.trykEn('com.apple.calculator', [L({ en: 'All Clear', da: 'Ryd alt' }), L({ en: 'Clear', da: 'Ryd' })]).catch(() => {}); },
  },
  {
    // Søgefeltet i Finder og et filnavn er begge AXTextField; kun undertypen
    // skiller dem ad (P3, 27/9). Et gæt her ville omdøbe en fil.
    nr: 15, navn: 'finde ting med Finder', apps: ['com.apple.finder'], klasse: 'lokal',
    async trin(c) {
      c.fil = join(homedir(), 'Documents', `${c.token}-find-mig.txt`);
      mkdirSync(dirname(c.fil), { recursive: true });
      writeFileSync(c.fil, 'computer-mcp brugsscenarie 15\n');
      const foer = (await c.vinduer('com.apple.finder')).length;
      await c.menuGenvej('com.apple.finder', 'cmd+n');
      await c.ventVindue('com.apple.finder', { flereEnd: foer });
      // ⛔ 27/9 på en fremmed Mac: søgningen fandt intet på 60 s - søgning i
      //    Finder er Spotlight, og den kan være slået fra. Gå > Gå til mappe
      //    med filens sti finder den uden: Finder åbner mappen og vælger filen.
      await c.menuGenvej('com.apple.finder', 'shift+cmd+g');
      await vent(1000);
      await c.skriv('com.apple.finder', c.fil);
      await c.tast('com.apple.finder', 'return');
    },
    async tjek(c) { const m = await c.ventPaa('com.apple.finder', { contains: `${c.token}-find-mig` }, 60); return `Finder fandt «${m[0].name}»`; },
    async ryd(c) { if (c.fil) rmSync(c.fil, { force: true }); return 'prøvefilen er slettet; Finder-vinduet står åbent'; },
  },
  browserSide(16, 'åbne Google Maps med en adresse',
    'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Rådhuspladsen 1, 1550 København'), /Rådhuspladsen/),
  aabn(17, 'åbne Noter', 'com.apple.Notes'),
  aabn(18, 'åbne Spotify', 'com.spotify.client'),
  { ...aabn(19, 'åbne Kamera', 'com.apple.PhotoBooth'), klasse: 'kamera', laesHvisKoerer: false },
];

// ---------------------------------------------------------------------------
// KØRSLEN af ét scenarie: trin -> tjek -> ryd (altid) -> luk det, vi startede.
// ---------------------------------------------------------------------------
export async function koerScenarie(s, { forgrund = false, film: filmNavn, menneskeArbejder = false } = {}) {
  const spor = [], startede = new Set(), udenfor = [], tog = [];
  // 1/10: hvert rigtigt scenarie filmes paa en fremmed maskine (CMCP_FILM) - selvproevens attrapper ikke.
  const film = s.nr > 0 && filmNavn !== false
    ? startFilm(filmNavn || `brug-${forgrund ? 'forgrund' : 'baggrund'}-${String(s.nr).padStart(2, '0')}-${s.navn}`) : null;
  const srv = await nyServer({ tilladte: s.apps, forgrund });
  const c = vaerktoej(srv, { forgrund, startede, spor, apps: s.apps, udenfor, tog });
  const res = { nr: s.nr, navn: s.navn, status: '', bevis: '', ryd: '', spor };
  let fase = 'trin';
  // Løftet, målt pr. scenarie: i baggrunden er det program mennesket var i,
  // stadig forrest bagefter (27/9: Finder kom frem midt i en kørsel, og intet
  // enkelt svar sagde det).
  const forrest = async () => ((await srv.kald('computer_apps')).data?.apps || []).find(a => a.active)?.bundleId;
  const forrestFoer = await forrest();
  try {
    await s.trin(c);
    fase = 'tjek';
    const t = await s.tjek(c);
    res.bevis = typeof t === 'object' ? t.bevis : t;
    res.status = s.delvis || t?.delvis ? 'delvist' : 'bevist';
    if (t?.delvis) res.bevis += ` · ${t.delvis}`;
    const beholdt = tog.filter(t => !t.givetTilbage);
    if (beholdt.length) {
      res.status = 'fejlede';
      res.bevis = `tog skærmen og gav den ikke tilbage: ${beholdt.map(t => `${t.navn} (${t.hvorfor.slice(0, 80)})`).join('; ')} · ${res.bevis}`;
    } else if (tog.length) {
      // MANDAT: at tage skærmen og give den tilbage er stadig at tage skærmen.
      // Genopretning er bedre end intet, men den gør ikke et forløb til baggrund.
      res.status = 'delvist';
      res.bevis += ` · ${tog.length}x hentede et program sig selv frem (skærmen taget, forgrunden givet straks tilbage) - ikke rent baggrundsforløb`;
    }
  } catch (e) {
    res.status = e instanceof KunForgrund ? 'delvist' : 'fejlede';
    res.bevis = e instanceof KunForgrund ? `kun i forgrunden: ${e.message}`
      : `${fase}: ${e instanceof TrinFejl ? '' : 'uventet - '}${String(e.message || e).slice(0, 240)}`;
  } finally {
    // Løftet, også når scenariet fejlede: et program kan hente sig selv frem
    // sekunder efter (Kontakter, koersel 7) - og så skal skylden ligge her,
    // ikke hos næste scenarie.
    if (!forgrund) {
      await vent(2500);
      const forrestEfter = await forrest();
      res.forrest = `${forrestFoer} -> ${forrestEfter}`;
      // Paa en Mac hvor et menneske arbejder imens (parallel.mjs, egen Mac), skifter
      // HAN program. Kun scenariets egne programmer foran er saa scenariets skyld.
      if (forrestFoer && forrestEfter !== forrestFoer && (!menneskeArbejder || s.apps.includes(forrestEfter))) {
        res.status = 'fejlede';
        res.bevis = `tog skærmen: ${forrestFoer} var forrest, bagefter ${forrestEfter} · ${res.bevis}`;
      }
    }
    try { res.ryd = (s.ryd ? await s.ryd(c) : '') || ''; } catch (e) { res.ryd = `oprydningen fejlede: ${String(e.message).slice(0, 160)}`; }
    // Programmer scenariet selv startede, lukkes igen - gennem programmets egen
    // menu (genvejen er ens på alle sprog), for i baggrunden er computer_quit afvist.
    for (const app of startede) {
      try {
        if (forgrund) await c.k('computer_quit', { app }, { maaFejle: true });
        else await c.menuGenvej(app, 'cmd+q');
      } catch { res.ryd += ` · ${app} blev ikke lukket igen`; }
    }
    const rev = (await srv.kald('computer_audit', { limit: 1 })).data;
    res.revision = rev ? `${rev.total} linjer, kæden ${String(rev.chain).split(' ')[0]}` : 'ingen revisionslog';
    // Fejlede det, eller mangler noget: hvilke knapper programmet viste. Så kan
    // næste runde ramme det rigtige element i stedet for at gætte.
    if (res.status === 'fejlede' || res.status === 'delvist') {
      res.knapper = {};
      for (const app of s.apps) {
        const m = (await srv.kald('computer_find', { app, role: 'AXButton', limit: 40 })).data?.matches || [];
        res.knapper[app] = m.map(x => x.name).filter(Boolean).slice(0, 25);
      }
    }
    res.stoppet = srv.vagt.stoppet();
    res.samtykker = srv.spoerger.tekster().map(t => t.replace(/\s+/g, ' ').slice(0, 120));
    res.udenfor = udenfor;
    if (res.stoppet.length || udenfor.length) {
      res.status = 'fejlede';
      res.bevis += ` · ${res.stoppet.length + udenfor.length} handling(er) prøvede at nå et program uden for scenariet`;
    }
    srv.luk();
    if (film) res.film = await film.stop();
  }
  return res;
}

const MAERKE = { bevist: '✅', delvist: '◑', fejlede: '❌', 'ikke kørt': '⏸' };
function tabel(res) {
  for (const r of res) {
    console.log(`${MAERKE[r.status] || '?'} ${String(r.nr).padStart(2)} ${r.navn.padEnd(34)} ${r.bevis}${r.ryd ? ' · ' + r.ryd : ''}`);
    if (r.status === 'fejlede') for (const l of r.spor.slice(-4)) console.log(`        ${l}`);
    if (r.samtykker?.length) console.log(`        samtykke givet ${r.samtykker.length}x: ${r.samtykker.join(' | ')}`);
    for (const [app, k] of Object.entries(r.knapper || {})) if (k.length) console.log(`        knapper i ${app}: ${k.join(' · ')}`);
  }
  const bevist = res.filter(r => r.status === 'bevist').length;
  console.log(`\n${bevist} af ${res.length} bevist · ${res.filter(r => r.status === 'delvist').length} delvist · ${res.filter(r => r.status === 'fejlede').length} fejlede · ${res.filter(r => r.status === 'ikke kørt').length} ikke kørt`);
}

// ---------------------------------------------------------------------------
// SELVPRØVEN: maskineriet mod attrappen. Kører altid, rører intet andet.
// ---------------------------------------------------------------------------
async function selvproeve() {
  const fails = [];
  const check = (l, ok, d = '') => { console.log(`${ok ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!ok) fails.push(l); };

  // A. Erklæringerne: 19, nummereret 1-19, og hver har det en prøve skal have.
  const nr = SCENARIER.map(s => s.nr).sort((a, b) => a - b);
  check('A1 der er 19 scenarier, nummer 1 til 19', nr.length === 19 && nr.every((n, i) => n === i + 1), nr.join(','));
  const mangler = SCENARIER.filter(s => !s.navn || !s.apps?.length || !KLASSER.includes(s.klasse) || typeof s.trin !== 'function' || typeof s.tjek !== 'function');
  check('A2 hvert scenarie har navn, programmer, klasse, trin og tjek', mangler.length === 0, mangler.map(s => s.nr).join(','));
  const utilsigtet = SCENARIER.filter(s => ['mennesker', 'penge'].includes(s.klasse) && !Object.keys(s.kraever || {}).length);
  check('A3 hvert scenarie der når mennesker eller penge, kræver en navngivet modtager/app', utilsigtet.length === 0, utilsigtet.map(s => s.nr).join(','));

  // B. Porten, som ren funktion.
  const alle = SCENARIER.map(s => maaKoere(s, {}));
  check('B1 uden flag kører intet af de 19', alle.every(x => !x.ja));
  const lokal = SCENARIER.find(s => s.nr === 14), wa = SCENARIER.find(s => s.nr === 10), aab = SCENARIER.find(s => s.nr === 13), kam = SCENARIER.find(s => s.nr === 19);
  check('B2 «lokal» på en maskine der kan være Gustavs: nej', !maaKoere(lokal, { CMCP_BRUG: 'lokal' }).ja);
  check('B3 «lokal» på en fremmed maskine: ja', maaKoere(lokal, { CMCP_BRUG: 'lokal', CMCP_FREMMED_MASKINE: '1' }).ja);
  check('B4 «mennesker» uden navngiven modtager: nej', !maaKoere(wa, { CMCP_BRUG: 'mennesker', CMCP_FREMMED_MASKINE: '1' }).ja);
  check('B5 «mennesker» med modtager: ja', maaKoere(wa, { CMCP_BRUG: 'mennesker', CMCP_FREMMED_MASKINE: '1', CMCP_BRUG_WHATSAPP_PERSON: 'X' }).ja);
  check('B6 at åbne et program der allerede er åbent med et vindue, er «laes» - også på Gustavs Mac', maaKoere(aab, { CMCP_BRUG: 'laes' }, true).ja);
  check('B7 ...men ikke hvis det skal startes eller have et vindue', !maaKoere(aab, { CMCP_BRUG: 'laes' }, false).ja);
  check('B8 kameraet er aldrig «laes», heller ikke når det kører', !maaKoere(kam, { CMCP_BRUG: 'laes' }, true).ja);
  check('B9 forgrund uden CMCP_BRUG_TAG_SKAERMEN: nej',
    !maaKoere(lokal, { CMCP_BRUG: 'lokal', CMCP_FREMMED_MASKINE: '1', CMCP_BRUG_TILSTAND: 'forgrund' }).ja);

  // C. Maskineriet mod attrappen: en rigtig .app, vindue uden for synsvidde.
  const ARB = mkdtempSync(join(tmpdir(), 'cmcp-brug-attrap-'));
  const NAVN = 'cmcpbrug' + tilfaeldig(), BID = 'dk.agent360.cmcp.' + NAVN;
  const PAKKE = join(ARB, NAVN + '.app');
  mkdirSync(join(PAKKE, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(join(PAKKE, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${BID}</string>
<key>CFBundleName</key><string>${NAVN}</string>
<key>CFBundleExecutable</key><string>${NAVN}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>`);
  execFileSync('swiftc', ['-O', join(ROOT, 'test/fixture/proevemaal.swift'), '-o', join(PAKKE, 'Contents', 'MacOS', NAVN)], { stdio: 'pipe', timeout: 180000 });
  const attrap = spawn(join(PAKKE, 'Contents', 'MacOS', NAVN), { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await new Promise(r => { attrap.stdout.on('data', b => /pid=/.test(String(b)) && r()); setTimeout(r, 15000); });
    const felt = { role: 'AXTextField' };
    let ryddet = false;
    const skrivOgLaes = (forventet) => ({
      nr: 0, navn: 'attrap', apps: [BID], klasse: 'lokal',
      async trin(c) { await c.ventPaa(BID, felt, 60); c.tekst = `brug-${c.token}`; await c.skriv(BID, c.tekst); },
      async tjek(c) {
        const m = await c.find(BID, felt);
        const hvad = forventet === 'rigtig' ? c.tekst : 'noget-helt-andet';
        if (!m.some(x => (x.name || '').includes(hvad))) throw new TrinFejl(`feltet viser ikke «${hvad}»`);
        return `feltet viser «${hvad}»`;
      },
      async ryd() { ryddet = true; },
    });
    const c1 = await koerScenarie(skrivOgLaes('rigtig'));
    check('C1 et scenarie der gør det rigtige, er bevist', c1.status === 'bevist', c1.bevis);
    check('C2 ...og revisionsloggen har linjerne', /^\d+ linjer, kæden intact/.test(c1.revision) && parseInt(c1.revision) > 0, c1.revision);

    ryddet = false;
    const c2 = await koerScenarie(skrivOgLaes('forkert'));
    check('C3 et tjek der ikke ser det forventede, er rødt - og siger at det var tjekket', c2.status === 'fejlede' && c2.bevis.startsWith('tjek:'), c2.bevis);
    check('C4 oprydningen kører også når scenariet fejler', ryddet);

    const c3 = await koerScenarie({ nr: 0, navn: 'trin fejler', apps: [BID], klasse: 'lokal',
      async trin(c) { await c.k('computer_press', { app: BID, title: 'findes-ikke-' + c.token }); },
      async tjek() { return 'burde aldrig nås'; } });
    check('C5 et trin der fejler, er rødt ved trinnet - tjekket nås ikke', c3.status === 'fejlede' && c3.bevis.startsWith('trin:'), c3.bevis);

    const FREMMED = 'dk.agent360.cmcp.findesikke' + tilfaeldig();
    const c4 = await koerScenarie({ nr: 0, navn: 'uden for sin liste', apps: [BID], klasse: 'lokal',
      async trin(c) { try { await c.k('computer_type', { app: FREMMED, text: 'maa-ikke-naa-frem' }, { maaFejle: true }); } catch {} },
      async tjek() { return 'ser grønt ud'; } });
    check('C6 en handling mod et program uden for scenariet er rød, selv når scenariet fanger fejlen og tjekket er grønt',
      c4.status === 'fejlede' && c4.udenfor.some(l => l.includes(FREMMED)), `${c4.status} · ${c4.udenfor.join(', ')}`);
    check('C6b ...og den nåede aldrig serveren', !c4.spor.some(l => l.includes(FREMMED)) && c4.stoppet.length === 0);

    const c5 = await koerScenarie({ nr: 0, navn: 'delvist', apps: [BID], klasse: 'lokal', delvis: 'resten er ikke skrevet',
      async trin() {}, async tjek() { return 'første del'; } });
    check('C7 et scenarie med et kendt hul kan aldrig blive «bevist»', c5.status === 'delvist', c5.status);
  } finally {
    try { attrap.kill(); } catch {}
    rmSync(ARB, { recursive: true, force: true });
  }
  return fails;
}

// ---------------------------------------------------------------------------
// 1/10: filen kan importeres (test/parallel.mjs) uden at koere sig selv.
if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])) {
const fails = await selvproeve();
const forgrund = process.env.CMCP_BRUG_TILSTAND === 'forgrund';
const res = [];
if (process.env.CMCP_BRUG) {
  console.log(`\nBrugsscenarierne · ${forgrund ? 'forgrund' : 'baggrund'} · sprog ${SPROG}`);
  const koerer = new Set((JSON.parse(execFileSync(AEGTE, ['apps'], { encoding: 'utf8' })).apps || []).map(a => a.bundleId));
  // Kører det uden vindue (Aktivitetsovervågning efter at mennesket lukkede det),
  // ændrer et nyt vindue skærmen: så er det ikke længere «laes».
  const harVindue = (a) => { try { return JSON.parse(execFileSync(AEGTE, ['windows', '--app', a], { encoding: 'utf8' })).count > 0; } catch { return false; } };
  // Et program der ikke findes på maskinen, er ikke en fejl i produktet.
  const opslag = (a) => { try { return JSON.parse(execFileSync(AEGTE, ['resolve-app', '--app', a], { encoding: 'utf8' })); } catch { return { ok: false }; } };
  // ⛔ 27/9 på en fremmed Mac: Chrome bar macOS' kvarantæne-mærke (hentet fra nettet,
  //    aldrig åbnet), og første start rejste «Er du sikker?». Den dialog klikker
  //    hverken produktet eller prøven sig forbi - og den blev stående og tog
  //    forgrunden i alle scenarier efter. Mærket læses på selve programmet.
  const kvarantaene = (sti) => { try { execFileSync('xattr', ['-p', 'com.apple.quarantine', sti], { stdio: 'pipe' }); return true; } catch { return false; } };
  for (const s of SCENARIER) {
    const port = maaKoere(s, process.env, s.apps.every(a => koerer.has(a) && harVindue(a)));
    const svar = port.ja ? s.apps.map(a => [a, opslag(a)]) : [];
    const mangler = svar.filter(([, o]) => !o.ok).map(([a]) => a);
    const spaerret = svar.filter(([a, o]) => o.ok && o.path && !koerer.has(a) && kvarantaene(o.path)).map(([a]) => a);
    res.push(!port.ja ? { nr: s.nr, navn: s.navn, status: 'ikke kørt', bevis: port.grund, spor: [] }
      : mangler.length ? { nr: s.nr, navn: s.navn, status: 'ikke kørt', bevis: `${mangler.join(', ')} findes ikke på denne maskine`, spor: [] }
      : spaerret.length ? { nr: s.nr, navn: s.navn, status: 'ikke kørt', bevis: `${spaerret.join(', ')} er aldrig åbnet her (macOS' kvarantæne-mærke) - første åbning kræver et menneskes ja`, spor: [] }
      : await koerScenarie(s, { forgrund }));
  }
} else {
  for (const s of SCENARIER) res.push({ nr: s.nr, navn: s.navn, status: 'ikke kørt', bevis: maaKoere(s, process.env).grund, spor: [] });
  console.log('\nBrugsscenarierne (kun selvprøven kørte - sæt CMCP_BRUG for at køre dem):');
}
tabel(res);
if (process.env.CMCP_BRUG_RAPPORT) writeFileSync(process.env.CMCP_BRUG_RAPPORT, JSON.stringify({ tid: new Date().toISOString(), forgrund, sprog: SPROG, res }, null, 2));
const roede = res.filter(r => r.status === 'fejlede');
console.log(fails.length ? `DUMPET: ${fails.length} tjek i selvprøven` : 'Selvprøven bestået.');
process.exit(fails.length || roede.length ? 1 : 0);
}
