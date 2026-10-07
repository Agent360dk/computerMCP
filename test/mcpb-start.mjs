// DEN BYGGEDE MCPB-PAKKE STARTER, OG DEN ER DEN SAMME SERVER SOM KILDEN.
//
// ⛔ 7/10 (panel R8-R9, punkt M): ét-kliks-installationen til Claude Desktop er kun
//    vaerd noget, hvis pakken starter uden at hente noget og svarer med det samme
//    som kilden. Koeres af release.yml paa den byggede .mcpb (og i haanden):
//      node test/mcpb-start.mjs <sti til computer-mcp.mcpb>
//    Uden sti springes proeven over (den kraever en bygget pakke).
import './egen-tilstand.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const pakke = process.argv[2];
if (!pakke) { console.log('SPRUNGET OVER: ingen .mcpb angivet (bevist intet)'); process.exit(0); }
check('pakken findes', existsSync(pakke), pakke);

const U = mkdtempSync(join(tmpdir(), 'cmcp-mcpb-'));
execFileSync('unzip', ['-q', pakke, '-d', U]);
const manifest = JSON.parse(readFileSync(join(U, 'manifest.json'), 'utf8'));
const version = JSON.parse(readFileSync(join(ROOT, 'mcp-server', 'package.json'), 'utf8')).version;
process.env.CMCP_BACKGROUND = '0';
const kilde = (await import(join(ROOT, 'mcp-server', 'tools.js'))).TOOLS.length;
check('manifestets version = pakkens', manifest.version === version, `${manifest.version} / ${version}`);
check('ingen npx ved start (selvstaendig pakke)', manifest.server?.mcp_config?.command === 'node', manifest.server?.mcp_config?.command);

const srv = spawn('node', [join(U, 'server', 'index.js')], {
  env: { ...process.env, CMCP_STATE_DIR: mkdtempSync(join(tmpdir(), 'cmcp-mcpb-state-')), CMCP_STATUS_IKON: '0',
         CMCP_NO_PARENT_WATCH: '1', CMCP_MODE: 'allow', CMCP_BACKGROUND: '0', npm_config_offline: 'true' },
  stdio: ['pipe', 'pipe', 'pipe'] });
const svar = await new Promise((res) => {
  let b = ''; const r = {};
  const t = setTimeout(() => res(r), 20000);
  srv.stdout.on('data', d => { b += d; for (const l of b.split('\n')) { try { const m = JSON.parse(l);
    if (m.id === 1) r.server = m.result?.serverInfo?.version;
    if (m.id === 2) { r.tools = m.result?.tools?.length; clearTimeout(t); res(r); } } catch {} } });
  const w = o => srv.stdin.write(JSON.stringify(o) + '\n');
  w({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcpb', version: '1' } } });
  w({ jsonrpc: '2.0', method: 'notifications/initialized' });
  w({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
});
srv.kill();
check('serveren i pakken starter og svarer', svar.server === version, String(svar.server));
check('pakken tilbyder samme antal vaerktoejer som kilden', svar.tools === kilde, `${svar.tools} / ${kilde}`);
check('hjaelperen er med i pakken', existsSync(join(U, 'server', 'vendor', 'cmcp-helper')));

console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
