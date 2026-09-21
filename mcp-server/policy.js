import { execFile } from 'child_process';

/// Tre niveauer. Inddelingen er ikke kosmetisk - den afgoer hvad der kan ske
/// mens mennesket ikke kigger.
export const TIER = { READ: 'read', WRITE: 'write', DANGER: 'danger' };

/// Programmer hvor ENHVER handling spoerger, hver gang, uanset tilstand.
///
/// To slags: dem der opbevarer hemmeligheder, og dem hvor et tastetryk ER en
/// kommando. Et klik i en terminal er ikke et klik i en tekstbehandler - det
/// kan slette et helt hjemmebibliotek. Vores egen analyse fra juni pegede
/// praecis paa den vej: en prompt-indsproejtning under "research" der bliver
/// til en fysisk handling i et terminalvindue.
export const ALWAYS_ASK_APPS = new Set([
  'com.apple.keychainaccess', 'com.apple.Passwords',
  'com.agilebits.onepassword7', 'com.1password.1password',
  'com.bitwarden.desktop', 'com.lastpass.LastPass', 'com.dashlane.Dashlane',
  'com.apple.Terminal', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable',
  'co.zeit.hyper', 'net.kovidgoyal.kitty', 'io.alacritty'
]);

/// Menupunkter der ALTID spoerger, ogsaa i `allow`.
///
/// ⛔ Det her er en HEURISTIK, og det siges ogsaa til mennesket i dialogen.
///    Huset har en regel om at danske ord ikke kan baere en regel - otte
///    substring-fejl i een fil, fordi "slet" ogsaa staar i "sletning af
///    markering". Den regel gaelder stadig, OG asymmetrien er en anden her:
///    en falsk positiv koster een dialog, en falsk negativ kan koste en
///    browserhistorik eller en postkasse. Derfor er listen bred med vilje,
///    og dialogen viser HELE stien, saa mennesket - ikke listen - afgoer det.
///
///    Dansk og engelsk, fordi menulinjen er paa systemets sprog: Gustavs
///    Chrome siger "Slet browserdata…", ikke "Clear browsing data…".
const FARLIGE_MENUORD = [
  'slet', 'delete', 'ryd', 'clear', 'erase', 'fjern', 'remove',
  'nulstil', 'reset', 'papirkurv', 'trash', 'afslut', 'quit',
  'log ud', 'sign out', 'log out', 'deaktiver', 'deactivate',
  'afinstaller', 'uninstall', 'formater', 'format disk'
];

/// Ser stien farlig ud? Sammenlignes i smaa bogstaver, paa HELE stien - saa
/// "Arkiv > Slet browserdata" fanges, og det goer "Rediger > Slet" ogsaa.
export function menuSerFarlig(path) {
  const p = String(path || '').toLowerCase();
  return FARLIGE_MENUORD.some(o => p.includes(o));
}

export const MODES = new Set(['readonly', 'ask', 'allow']);

export function currentMode() {
  const m = (process.env.CMCP_MODE || 'allow').toLowerCase();
  return MODES.has(m) ? m : 'allow';
}

