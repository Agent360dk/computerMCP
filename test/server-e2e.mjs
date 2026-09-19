// Taler MCP-protokollen mod serveren som en rigtig klient ville.
// Koeres i readonly, saa der ikke popper samtykke-dialoger op i en proeve.
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, CMCP_MODE: process.env.CMCP_MODE || 'readonly' };
const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')], { env, stdio: ['pipe', 'pipe', 'pipe'] });

let buf = '';
const pending = new Map();
srv.stdout.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    } catch { /* ikke vores */ }
  }
});
srv.stderr.on('data', d => process.stderr.write('  [server] ' + d));

let id = 0;
function rpc(method, params = {}) {
  const myId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(myId, resolve);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
    setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); reject(new Error(`timeout: ${method}`)); } }, 60000);
  });
}

const fails = [];
// MUTATIONSBEVIS 19/9 - begge koert, begge dumpede som de skulle:
//   `wait_for` melder success i stedet for timeout (try/catch om kaldet)
//       -> DUMP 'wait_for giver op i stedet for at haenge'. IKKE sprunget over.
//   skaermbilledet tvinges til --no-redact
//       -> DUMP 'sloering er standard'. IKKE sprunget over.
//
// ⛔ Den FOERSTE udgave af den foerste mutation var vaerdiloes: jeg lagde den
//    paa linjen efter `await callHelper(...)`, men callHelper KASTER ved
//    ok:false, saa linjen var doed kode. Proeven blev groen, og det lignede et
//    bevis. En groen proeve efter en mutation har to forklaringer - vagten
//    holder, eller mutationen kom aldrig i spil. Afgoer altid hvilken.
const skips = [];
function check(label, cond, detail = '') {
  console.log(`${cond ? 'OK  ' : 'DUMP'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!cond) fails.push(label);
}
/// Et tjek der ikke kunne maale noget, bestaar ikke - det siger hoejt at det
/// ikke bevist noget. En groen suite der maalte en tom skaerm, er praecis den
/// fejl proeverne er her for at undgaa.
function skip(label, why) {
  console.log(`SPR. ${label} - ${why}`);
  skips.push(label);
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'proeve', version: '1' }
  });
  check('haandtryk', !!init.result?.serverInfo, init.result?.serverInfo?.name + ' ' + init.result?.serverInfo?.version);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const list = await rpc('tools/list');
  const names = (list.result?.tools || []).map(t => t.name);
  check('vaerktoejsliste', names.length > 0, `${names.length} stk.`);
  check('readonly skjuler haenderne', !names.includes('computer_click'),
        names.includes('computer_click') ? 'computer_click er SYNLIG i readonly' : 'ingen skrive-vaerktoejer synlige');
  // computer_press er ogsaa en haand, selvom den ikke flytter musen. Tilfoejes
  // et skrivende vaerktoej uden at komme med i readonly-filteret, er loeftet
  // "haenderne findes ikke" kun sandt for dem der stod der i forvejen.
  check('readonly skjuler ogsaa press', !names.includes('computer_press'),
        names.includes('computer_press') ? 'computer_press er SYNLIG i readonly' : 'press er heller ikke synlig');
  // At banke paa ruden er ogsaa en handling: en agent der ikke maa roere noget,
  // skal heller ikke kunne afbryde mennesket med dialoger.
  check('readonly skjuler ogsaa ask_user', !names.includes('computer_ask_user'),
        names.includes('computer_ask_user') ? 'SYNLIG i readonly' : 'skjult');
  check('find er et laesende vaerktoej', names.includes('computer_find'),
        names.join(', ').slice(0, 70));

  const perms = await rpc('tools/call', { name: 'computer_permissions', arguments: {} });
  const ptxt = perms.result?.content?.[0]?.text || '';
  check('rettigheds-opslag', ptxt.includes('accessibility'), ptxt.slice(0, 80).replace(/\s+/g, ' '));

  const apps = await rpc('tools/call', { name: 'computer_apps', arguments: {} });
  const atxt = apps.result?.content?.[0]?.text || '';
  check('programliste', atxt.includes('bundleId'));

  const shot = await rpc('tools/call', { name: 'computer_screenshot', arguments: { maxWidth: 800 } });
  const parts = shot.result?.content || [];
  const img = parts.find(p => p.type === 'image');
  // ⛔ MAALT 19/9: BEGGE naeste tjek dumpede - paa ET kald. Optagelsen ramte
  //    45-sekunders-loftet fordi maskinen stod paa load 32 med 54 MB fri RAM og
  //    88 % fuld swap, saa `img` blev tom og baade billedet og sloeringen faldt.
  //    En hjaelper der aldrig svarede, siger intet om hverken billedet eller
  //    sloeringen. Springer over, saa en regression stadig kan blive roed.
  const shotErr = shot.result?.content?.find(p => p.type === 'text')?.text || '';
  const shotStalled = !img && /helper-timeout|svarede ikke inden for/i.test(shotErr);
  // Hele vendingen, ikke et ord-stump. MAALT 18/9: proeven tjekte smaat
  // "sloeret", teksten skiftede til stort "Sloeret", og proeven blev roed paa
  // en aendring der VIRKEDE. Samme fejlklasse som husets otte substring-fejl:
  // match den hele vending, aldrig to tegn af den.
  const shotText = parts.find(p => p.type === 'text')?.text || '';
  if (shotStalled) {
    skip('skaermbillede', 'hjaelperen svarede ikke - maskinen, ikke koden (bevist intet)');
    skip('sloering er standard', 'ingen optagelse at bedoemme (bevist intet)');
  } else {
    check('skaermbillede', !!img,
          img ? `${Math.round(img.data.length / 1024)} KB base64, ${parts[0]?.text}` : 'intet billede');
    check('sloering er standard',
          /\bSloeret \(\d+ omraader\)/i.test(shotText) && !/IKKE sloeret/i.test(shotText),
          shotText.slice(-40));
  }

  // ⛔ MAALT 19/9 paa en Mac med TRE skaerme: `content.displays.first` betoed at
  //    to tredjedele af skrivebordet var usynligt, uden fejl og uden et ord i
  //    svaret. En hel dags flakiness i redaction-live laa her: Chrome aabnede paa
  //    den indbyggede skaerm (1710x1107 punkter), og vi fotograferede en ekstern
  //    (1920x1080). Vagten kraever at svaret SIGER det, naar der er flere.
  //
  //    Paa en maskine med een skaerm kan det ikke proeves. Den springer over og
  //    siger det - den lader aldrig som om den maalte noget.
  if (!shotStalled) {
    // ⛔ FOERSTE UDGAVE AF DENNE VAGT VAR CIRKULAER, og mutationen afsloerede det:
    //    den udledte antallet af skaerme af OM saetningen stod der. Fjernede man
    //    saetningen, konkluderede proeven "een skaerm" og sprang over - paa en
    //    maskine med tre. En skip-gren der sluger sin egen regression.
    //
    //    Tallet kommer nu fra en ANDEN kodesti: hjaelperen afvises med --display 99
    //    og siger i fejlen hvor mange der findes. Succes-teksten kan ikke paavirke den.
    const { execFileSync } = await import('child_process');
    let antalSkaerme = 1;
    try {
      const ud = execFileSync(join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper'),
        ['screenshot', '--display', '99', '--out', '/dev/null'],
        { encoding: 'utf8', timeout: 30000 });
      antalSkaerme = Number(/har (\d+) skaerm/.exec(ud)?.[1] || 1);
    } catch (e) {
      antalSkaerme = Number(/har (\d+) skaerm/.exec(String(e.stdout || e.message))?.[1] || 1);
    }
    if (antalSkaerme <= 1) {
      skip('svaret naevner de andre skaerme',
           'hjaelperen melder een skaerm - kan ikke proeves her (bevist intet)');
    } else {
      check('svaret naevner de andre skaerme',
            new RegExp(`Maskinen har ${antalSkaerme} skaerme`).test(shotText)
              && /dette er skaerm \d+/.test(shotText)
              && /proev display: /.test(shotText),
            `hjaelperen melder ${antalSkaerme} skaerme; svaret ${/Maskinen har/.test(shotText) ? 'naevner dem' : 'TIER om dem'}`);
    }
  }

  // Skrivende vaerktoej i readonly SKAL afvises
  const click = await rpc('tools/call', { name: 'computer_click', arguments: { x: 10, y: 10 } });
  const ctxt = click.result?.content?.[0]?.text || '';
  check('klik afvist i readonly', click.result?.isError === true && /readonly/.test(ctxt), ctxt.slice(0, 60).replace(/\s+/g, ' '));

  const press = await rpc('tools/call', {
    name: 'computer_press', arguments: { app: 'com.apple.finder', title: 'FINDES-IKKE-e2e' }
  });
  const prtxt = press.result?.content?.[0]?.text || '';
  check('press afvist i readonly', press.result?.isError === true && /readonly/.test(prtxt),
        prtxt.slice(0, 60).replace(/\s+/g, ' '));

  // find: vejen der goer at en agent kan handle paa "knappen der hedder X"
  // i stedet for paa en pixel. Rammerne kommer i PUNKTER - samme enhed som
  // computer_click - saa der er ingen maalestok at gaa galt i.
  const found = await rpc('tools/call', { name: 'computer_find', arguments: { role: 'AXWindow', limit: 5 } });
  let fd = {};
  try { fd = JSON.parse(found.result?.content?.[0]?.text || '{}'); } catch {}
  const hits = fd.matches || [];
  if (!hits.length) {
    // Ingen vinduer fremme = et fuldskaerms-program ejer denne Space.
    // Proeven kan ikke maale noget, og siger det i stedet for at bestaa.
    skip('find giver rammer og tryk-egnethed', 'ingen vinduer paa den Space der er fremme');
  } else {
    check('find giver rammer og tryk-egnethed',
          hits.every(m => m.frame && m.center && typeof m.pressable === 'boolean'),
          `${hits.length} traef, foerste: ${hits[0].app} ${hits[0].role}`);
    const inside = hits.every(m => m.center.x >= -8000 && m.center.x <= 8000);
    check('midtpunkterne er punkter, ikke pixels', inside,
          `foerste midtpunkt ${Math.round(hits[0].center.x)}, ${Math.round(hits[0].center.y)}`);
  }

  // computer_wait_for: at vente er en LAESENDE handling, saa den skal findes i
  // readonly - og den skal give op aerligt i stedet for at haenge.
  check('wait_for er laesende og synlig i readonly', names.includes('computer_wait_for'),
        names.includes('computer_wait_for') ? 'synlig' : 'MANGLER i readonly');

  const t0 = Date.now();
  const w1 = await rpc('tools/call', { name: 'computer_wait_for', arguments: { role: 'AXWindow', timeout: 10 } });
  let wd = {}; try { wd = JSON.parse(w1.result?.content?.[0]?.text || '{}'); } catch {}
  if (wd.found !== true) {
    skip('wait_for finder noget der findes', 'ingen vinduer paa denne Space');
  } else {
    check('wait_for finder noget der findes', true, `${wd.attempts} forsoeg, ${Math.round((Date.now()-t0)/100)/10}s`);
  }

  // ⛔ Det afgoerende: den skal GIVE OP. Uden denne linje ville «vent for evigt»
  //    bestaa proeven ovenfor, og en agent ville haenge i stedet for at faa et svar.
  const t1 = Date.now();
  const w2 = await rpc('tools/call', {
    name: 'computer_wait_for',
    arguments: { role: 'AXButton', title: 'FINDES-ALDRIG-e2e-9f3a', timeout: 3 }
  });
  const spent = (Date.now() - t1) / 1000;
  const wtxt = w2.result?.content?.[0]?.text || '';
  // ⛔ MAALT 19/9: dette tjek dumpede med `helper-timeout` efter 23,2s. Isoleret
  //    koerte det paa 5,9s med den RIGTIGE fejl. Aarsagen var maskinen: load 32
  //    (48 over femten minutter) og ~100 MB fri RAM. Tredje gang i dag at en
  //    proeve maalte maskinen i stedet for koden.
  //
  //    Proeven kender allerede forskellen og brugte den bare ikke. `wait-timeout`
  //    er vores kode der giver op korrekt. `helper-timeout` er hjaelperen der
  //    aldrig naaede at svare - det siger intet om adfaerden vi proever paa.
  //    Den skelner nu: rigtig fejl = bestaaet, hjaelperen stallede = SPRUNGET
  //    OVER. En proeve der ikke kunne maale, er ikke et resultat.
  const stalled = /helper-timeout|hjaelperen svarede ikke/i.test(wtxt);
  if (stalled) {
    skip('wait_for giver op i stedet for at haenge',
         `hjaelperen stallede efter ${Math.round(spent*10)/10}s - maskinen, ikke koden (bevist intet)`);
  } else {
    check('wait_for giver op i stedet for at haenge',
          w2.result?.isError === true && /wait-timeout|tidsgraense/i.test(wtxt) && spent < 40,
          `${Math.round(spent*10)/10}s, ${wtxt.split('\n')[0].slice(0, 46)}`);
  }

  const audit = await rpc('tools/call', { name: 'computer_audit', arguments: { limit: 5 } });
  const autxt = audit.result?.content?.[0]?.text || '';
  check('revisionslog skrives', /"decision"/.test(autxt) || /entries/.test(autxt));
  check('log gemmer ikke klartekst', !/HEMMELIGHED/.test(autxt));
} catch (e) {
  console.log('DUMP undervejs:', e.message);
  fails.push(e.message);
} finally {
  srv.kill();
}

if (skips.length) console.log(`\nSPRUNGET OVER: ${skips.length} (bevist intet - ikke bestaaet)`);
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek` : '\nBESTAAET - alle tjek');
process.exit(fails.length ? 1 : 0);
