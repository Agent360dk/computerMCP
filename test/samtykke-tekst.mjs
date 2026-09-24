// Et samtykke er kun et samtykke, hvis mennesket kan se HVAD det siger ja til.
//
// ⛔ HVORFOR DEN FINDES (24/9-2026) - sikkerhedsgennemgang, fund B5.
//    Samtykke-dialogen fik den korte statustekst: «Choose a menu item in Chrome».
//    For et menupunkt der ligner en sletning, fortsatte dialogen: «read the path
//    above, that is the part that is certain» - og der stod ingen sti. Mennesket
//    blev bedt om at laese noget der ikke var der, og godkendte i blinde.
//    Den korte tekst er rigtig for statusboksen og koeen, der ikke maa vise mere
//    end loggen. Den er forkert for den ene flade mennesket skal laese foer ja.
//
//    Intet her viser en aegte dialog: spoergeren er en attrap der skriver den tekst
//    den fik, og hjaelperen er en attrap der intet goer. Svaret er «nej».
import { spawn } from 'node:child_process';
import { writeFileSync, chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavFalskSpoerger } from './falsk-hjaelper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const D = mkdtempSync(join(tmpdir(), 'cmcp-samtykke-'));
const STUB = join(D, 'stub.sh');
writeFileSync(STUB, '#!/bin/sh\necho \'{"ok":true,"apps":[],"count":0}\'\n'); chmodSync(STUB, 0o755);
const spoerger = lavFalskSpoerger('nej', 'cmcp-samtykke');

const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
  env: { ...process.env, CMCP_HELPER: STUB, CMCP_OSASCRIPT: spoerger.sti, CMCP_STATUS_IKON: '0',
         CMCP_NO_PARENT_WATCH: '1', CMCP_STATE_DIR: join(D, 'state'),
         // Dialog-vejen: i baggrundstilstand maa produktet aldrig vise en dialog
         // (den tager skaermen), saa uden ikon afvises der i stedet for at spoerge.
         // Her skal DIALOGENS tekst proeves. Hjaelperen er en attrap der intet goer,
         // og spoergeren svarer nej - intet naar Mac'en.
         CMCP_BACKGROUND: '0' },
  stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', n = 0; const w = new Map();
srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'samtykke', version: '1' } });
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

// Et menupunkt der ligner en sletning spoerger hver gang, ogsaa i allow.
const STI = 'File > Delete Everything';
const r0 = await rpc('tools/call', { name: 'computer_menu', arguments: { app: 'NotesAttrap', path: STI } });
console.log('   svar:', JSON.stringify(r0.result?.content?.[0]?.text || '').slice(0, 110));
const tekster = spoerger.tekster();
check('1 mennesket blev spurgt', tekster.length >= 1, `${tekster.length} gang(e)`);
check('2 ...og dialogen viser STIEN der godkendes', tekster.some(t => t.includes(STI)),
      (tekster[0] || '').slice(0, 120));
check('3 ...og beder ikke om at laese en sti der ikke staar der',
      !tekster.some(t => /read the path above/.test(t) && !t.includes(STI)));

srv.kill(); rmSync(D, { recursive: true, force: true });
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
