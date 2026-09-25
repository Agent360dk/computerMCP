// Skaermoptagelse (25/9): start spoerger HVER gang, stop og status spoerger aldrig,
// readonly optager aldrig, og filen naevnes kun ved sti.
//
// Intet optages her: serveren koerer mod en attrap-hjaelper der skriver en lille fil
// og venter paa SIGINT, og samtykket gaar til attrap-spoergere. Den AEGTE optagelse
// kan kun maales paa en maskine ingen arbejder paa (CMCP_FREMMED_MASKINE=1).
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const D = mkdtempSync(join(tmpdir(), 'cmcp-optag-'));
const ARGV = join(D, 'argv.txt'), MAPPE = join(D, 'film');
const STUB = join(D, 'stub.sh');
// Filens indhold: genkendeligt, saa proeven kan se om det nogensinde naar et svar.
const FILM = 'FILMINDHOLD-7f3a91c2';
writeFileSync(STUB, `#!/bin/sh
printf '%s ' "$@" >> ${ARGV}; echo >> ${ARGV}
case "$1" in
  record)
    OUT=""; prev=""; for a in "$@"; do [ "$prev" = "--out" ] && OUT="$a"; prev="$a"; done
    # Som den rigtige hjaelper: under opstarten har et stop-signal ingen haandtering.
    [ -n "$STUB_LANGSOM" ] && sleep 1
    trap 'printf ${FILM} > "$OUT"; echo "{\\"ok\\":true,\\"recording\\":false,\\"path\\":\\"$OUT\\",\\"seconds\\":1,\\"bytes\\":1,\\"stopped_by\\":\\"requested\\"}"; exit 0' INT TERM
    echo '{"ok":true,"recording":true,"path":"'"$OUT"'","excluded_apps":["com.1password.1password"],"max_seconds":5}'
    if [ -n "$STUB_SELVSTOP" ]; then sleep 0.3; printf ${FILM} > "$OUT"; echo "{\\"ok\\":true,\\"recording\\":false,\\"path\\":\\"$OUT\\",\\"seconds\\":5,\\"bytes\\":1,\\"stopped_by\\":\\"time-limit\\"}"; exit 0; fi
    if [ -n "$STUB_KRAK" ]; then sleep 0.3; exit 3; fi
    # Og som den rigtige: er serveren vaek (foraelderen er pid 1), stopper den selv.
    while [ "$(ps -o ppid= -p $$ | tr -d ' ')" != "1" ]; do sleep 0.1; done; exit 0 ;;
  apps) echo '{"ok":true,"apps":[{"name":"Finder","bundleId":"com.apple.finder","active":true}]}' ;;
  windows) APP=""; prev=""; for a in "$@"; do [ "$prev" = "--app" ] && APP="$a"; prev="$a"; done
    # Samme ordlyd som den rigtige hjaelper (main.swift: «the app '<x>' is not running»).
    echo '{"ok":false,"code":"not-running","error":"the app '"'$APP'"' is not running"}'; exit 1 ;;
  resolve-app) APP=""; prev=""; for a in "$@"; do [ "$prev" = "--app" ] && APP="$a"; prev="$a"; done
    echo '{"ok":false,"code":"not-found","error":"could not find '"'$APP'"'"}'; exit 1 ;;
  *) echo '{"ok":true}' ;;
esac
`);
chmodSync(STUB, 0o755);
let spoergere = 0;
const spoerger = (svar) => {
  const s = join(D, `spoerger-${svar}-${++spoergere}.sh`), spor = join(D, `spurgt-${svar}-${spoergere}.txt`), tekst = join(D, `tekst-${svar}-${spoergere}.txt`);
  writeFileSync(s, `#!/bin/sh\necho x >> ${spor}\nprintf '%s\\n---\\n' "$2" >> ${tekst}\necho '${svar === 'ja' ? 'button returned:Yes, gave up:false' : 'button returned:, gave up:true'}'\n`);
  chmodSync(s, 0o755);
  return { sti: s, spurgt: () => existsSync(spor) ? readFileSync(spor, 'utf8').trim().split('\n').length : 0,
           tekster: () => existsSync(tekst) ? readFileSync(tekst, 'utf8').split('\n---\n').filter(Boolean) : [] };
};
const optaget = () => (existsSync(ARGV) ? readFileSync(ARGV, 'utf8') : '').split('\n').filter(l => l.startsWith('record ')).length;

