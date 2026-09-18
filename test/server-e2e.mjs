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
  check('skaermbillede', !!img, img ? `${Math.round(img.data.length / 1024)} KB base64, ${parts[0]?.text}` : 'intet billede');
  // Hele vendingen, ikke et ord-stump. MAALT 18/9: proeven tjekte smaat
  // "sloeret", teksten skiftede til stort "Sloeret", og proeven blev roed paa
  // en aendring der VIRKEDE. Samme fejlklasse som husets otte substring-fejl:
  // match den hele vending, aldrig to tegn af den.
  const shotText = parts.find(p => p.type === 'text')?.text || '';
  check('sloering er standard',
        /\bSloeret \(\d+ omraader\)/i.test(shotText) && !/IKKE sloeret/i.test(shotText),
        shotText.slice(-40));

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