/// Baggrunds-tilstand: serveren maa ALDRIG tage skaermen.
///
/// ⛔ Gustav, 20/9: "sikre den altid koerer i baggrunden og aldrig tager
///    opmaerksomheden paa skaermen". Det er ikke en vane man kan love sig til -
///    det er en egenskab der skal kunne naegtes med.
///
/// Med CMCP_BACKGROUND=1 afvises alt der:
///   - flytter den rigtige markoer eller sender tastetryk
///   - henter et program frem, starter eller afslutter et
///   - skifter skrivebord
///   - rejser vores EGEN dialog
///
/// Tilbage staar den stille vej: se, og handle gennem tilgaengeligheds-API'et
/// paa et vindue der ligger bagved. Den flytter ingenting mennesket kigger paa.
///
/// ⚠️ Og det aerlige forbehold: vi lover kun noget om det VI goer. Trykker
/// agenten paa en knap i et program, kan programmet selv aabne et vindue. Det
/// er programmets valg, ikke vores - og det staar paa sitet i samme aandedrag.
///
/// Fordi dialogen ogsaa er noget der tager skaermen, kan en skrivende handling
/// i denne tilstand ikke spoerge. Den afvises i ask, og udfoeres kun i allow.
/// At lade den gaa igennem tavst ville vaere et samtykke ingen har givet.
export function baggrund() {
  // ⛔ HISTORIEN, saa ingen vender den tilbage uden at kende den.
  //
  //    20/9 valgte Gustav baggrund som STANDARD efter 283 dialoger paa to dage.
  //    Rigtig reflex, forkert mekanisme. MAALT 21/9: de 283 var ikke
  //    samtykke-porten. 81 var `computer_ask_user` - agenten der SELV valgte at
  //    spoerge. 176 kom i mode=allow, som slet ikke skal spoerge. Og memory fra
  //    samme dag: «intet fra produktet» - de kom fra testkoersler.
  //    Samtykke-porten koster ÉN dialog pr. session (sessionGranted).
  //
  //    Baggrund som standard kostede til gengaeld produktet: 15 af 28
  //    vaerktoejer tilbudt, alle fire skrivende afvist, og `computer_ask_user`
  //    spaerret - saa agenten kunne ikke engang raekke ud til mennesket.
  //
  //    21/9 sagde Gustav retningen tre gange og gav saa ordet: «autonom».
  //    Standarden er derfor FRA. Den der vil koere uovervaaget slaar den til.
  //    Tilbage staar de to porte der faktisk beskytter noget: adgangskode-
  //    programmer og destruktive handlinger spoerger HVER gang, ogsaa i allow.
  const v = String(process.env.CMCP_BACKGROUND ?? '').trim().toLowerCase();
  if (v === '') return false;
  return !['0', 'false', 'no', 'off', 'nej', 'fra'].includes(v);
}

/// De vaerktoejer der ikke kan holdes i baggrunden.
export const TAGER_SKAERMEN = new Set([
  'computer_click', 'computer_move', 'computer_scroll', 'computer_type',
  'computer_key', 'computer_drag', 'computer_paste',
  'computer_activate', 'computer_launch', 'computer_quit',
  'computer_space', 'computer_window', 'computer_ask_user'
]);

/// ⛔ De fire der IKKE laengere behoever at tage skaermen (21/9-2026).
///
///    Indtil i dag var «tager skaermen» en egenskab ved vaerktoejets NAVN.
///    Det var forkert: det der tager skaermen er LEVERINGSKANALEN. De her
///    fire kan nu faa et `app`, og saa gaar haendelsen i dét programs egen
///    koe i stedet for i den globale stroem - markoeren bliver staaende, og
///    intet kommer frem.
///
///    MAALT gennem produktet, mens mennesket arbejdede i en anden app:
///    teksten ankom, markoeren stod stille, forgrunden skiftede ikke, og
///    svaret sagde selv `took_screen: false`.
///
///    De resterende ni kan ikke endnu, og nogle kan aldrig: `move` ER
///    markoeren, `activate` og `space` har som JOB at flytte mennesket, og
///    `ask_user` er en dialog. `drag`, `paste`, `launch`, `quit` og `window`
///    er ikke bygget om endnu - og indtil de er, staar de her som larmende.
export const KAN_STILLES = new Set([
  'computer_type', 'computer_key', 'computer_scroll', 'computer_click'
]);

/// Tager DETTE kald skaermen? Ikke vaerktoejet - kaldet.
///
/// Det er hele skiftet: en haandskreven navneliste er en hensigt, og den kan
/// ikke se forskel paa `computer_type` der lander i menneskets vindue og
/// `computer_type --app Slack` der lander i Slacks koe.
export function tagerSkaermen(name, args) {
  if (!TAGER_SKAERMEN.has(name)) return false;
  if (KAN_STILLES.has(name) && args && args.app) return false;
  return true;
}


/// Sessionens samtykke. Bevidst kun i hukommelsen: lukkes serveren, er
/// samtykket vaek. Et samtykke der overlever paa disken, er et samtykke
/// brugeren ikke kan huske at have givet.
let sessionGranted = false;
export function resetSession() { sessionGranted = false; }
export function isSessionGranted() { return sessionGranted; }