function server(mode, svar, navn, ekstra = {}) {
  const sp = spoerger(svar);
  const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
    env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
           CMCP_STATE_DIR: join(D, 'state-' + navn), CMCP_BACKGROUND: '0', CMCP_MODE: mode,
           CMCP_OSASCRIPT: sp.sti, CMCP_RECORD_DIR: MAPPE, ...ekstra },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', n = 0; const w = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  const svarListe = [];
  const kald = async (args) => { const m = await rpc('tools/call', { name: 'computer_record', arguments: args }); svarListe.push(JSON.stringify(m)); return m.result?.content?.[0]?.text || ''; };
  const kaldNavn = async (name, args) => { const m = await rpc('tools/call', { name, arguments: args }); svarListe.push(JSON.stringify(m)); return m.result?.content?.[0]?.text || ''; };
  const klar = rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'optag-' + navn, version: '1' } })
    .then(() => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'));
  return { srv, kald, kaldNavn, svar: svarListe, klar, sp, state: join(D, 'state-' + navn), log: () => { const f = join(D, 'state-' + navn, 'audit.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []; } };
}

// 1. readonly: start afvises (ingen optagelse), status virker.
{
  const s = server('readonly', 'ja', 'ro'); await s.klar;
  const r = await s.kald({ action: 'start' });
  const st = await s.kald({ action: 'status' });
  s.srv.kill();
  check('1 readonly: start afvises og intet optages', /CMCP_MODE=readonly/.test(r) && optaget() === 0, r.slice(0, 80));
  check('1b readonly: status kan stadig spoerges', /"recording": false/.test(st), st.slice(0, 60));
}

// 2. allow + ingen svar: start SPOERGER (ogsaa i allow) og optager ikke.
{
  const s = server('allow', 'nej', 'nej'); await s.klar;
  const r = await s.kald({ action: 'start', maxSeconds: 5 });
  s.srv.kill();
  check('2 start spoerger hver gang, ogsaa i allow - og optager ikke uden ja', s.sp.spurgt() === 1 && optaget() === 0, r.slice(0, 70));
}

// 2b. Baggrundstilstand (standard): spoergsmaalet skal kunne gaa til menulinjen.
//     Foer 25/9 var maalet «ukendt», og et ukendt maal kan aldrig godkendes derfra.
{
  const sp = spoerger('ja');
  const srv = spawn('node', [join(ROOT, 'mcp-server/index.js')], {
    env: { ...process.env, CMCP_HELPER: STUB, CMCP_STATUS_IKON: '0', CMCP_NO_PARENT_WATCH: '1',
           CMCP_STATE_DIR: join(D, 'state-bg'), CMCP_BACKGROUND: '1', CMCP_MODE: 'allow',
           CMCP_OSASCRIPT: sp.sti, CMCP_RECORD_DIR: MAPPE },
    stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '', n = 0; const w = new Map();
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); w.get(m.id)?.(m); } catch {} } });
  const rpc = (m, p) => new Promise(r => { const id = ++n; w.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: m, params: p }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'optag-bg', version: '1' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const r = (await rpc('tools/call', { name: 'computer_record', arguments: { action: 'start', maxSeconds: 5 } })).result?.content?.[0]?.text || '';
  srv.kill();
  check('2b baggrund: start venter paa et ja i menulinjen - og er IKKE et ukendt maal der aldrig kan godkendes',
        !/cannot be approved from the menu bar/.test(r) && !/unknown/.test(r) && optaget() === 0, r.slice(0, 110));
}

// 3. allow + ja: start -> status -> dobbelt start afvist -> stop -> fil + spor.
{
  const s = server('allow', 'ja', 'ja'); await s.klar;
  const r1 = await s.kald({ action: 'start', maxSeconds: 5 });
  const st = await s.kald({ action: 'status' });
  const r2 = await s.kald({ action: 'start', maxSeconds: 5 });
  const r3 = await s.kald({ action: 'stop' });
  const r4 = await s.kald({ action: 'stop' });
  s.srv.kill();
  const filer = existsSync(MAPPE) ? readdirSync(MAPPE) : [];
  check('3a ja -> optagelsen starter, i den valgte mappe', /"recording": true/.test(r1) && r1.includes(MAPPE) && optaget() === 1, r1.slice(0, 90));
  check('3b status siger at den optager', /"recording": true/.test(st), st.slice(0, 60));
  check('3c en optagelse ad gangen: anden start afvises - uden at spoerge mennesket', /already running/.test(r2) && optaget() === 1 && s.sp.spurgt() === 1, r2.slice(0, 80));
  check('3d stop spoerger IKKE og giver filen', /"recording": false/.test(r3) && /stopped_by": "requested/.test(r3) && s.sp.spurgt() === 1, r3.slice(0, 90));
  check('3e filen findes, og svaret naevner kun stien', filer.length === 1 && filer[0].endsWith('.mov') && !/[A-Za-z0-9+/]{200,}/.test(r3), filer.join(','));
  check('3f stop uden optagelse er en fejl, ikke et tavst ok', /nothing is being recorded/.test(r4), r4.slice(0, 60));
  const linjer = s.log().filter(d => d.tool === 'computer_record');
  const start = linjer.filter(d => d.decision === 'allowed' && d.asked === true);
  check('3g sporet: start er godkendt af et menneske, og hvert kald har sit eget id',
        start.length === 1 && linjer.every(d => typeof d.call === 'string') && new Set(linjer.map(d => d.call)).size >= 4,
        `${linjer.length} linjer, ${new Set(linjer.map(d => d.call)).size} kald`);
  // Fable 25/9: stop-linjen bar hverken fil, varighed eller aarsag, og start/stop/status
  // kunne kun skelnes paa laengden af et fingeraftryk.
  const stoppet = linjer.filter(d => d.recording === 'stopped');
  check('3h sporet: slutningen staar med fil, aarsag og stoerrelse',
        stoppet.length === 1 && stoppet[0].file?.startsWith(MAPPE) && stoppet[0].stopped_by === 'requested' && stoppet[0].bytes === 1,
        JSON.stringify(stoppet[0] || null).slice(0, 140));
  const handlinger = linjer.filter(d => d.args?.action).map(d => d.args.action);
  check('3i sporet: start, status og stop staar i klartekst, ikke som fingeraftryk',
        ['start', 'status', 'stop'].every(a => handlinger.includes(a)), handlinger.join(','));
}

// 3j/3k. Egen server: start -> stop -> start -> stop.
{
  const s = server('allow', 'ja', 'igen'); await s.klar;
  await s.kald({ action: 'start', maxSeconds: 5 });
  await s.kald({ action: 'stop' });
  const r5 = await s.kald({ action: 'start', maxSeconds: 5 });
  await s.kald({ action: 'stop' });
  s.srv.kill();
  // Astra 25/9: «hver gang» var kun proevet med en anden start MENS den foerste koerte.
  check('3j start efter stop spoerger IGEN - et ja gaelder én optagelse', /"recording": true/.test(r5) && s.sp.spurgt() === 2, `spurgt ${s.sp.spurgt()}`);
  // Astra 25/9: tjekket ledte efter 200 base64-tegn i foerste tekstblok. Nu: filens
  // indhold - raat, base64 eller hex - maa ikke staa i NOGET svar.
  const alle = s.svar.join('\n');
  const former = [FILM, Buffer.from(FILM).toString('base64').slice(0, 16), Buffer.from(FILM).toString('hex').slice(0, 24)];
  check('3k filens indhold staar ikke i et eneste svar, i nogen form', former.every(f => !alle.includes(f)), `${s.svar.length} svar gennemsoegt`);
}

// 8. Dialogen mennesket laeser. Fable 25/9: den sagde «This looks like it deletes or
//    clears something» om en optagelse, og «1 minutes» om 30 sekunder, og viste
//    16667 minutter om et loft koden klipper til 60.
{
  const s = server('allow', 'nej', 'tekst'); await s.klar;
  await s.kald({ action: 'start', maxSeconds: 5 });
  await s.kald({ action: 'start', maxSeconds: 30 });
  await s.kald({ action: 'start', maxSeconds: 1000000 });
  await s.kald({ action: 'start', maxSeconds: 149 });
  s.srv.kill();
  const [t5, t30, tStor, t149] = s.sp.tekster();
  check('8a dialogen for en optagelse lover ikke en sletning, og siger hvad der IKKE udelades',
        !!t5 && !/deletes or clears/.test(t5) && /Password managers are left out/.test(t5) && /password fields/i.test(t5),
        (t5 || '').replace(/\n+/g, ' ').slice(0, 160));
  check('8b tiden i dialogen er den tid der optages',
        /30 seconds/.test(t30 || '') && /60 minutes/.test(tStor || '') && !/1 minutes/.test(t30 || ''),
        `${(t30 || '').split('\n')[0].slice(0, 70)} | ${(tStor || '').split('\n')[0].slice(0, 70)}`);
  // Astra 25/9: 149 sekunder hed «up to 2 minutes». Mennesket maa aldrig godkende MINDRE end der optages.
  check('8c tiden rundes op, aldrig ned', /up to 3 minutes/.test(t149 || ''), (t149 || '').split('\n')[0].slice(0, 80));
  check('8d dialogen siger at et adgangskode-program der aabnes undervejs kan ses et oejeblik', /for a moment/.test(t5 || ''), (t5 || '').replace(/\n+/g, ' ').slice(0, 200));
}

// 6. Optagelsen stopper AF SIG SELV (loft). Foer 25/9 skrev det nul linjer i loggen,
//    og en ny start kasserede det gamle resultat tavst.
{
  const s = server('allow', 'ja', 'selv', { STUB_SELVSTOP: '1' }); await s.klar;
  const r1 = await s.kald({ action: 'start', maxSeconds: 5 });
  await new Promise(r => setTimeout(r, 900));
  const st = await s.kald({ action: 'status' });
  s.srv.kill();
  const stoppet = s.log().filter(d => d.tool === 'computer_record' && d.recording === 'stopped');
  check('6a en optagelse der stopper af sig selv, staar i loggen med aarsag og fil',
        /"recording": true/.test(r1) && /"recording": false/.test(st) && stoppet.length === 1
          && stoppet[0].stopped_by === 'time-limit' && stoppet[0].file?.startsWith(MAPPE),
        JSON.stringify(stoppet[0] || null).slice(0, 140));
}

// 7. Hjaelperen doer midt i optagelsen uden et ord. Loggen skal sige det, og stop
//    maa ikke paastaa at den ventede 40 sekunder.
{
  const s = server('allow', 'ja', 'krak', { STUB_KRAK: '1' }); await s.klar;
  await s.kald({ action: 'start', maxSeconds: 5 });
  await new Promise(r => setTimeout(r, 900));
  const t0 = Date.now();
  const r = await s.kald({ action: 'stop' });
  const ms = Date.now() - t0;
  s.srv.kill();
  const stoppet = s.log().filter(d => d.tool === 'computer_record' && d.recording === 'stopped');
  check('7a en hjaelper der doer uden svar, staar i loggen som en fejl',
        stoppet.length === 1 && stoppet[0].outcome === 'error', JSON.stringify(stoppet[0] || null).slice(0, 140));
  check('7b ...og stop siger det som det er, straks', /ended without/.test(r) && !/40 seconds/.test(r) && ms < 5000, `${ms} ms: ${r.slice(0, 80)}`);
}

// 9. Et skaerm-id der ikke kan findes (negativt, for stort), afvises FOER mennesket
//    spoerges. Fable 25/9: -1 naaede hjaelperen og crashede den - efter et ja.
{
  const s = server('allow', 'ja', 'skaerm'); await s.klar;
  const foer = optaget();
  const a = await s.kald({ action: 'start', maxSeconds: 5, displayId: -1 });
  const b = await s.kald({ action: 'start', maxSeconds: 5, displayId: 2 ** 40 });
  s.srv.kill();
  check('9 et umuligt skaerm-id afvises uden at spoerge og uden at optage',
        /displayId/.test(a) && /displayId/.test(b) && s.sp.spurgt() === 0 && optaget() === foer, `${a.slice(0, 60)} | ${b.slice(0, 40)}`);
}

// 10. Serveren lukker midt i en optagelse. Fable 25/9 (runde 2): loggen lovede en
//     linje for «server gone», men den linje skulle skrives af den server der var vaek.
{
  const s = server('allow', 'ja', 'doed'); await s.klar;
  await s.kald({ action: 'start', maxSeconds: 5 });
  s.srv.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 1200));
  const l = s.log().filter(d => d.tool === 'computer_record' && d.recording === 'stopping');
  const fil = l[0]?.file;
  check('10 serveren lukker midt i en optagelse: loggen siger det, og hjaelperen faar besked',
        l.length === 1 && l[0].stopped_by === 'server-exit' && !!fil && existsSync(fil) && readFileSync(fil, 'utf8') === FILM,
        JSON.stringify(l[0] || null).slice(0, 140));
}

