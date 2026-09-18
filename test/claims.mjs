// Proever for de paastande sitet og README'en staar paa.
//
// De var alle sande i koden da de blev skrevet. Forskellen paa "sand i dag"
// og "bliver ved med at vaere sand" er en proeve. Et sikkerhedsloefte uden
// proeve er en kommentar.
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { homedir } from 'os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT = join(homedir(), '.local', 'state', 'computer-mcp', 'audit.jsonl');

function client(env) {
  const srv = spawn('node', [join(ROOT, 'mcp-server', 'index.js')],
    { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
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
  console.log('  (en dialog vises i 2 sekunder - det er meningen)');
  const r = await c.rpc('tools/call', { name: 'computer_activate', arguments: { app: 'com.apple.Terminal' } });
  const txt = r.result?.content?.[0]?.text || '';
  // MAALT 18/9: her stod kun `isError === true`. Terminal koerte ikke paa
  // maskinen, saa kaldet fejlede med "programmet koerer ikke" - ogsaa en fejl -
  // og proeven bestod selv da samtykke-porten var muteret vaek. En proeve der
  // ikke kan skelne "afvist af porten" fra "fejlede af en anden grund",
  // beviser ingenting. Nu kraeves ordet fra porten selv.
  check('1. farligt program spoerger selv i allow-tilstand',
        r.result?.isError === true && /Afvist:/.test(txt),
        txt.split('\n')[0]);

  // Og modstykket: et harmloest program spoerger IKKE i allow-tilstand.
  // Uden dette tjek ville "afvis altid" ogsaa bestaa proeve 1.
  const r2 = await c.rpc('tools/call', { name: 'computer_move', arguments: { x: 900, y: 500 } });
  check('1b. harmloest program spoerger ikke i allow-tilstand',
        r2.result?.isError !== true, (r2.result?.content?.[0]?.text || '').slice(0, 40));
  c.srv.kill();
}

// ---------------------------------------------------------------- paastand 2
// "Typed text is stored as a length and a hash, never in clear."
// Koeres i readonly, saa der ikke skrives i et rigtigt program: handlingen
// afvises, men revisionslinjen skrives foerst - og det er linjen vi proever.
{
  const SECRET = 'KLARTEKST-MAA-ALDRIG-LOGGES-9f3a';
  const c = client({ CMCP_MODE: 'readonly' });
  await c.ready();
  await c.rpc('tools/call', { name: 'computer_type', arguments: { text: SECRET } });
  c.srv.kill();
  await new Promise(r => setTimeout(r, 300));

  if (!existsSync(AUDIT)) { skip('2. revisionslog', 'loggen findes ikke'); }
  else {
    const lines = readFileSync(AUDIT, 'utf8').trim().split('\n').slice(-12);
    const whole = lines.join('\n');
    const typed = lines.map(l => JSON.parse(l)).find(e => e.tool === 'computer_type' && e.args);
    check('2. klarteksten staar ikke i loggen', !whole.includes(SECRET));
    check('2b. der staar et fingeraftryk i stedet',
          !!typed?.args?.text?.sha256_12 && typed.args.text.length === SECRET.length,
          typed ? JSON.stringify(typed.args.text) : 'ingen linje fundet');
  }
}

// ---------------------------------------------------------------- paastand 3
// "Values of secure fields are never returned, not even to the agent."
{
  const c = client({ CMCP_MODE: 'readonly' });
  await c.ready();
  const r = await c.rpc('tools/call', { name: 'computer_inspect', arguments: { depth: 14, limit: 1500 } });
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

console.log();
if (skips.length) console.log(`SPRUNGET OVER: ${skips.length} (bevist intet - ikke bestaaet)`);
console.log(fails.length ? `DUMPET: ${fails.length}` : 'BESTAAET');
process.exit(fails.length ? 1 : 0);