/// Spoerger mennesket med en aegte macOS-dialog.
///
/// Svarer ingen inden for tidsgraensen, er svaret NEJ. Det er den eneste
/// forsvarlige standard: en dialog der ender med "ja" fordi ingen saa den,
/// er ikke et samtykke - saa havde vi lige saa godt kunnet lade vaere at spoerge.
/// Hvem viser dialogen?
///
/// ⛔ FUNDET AF RAADGIVEREN 19/9. Spoergeren var haardkodet til
/// `/usr/bin/osascript`, og derfor kunne INGEN proeve paa samtykke-porten koere
/// uden at vise en aegte hvid boks paa menneskets skaerm. MAALT i den rigtige
/// revisionslog: 323 gange paa to dage blev et menneske spurgt, 274 af dem
/// udloeb ubesvaret. Naesten alle kom fra proevekoersler.
///
/// Med denne ene linje kan proeverne saette en attrap ind, koere HELE vejen
/// gennem den rigtige beslutningskode og den rigtige svar-tolkning, og stadig
/// ikke roere skaermen.
///
/// Giver den nogen ny magt til en angriber? Nej. Den der kan saette denne
/// variabel, kan ogsaa saette CMCP_MODE=allow - og saa spoerges der slet ikke.
/// Seam'en aabner intet der ikke allerede var aabent samme vej.
export function spoergerKommando() {
  return process.env.CMCP_OSASCRIPT || '/usr/bin/osascript';
}

export function askTimeout() {
  const v = Number(process.env.CMCP_ASK_TIMEOUT);
  return Number.isFinite(v) && v > 0 ? v : 60;
}

export function askHuman(title, body, timeoutSec = askTimeout()) {
  return new Promise((resolve) => {
    const script = [
      'display dialog',
      JSON.stringify(body),
      'with title', JSON.stringify(title),
      'buttons {"No", "Yes"} default button "No"',
      `giving up after ${timeoutSec}`
    ].join(' ');
    execFile(spoergerKommando(), ['-e', script], { timeout: (timeoutSec + 10) * 1000 }, (err, stdout) => {
      if (err) return resolve(false);
      const out = String(stdout);
      if (/gave up:true/.test(out)) return resolve(false);
      resolve(/button returned:Yes/.test(out));
    });
  });
}

/// Beder mennesket goere noget selv - og returnerer KUN om det blev gjort.
///
/// ⛔ Den returnerer aldrig tekst. Det er hele pointen. Panelet 19/9 (Fable +
/// sikkerhedsgennemgangen) landede uafhaengigt af hinanden paa samme udgave:
/// agenten saetter fokus i feltet, mennesket taster paa sit EGET tastatur, og
/// vi faar en boolean tilbage. Ingen kodesti i produktet holder nogensinde en
/// hemmelighed - heller ikke i hukommelsen, heller ikke i tyve millisekunder.
///
/// Soesterproduktet goer det modsatte: `browser_ask_user` har et
/// `type: password`-felt og sender vaerdien til modellen. Det er ikke en
/// praecedens vi foelger - det er en aaben fejl vi ikke kopierer.
///
/// `hvor` skrives af SERVEREN, ikke af modellen. Uden den linje kan en
/// prompt-indsproejtning faa dialogen frem paa et falsk paaskud og faa
/// mennesket til at taste i et felt agenten selv har valgt.
export function askHumanToDo(message, hvor, timeoutSec = askTimeout()) {
  const body = [
    String(message).slice(0, 400),
    '',
    hvor ? `What you type goes into: ${hvor}` : 'We could not work out where this lands. Check for yourself before you type.',
    '',
    'Computer MCP does not see what you type, and it is not written to the log.'
  ].join('\n');
  return new Promise((resolve) => {
    const script = [
      'display dialog', JSON.stringify(body),
      'with title', JSON.stringify('Computer MCP'),
      'buttons {"Cancel", "Done"} default button "Done"',
      `giving up after ${timeoutSec}`
    ].join(' ');
    execFile(spoergerKommando(), ['-e', script], { timeout: (timeoutSec + 10) * 1000 }, (err, stdout) => {
      if (err) return resolve(false);
      const out = String(stdout);
      if (/gave up:true/.test(out)) return resolve(false);
      resolve(/button returned:Done/.test(out));
    });
  });
}