// 11. Stop MENS optagelsen starter. Foer: signalet ramte hjaelperen foer den kunne
//     haandtere det, og filen blev aldrig afsluttet.
{
  const s = server('allow', 'ja', 'langsom', { STUB_LANGSOM: '1' }); await s.klar;
  const foer = optaget();
  const pStart = s.kald({ action: 'start', maxSeconds: 5 });
  // Stop FOERST naar hjaelperen er startet og stadig i sit opstartssekund - ellers
  // maaler proeven «intet at stoppe» i stedet for vinduet den handler om.
  for (let i = 0; i < 250 && optaget() === foer; i++) await new Promise(r => setTimeout(r, 20));
  const iOpstart = optaget() > foer;
  const pStop = s.kald({ action: 'stop' });
  const [r1, r2] = await Promise.all([pStart, pStop]);
  s.srv.kill();
  check('11 stop mens den starter: venter paa starten og afslutter filen',
        iOpstart && /"recording": true/.test(r1) && /stopped_by": "requested/.test(r2), `${r1.replace(/\s+/g, ' ').slice(0, 40)} | ${r2.replace(/\s+/g, ' ').slice(0, 80)}`);
}

// 12. Modellens tekst maa hverken staa i statusfilen eller i loggen - heller ikke som
//     et noeglenavn eller et vaerktoejsnavn. Astra 25/9: `record ${action}` skrev den
//     ordret i sessionsfilen; noeglenavne og ukendte vaerktoejsnavne stod ordret i loggen.
{
  const s = server('allow', 'ja', 'laek'); await s.klar;
  await s.kald({ action: 'HEMMELIG-status-4411' });
  await s.kald({ action: 'status', 'HEMMELIG-noegle-6633': 1 });
  await s.kaldNavn('HEMMELIG-vaerktoej-5522', {});
  // Statusfilen slettes naar serveren lukker - den skal laeses MENS den lever.
  // (Programnavne MAA staa der - «hvad der skete, og i hvilket program» er et valg fra 22/9.)
  const sesDir = join(s.state, 'sessions');
  const status = existsSync(sesDir) ? readdirSync(sesDir).map(f => readFileSync(join(sesDir, f), 'utf8')).join('\n') : '';
  // En fejlbesked fra hjaelperen der gentager modellens tekst («the app '<x>' is not running»).
  await s.kaldNavn('computer_windows', { app: 'HEMMELIG-app-9911' });
  await s.kaldNavn('computer_launch', { app: 'HEMMELIG-app-7788' });
  s.srv.kill();
  const log = existsSync(join(s.state, 'audit.jsonl')) ? readFileSync(join(s.state, 'audit.jsonl'), 'utf8') : '';
  check('12a statusfilen viser ikke modellens handlings-tekst eller ukendte vaerktoejsnavne', status.length > 0 && !status.includes('HEMMELIG'), status.includes('HEMMELIG') ? 'LAEKKER: ' + (status.match(/[^"]*HEMMELIG[^"]*/) || [''])[0] : `${status.length} tegn, rent`);
  check('12b loggen viser hverken noeglenavne, vaerktoejsnavne eller fejlbeskeder med modellens tekst',
        log.length > 0 && !log.includes('HEMMELIG'), (log.match(/[^"]*HEMMELIG[^"]*/g) || ['rent']).slice(0, 3).join(' | '));
}

