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
function check(label, cond, detail = '') {
  console.log(`${cond ? 'OK  ' : 'DUMP'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!cond) fails.push(label);
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

console.log(fails.length ? `\nDUMPET: ${fails.length} tjek` : '\nBESTAAET - alle tjek');
process.exit(fails.length ? 1 : 0);