/// Afgoer hvad der skal ske med ét kald. Returnerer {allow, reason, asked}.
export async function decide({ tier, targetBundleId, describe, alwaysAsk = false }) {
  const mode = currentMode();

  // ⛔ FUNDET AF SIKKERHEDSREVIEWET 20/9, og det var en Critical i netop den
  //    egenskab Gustav bad om. Porten i index.js afviste kun de tretten
  //    vaerktoejer der SELV tager skaermen - men `decide()` kendte slet ikke
  //    baggrunds-tilstanden, saa press, set_value, menu og et usloeret
  //    skaermbillede naaede stadig HERIND og rejste dialogen.
  //
  //    MAALT gennem attrappen, foer rettelsen: seks af otte tilfaelde gav et
  //    dialog-forsoeg. Paa en rigtig maskine er hvert af dem en hvid boks - i
  //    den ene tilstand hvis hele loefte er at der ikke kommer nogen.
  //
  //    En dialog er ogsaa noget der tager skaermen. Derfor: naar vi staar over
  //    for at skulle spoerge, og vi er i baggrunds-tilstand, AFVISER vi i
  //    stedet. At lade den gaa igennem tavst ville vaere et samtykke ingen har
  //    givet; at spoerge ville braende loeftet af.
  const naegtIStedetForAtSpoerge = () => ({
    allow: false, asked: false,
    reason: 'background mode: this would need a dialog, and a dialog takes the screen'
  });


  if (tier === TIER.READ) return { allow: true, reason: 'read-only action', asked: false };

  if (mode === 'readonly') {
    return {
      allow: false, asked: false,
      reason: 'CMCP_MODE=readonly: only read tools are allowed. Set CMCP_MODE=ask to let the agent drive the machine.'
    };
  }

  const dangerousApp = targetBundleId && ALWAYS_ASK_APPS.has(targetBundleId);

  /// Kunne vi ikke afgoere HVILKET program handlingen rammer, ved vi heller
  /// ikke om det er en terminal eller en adgangskode-boks. Saa spoerger vi.
  ///
  /// ⛔ MAALT 18/9: `frontmostBundleId()` giver `null` naar opslaget fejler
  /// eller tager over fem sekunder - og samme aften tog hjaelperen 23-38
  /// sekunder fordi maskinen stod paa load 143. Foer denne linje svarede
  /// porten da `allow=true, asked=false`: et klik eller et tastetryk i en
  /// terminal gik igennem uden dialog, praecis naar maskinen var mest presset.
  ///
  /// Et produkt hvis princip er at fejle LUKKET, maa ikke fejle aabent paa
  /// sin egen hovedspaerre. Et ukendt maal er et farligt maal.
  const unknownTarget = !targetBundleId;

  // Farlige programmer spoerger HVER gang - ogsaa i allow-tilstand, og ogsaa
  // selvom sessionen allerede har givet samtykke. Det er hele forskellen paa
  // "jeg gav agenten lov til at arbejde" og "jeg gav agenten min adgangskode".
  // `alwaysAsk` saettes af kalderen naar handlingen selv ser farlig ud - i dag
  // et menupunkt der hedder noget med slet, ryd eller afslut. Den kan kun
  // TILFOEJE til denne kaede, aldrig fjerne noget fra den.
  if (tier === TIER.DANGER || dangerousApp || unknownTarget || alwaysAsk) {
    if (baggrund()) return naegtIStedetForAtSpoerge();
    const ok = await askHuman(
      'Computer MCP',
      alwaysAsk
        ? `${describe}\n\nThis looks like it deletes or clears something. We recognise that from the words in the name, so we can be wrong in both directions - read the path above, that is the part that is certain.\n\nAllow this one action?`
        : targetBundleId
        ? `${describe}\n\nThis happens in ${targetBundleId}, which always asks.\n\nAllow this one action?`
        : `${describe}\n\nWe could NOT work out which app this lands in, so we cannot tell whether it is a terminal or a password box.\n\nAllow this one action?`
    );
    return { allow: ok, asked: true, reason: ok ? 'the person said yes' : 'the person said no, or did not answer' };
  }

  if (mode === 'allow') return { allow: true, reason: 'CMCP_MODE=allow', asked: false };
  if (sessionGranted) return { allow: true, reason: 'this session already has consent', asked: false };

  if (baggrund()) return naegtIStedetForAtSpoerge();

  const ok = await askHuman(
    'Computer MCP',
    `An agent wants to control your Mac.\n\nFirst action: ${describe}\n\nIf you say yes, it may click and type for the rest of this session. Password fields are always blacked out, and apps like 1Password and Terminal ask every single time.\n\nAllow for this session?`
  );
  if (ok) sessionGranted = true;
  return { allow: ok, asked: true, reason: ok ? 'the session was granted consent' : 'the person said no, or did not answer' };
}