// 13. En hjaelper der ikke kan startes, maa ikke vaelte serveren (Astra 25/9: ingen
//     `error`-lytter paa barnet).
{
  const IKKE = join(D, 'ikke-koerbar'); writeFileSync(IKKE, 'ikke et program'); chmodSync(IKKE, 0o644);
  const s = server('allow', 'ja', 'spawn', { CMCP_HELPER: IKKE }); await s.klar;
  const loft = (p) => Promise.race([p, new Promise(res => setTimeout(() => res('TIMEOUT: serveren svarede ikke'), 10_000))]);
  const r1 = await loft(s.kald({ action: 'start', maxSeconds: 5 }));
  const r2 = await loft(s.kald({ action: 'status' }));
  s.srv.kill();
  check('13 en hjaelper der ikke kan starte: en fejl, og serveren lever videre',
        /Error|Refused/.test(r1) && /"recording": false/.test(r2), `${r1.slice(0, 70)} | ${r2.replace(/\s+/g, ' ').slice(0, 40)}`);
}

// 14. Standardtilstanden (baggrund): det ikonet VISER mennesket, gennem den rigtige
//     server. Astra 25/9: ikon-proeven leverede selv grunden, saa den kunne ikke se
//     om serveren sendte den.
{
  const st = join(D, 'state-ikon'); mkdirSync(st, { recursive: true });
  const modtaget = [];
  const ikon = createServer(sock => {
    let b = '';
    sock.on('data', d => { b += d; const i = b.indexOf('\n'); if (i < 0) return;
      const q = JSON.parse(b.slice(0, i)); modtaget.push(q);
      sock.write(JSON.stringify({ nonce: q.nonce, ok: true, verified: 'owner' }) + '\n'); });
    sock.on('error', () => {});
  });
  await new Promise(res => ikon.listen(join(st, 'ikon.sock'), res));
  const s = server('allow', 'ja', 'ikon', { CMCP_BACKGROUND: '1' }); await s.klar;
  const r1 = await s.kald({ action: 'start', maxSeconds: 5 });
  await s.kald({ action: 'stop' });
  s.srv.kill(); ikon.close();
  const q = modtaget[0] || {};
  check('14 baggrund: ikonet faar handlingen OG grunden - kodeordsfelter sloeres ikke i filmen',
        /"recording": true/.test(r1) && /Record the main display/.test(q.text || '') && /NOT blacked out/.test(q.scope || '') && s.sp.spurgt() === 0,
        `${(q.text || '').slice(0, 50)} | ${(q.scope || '').slice(0, 90)}`);
}

