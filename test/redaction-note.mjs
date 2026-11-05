// Naar et vindue er svaertet HELT, skal agenten faa at vide hvorfor.
//
// ⛔ R1 5/11 (Opus): hjaelperen giver `redaction_note` (tidsloftet ramt, eller en Chrome-side der stadig
//    bygges), men serveren tabte den - 0 traeffere i mcp-server/. Agenten saa «Redacted (N regions)» og et
//    sort Chrome-vindue uden grund, og konkluderede at Chrome var i stykker.
//
// En attrap-hjaelper leverer et 1x1-billede (som claims 17), saa intet fotograferes. Offline, ingen mus.
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fejl = 0;
const check = (navn, ok, hvorfor) => { console.log(`${ok ? 'OK  ' : 'DUMP'} ${navn}${ok ? '' : ' - ' + hvorfor}`); if (!ok) fejl++; };

const NOTE = 'The redaction scan could not vouch for every password field in: Google Chrome (its page was not readable yet - still being built, or empty - so the window was blacked out whole). Those windows were blacked out WHOLE rather than risk leaving a password field visible.';
const dir = mkdtempSync(join(tmpdir(), 'cmcp-note-'));
const lavStub = (navn, ekstra) => {
  const sti = join(dir, navn);
  writeFileSync(sti, `#!/bin/sh
OUT=""; prev=""; for a in "$@"; do [ "$prev" = "--out" ] && OUT="$a"; prev="$a"; done
case "$1" in
  screenshot) echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' | base64 -D > "$OUT"
    echo '{"ok":true,"width":1,"height":1,"pixelsPerPoint":1,"screenWidthPoints":1,"screenHeightPoints":1,"redacted":true,"redactedRegions":1,"scope":"screen"${ekstra}}' ;;
  apps) echo '{"ok":true,"apps":[]}' ;;
  *) echo '{"ok":true}' ;;
esac
`);
  chmodSync(sti, 0o755);
  return sti;
};

const { Client } = await import(join(ROOT, 'mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'index.js'));
const { StdioClientTransport } = await import(join(ROOT, 'mcp-server', 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'client', 'stdio.js'));
const skaermTekst = async (helper) => {
  const env = { ...process.env, CMCP_HELPER: helper, CMCP_STATE_DIR: join(dir, 'state-' + Math.random().toString(36).slice(2)),
                CMCP_STATUS_IKON: '0', CMCP_MODE: 'readonly' };
  delete env.CMCP_BACKGROUND;
  const kl = new Client({ name: 'redaction-note', version: '1' });
  await kl.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'mcp-server', 'index.js')], env, stderr: 'ignore' }));
  try {
    const r = await kl.callTool({ name: 'computer_screenshot', arguments: { maxWidth: 100 } });
    return { fejl: !!r.isError, tekst: (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n') };
  } finally { await kl.close(); }
};

try {
  const med = await skaermTekst(lavStub('med.sh', `,"redaction_note":${JSON.stringify(NOTE)},"redaction_whole_window":["Google Chrome"]`));
  check('1. hjaelperens note naar frem til agenten, ordret', !med.fejl && med.tekst.includes(NOTE), med.tekst.slice(0, 240));
  const uden = await skaermTekst(lavStub('uden.sh', ''));
  check('2. uden note: intet ekstra (ingen «undefined», ingen tom saetning)',
        !uden.fejl && /Redacted \(1 regions\)\. Scope: screen\./.test(uden.tekst) && !/undefined|null/.test(uden.tekst), uden.tekst.slice(0, 240));
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
console.log(fejl ? `\n${fejl} DUMPET` : '\nBESTAAET');
process.exit(fejl ? 1 : 0);