// 4. Skemaet: forkerte typer og ukendte handlinger afvises foer noget sker.
{
  const s = server('allow', 'ja', 'skema'); await s.klar;
  const foer = optaget();
  const a = await s.kald({ action: 'record-everything' });
  const b = await s.kald({ action: 'start', maxSeconds: '600' });
  s.srv.kill();
  check('4 ukendt handling og forkert type afvises af skemaet', /must be one of/.test(a) && /must be integer/.test(b) && optaget() === foer, `${a.slice(0, 50)} | ${b.slice(0, 50)}`);
}

// 5. Den AEGTE hjaelper i plan-tilstand: optager intet, skriver ingen fil.
{
  const H = join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper');
  const ud = join(D, 'MAA-ALDRIG-FINDES.mov');
  const r = spawnSync(H, ['record', '--plan', '--out', ud, '--seconds', '5'], { encoding: 'utf8' });
  let j = {}; try { j = JSON.parse(r.stdout.trim()); } catch {}
  check('5a den aegte hjaelper: plan-tilstand optager intet og skriver ingen fil', j.plan === true && j.recording === false && Array.isArray(j.excluded_apps) && !existsSync(ud), r.stdout.trim().slice(0, 100));
  // ⛔ ASTRA 25/9: her stod `record` UDEN --plan. Svigtede flag-tjekket, startede
  //    proeven en RIGTIG optagelse af menneskets skaerm. --plan goer at en regression
  //    giver en plan, aldrig en film.
  const f = spawnSync(H, ['record', '--plan', '--out', ud, '--seconds', '5', '--no-redact'], { encoding: 'utf8' });
  check('5b ...og et ukendt flag afvises i stedet for at blive ignoreret', f.status !== 0 && /unknown flag/.test(f.stdout) && !existsSync(ud), f.stdout.trim().slice(0, 80));
  // Fable 25/9: -1 fik `UInt32(-1)` til at crashe hjaelperen (signal, ingen JSON).
  const d = spawnSync(H, ['record', '--plan', '--out', ud, '--seconds', '5', '--display-id', '-1'], { encoding: 'utf8' });
  let dj = {}; try { dj = JSON.parse(d.stdout.trim()); } catch {}
  check('5c ...og et negativt skaerm-id er en fejl med en grund, ikke et crash', d.signal === null && dj.code === 'bad-args' && /display-id/.test(dj.error || ''), `signal=${d.signal} ${d.stdout.trim().slice(0, 70)}`);
}

// 15. DEN AEGTE OPTAGELSE - kun paa en maskine ingen arbejder paa (CMCP_FREMMED_MASKINE=1).
//     Astra 25/9: linjen sagde at flaget aktiverede en proeve, og der fandtes ingen.
if (process.env.CMCP_FREMMED_MASKINE === '1') {
  const s = server('allow', 'ja', 'aegte', { CMCP_HELPER: join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper') }); await s.klar;
  const r1 = await s.kald({ action: 'start', maxSeconds: 3 });
  await new Promise(r => setTimeout(r, 4500));
  const st = await s.kald({ action: 'status' });
  s.srv.kill();
  const l = s.log().filter(d => d.tool === 'computer_record' && d.recording === 'stopped')[0] || {};
  const str = l.file && existsSync(l.file) ? readFileSync(l.file).length : 0;
  check('15a aegte: optagelsen starter og stopper selv ved loftet', /"recording": true/.test(r1) && /"recording": false/.test(st) && l.stopped_by === 'time-limit', JSON.stringify(l).slice(0, 140));
  check('15b aegte: filen findes, har indhold, og varigheden passer', str > 0 && l.bytes === str && Math.abs((l.seconds ?? 0) - 3) <= 1, `${str} bytes, ${l.seconds} s`);
  check('15c aegte: svaret siger hvilke adgangskode-programmer der blev holdt ude', Array.isArray(l.excluded_apps), JSON.stringify(l.excluded_apps));
} else {
  console.log('SPR. 15 en aegte optagelse (fil, varighed, udeladte programmer) - koer med CMCP_FREMMED_MASKINE=1 paa en maskine ingen arbejder paa');
  console.log('SPRUNGET OVER: 1 (bevist intet - ikke bestaaet)');
}
rmSync(D, { recursive: true, force: true });
console.log(fails.length ? `\nDUMPET: ${fails.length} tjek\n - ` + fails.join('\n - ') : '\nAlle tjek bestaaet.');
process.exit(fails.length ? 1 : 0);
