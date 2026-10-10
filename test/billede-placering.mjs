// BILLEDE-PLACERING: et billede af ÉT program viser programmets vinduer der, hvor
// de staar paa skaermen - og sloeringen ligger oven paa det, den skal skjule.
//
// ⛔ HVORFOR DEN FINDES (10/10-2026)
//    Maalt paa macOS 26.4.1: `screenshot --app` lagde programmets indhold i
//    billedets oeverste venstre hjoerne. Lommeregneren stod paa (405, 516), og
//    dens pixels laa i (0, 0). To skader:
//    - en agent der laeser et punkt af billedet og klikker der, rammer et andet
//      sted paa skaermen - forskudt med vinduets placering
//    - sloeringen af kodeordsfelter tegnes paa rammens RIGTIGE plads, altsaa ved
//      siden af det indhold den skulle daekke
//    Ingen proeve saa det: sloeringsbeviserne fotograferer hele skaermen, aldrig
//    ét program. Rettelsen er en udtrykkelig kilde-ramme (hele skaermen) til
//    ScreenCaptureKit.
//
//    Proeven bruger sit eget proevevindue (2 % synligt, under alle almindelige
//    vinduer, musen gaar igennem det). Ingen af menneskets programmer fotograferes.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HJAELPER = [process.env.CMCP_HELPER, join(ROOT, 'mcp-server', 'vendor', 'cmcp-helper')].find(p => p && existsSync(p));
const fails = [];
const check = (l, c, d = '') => { console.log(`${c ? 'OK  ' : 'DUMP'} ${l}${d ? ' - ' + d : ''}`); if (!c) fails.push(l); };
const koer = (...a) => { try { return JSON.parse(execFileSync(HJAELPER, a, { encoding: 'utf8', timeout: 60000 })); }
                          catch (e) { try { return JSON.parse(String(e.stdout)); } catch { return { ok: false, error: String(e.stdout || e.message).slice(0, 200) }; } } };
const vent = (ms) => new Promise(r => setTimeout(r, ms));

// En lille PNG-laeser (8 bit, RGB/RGBA, ikke interlaced) - saa proeven ikke afhaenger af et billedbibliotek.
function laesPng(sti) {
  const b = readFileSync(sti);
  let p = 8, w = 0, h = 0, type = 0; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), kind = b.toString('latin1', p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (type !== 6 && type !== 2)) throw new Error(`PNG-format ikke understoettet (dybde ${data[8]}, type ${type}, interlace ${data[12]})`); }
    if (kind === 'IDAT') idat.push(data);
    if (kind === 'IEND') break;
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, raa = inflateSync(Buffer.concat(idat)), rk = w * bpp, ud = Buffer.alloc(h * rk);
  for (let y = 0; y < h; y++) {
    const f = raa[y * (rk + 1)], ind = raa.subarray(y * (rk + 1) + 1, (y + 1) * (rk + 1));
    for (let x = 0; x < rk; x++) {
      const a = x >= bpp ? ud[y * rk + x - bpp] : 0, o = y ? ud[(y - 1) * rk + x] : 0, c = (x >= bpp && y) ? ud[(y - 1) * rk + x - bpp] : 0;
      let v = ind[x];
      if (f === 1) v += a; else if (f === 2) v += o; else if (f === 3) v += (a + o) >> 1;
      else if (f === 4) { const q = a + o - c, pa = Math.abs(q - a), pb = Math.abs(q - o), pc = Math.abs(q - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? o : c); }
      ud[y * rk + x] = v & 255;
    }
  }
  return { w, h, px: (x, y) => { const i = y * rk + x * bpp; return [ud[i], ud[i + 1], ud[i + 2], bpp === 4 ? ud[i + 3] : 255]; } };
}
// Den mindste ramme om alle pixels der opfylder `hvad`.
function ramme(img, hvad) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (hvad(img.px(x, y))) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
const naer = (a, b, tol) => Math.abs(a - b) <= tol;

const ARB = mkdtempSync(join(tmpdir(), 'cmcp-plac-'));
const navn = 'cmcpplac' + Math.random().toString(36).slice(2, 8);
const BIN = join(ARB, navn);
execFileSync('swiftc', ['-O', join(ROOT, 'test', 'fixture', 'placering.swift'), '-o', BIN], { stdio: 'pipe', timeout: 180000 });
const barn = spawn(BIN, { stdio: ['ignore', 'pipe', 'ignore'] });
try {
  await new Promise((res) => { barn.stdout.on('data', (d) => { if (/pid=/.test(String(d))) res(); }); setTimeout(res, 15000); });
  let vin = null;
  for (const frist = Date.now() + 30000; Date.now() < frist && !vin; await vent(300)) vin = (koer('windows', '--app', navn).windows || [])[0] || null;
  check('0 proevevinduet staar paa sin kendte plads (400, 400, 200, 100)', !!vin && vin.frame.x === 400 && vin.frame.y === 400 && vin.frame.w === 200, JSON.stringify(vin?.frame || {}));

  const raaSti = join(ARB, 'raa.png'), sloeretSti = join(ARB, 'sloeret.png');
  const raa = koer('screenshot', '--app', navn, '--no-redact', '--out', raaSti);
  if (!raa.ok && /permission|Screen Recording|could not be captured/i.test(raa.error || '')) {
    console.log(`SPRUNGET OVER: 4 (ingen skaermoptagelse her: ${String(raa.error).slice(0, 120)}) - bevist intet, ikke bestaaet`);
  } else {
    const s = raa.pixelsPerPoint, ox = raa.displayOriginX, oy = raa.displayOriginY;
    const forvent = { x0: (400 - ox) * s, y0: (400 - oy) * s, x1: (600 - ox) * s, y1: (500 - oy) * s };
    const img = laesPng(raaSti);
    const fundet = ramme(img, ([, , , a]) => a > 0);
    check('1 billedet af programmet har vinduet DER, hvor det staar paa skaermen (ramme × pixelsPerPoint)',
      !!fundet && naer(fundet.x0, forvent.x0, 2) && naer(fundet.y0, forvent.y0, 2) && naer(fundet.x1, forvent.x1, 2) && naer(fundet.y1, forvent.y1, 2),
      `fundet ${JSON.stringify(fundet)} · forventet ${JSON.stringify(forvent)}`);

    const sl = koer('screenshot', '--app', navn, '--out', sloeretSti);
    const simg = laesPng(sloeretSti);
    // Feltet: AX (500, 450)-(580, 480). Midten af det skal vaere sort OG uigennemsigtigt med sloering.
    const fx = Math.round((540 - ox) * s), fy = Math.round((465 - oy) * s);
    const sort = ([r, g, b, a]) => a === 255 && r < 20 && g < 20 && b < 20;
    check('2 med sloering: kodeordsfeltets midte er sort', sl.ok === true && sl.redactedRegions >= 1 && sort(simg.px(fx, fy)), `${JSON.stringify(simg.px(fx, fy))} · ${sl.redactedRegions} omraade(r)`);
    check('3 uden sloering: samme punkt er IKKE sort (det er os der sloerer, ikke billedet)', !sort(img.px(fx, fy)), JSON.stringify(img.px(fx, fy)));
    // Sloeringen og indholdet skal vaere samme sted: alt det sorte ligger INDEN FOR vinduets indhold.
    const sorteRamme = ramme(simg, sort);
    check('4 sloeringen ligger inden for vinduets indhold i billedet, ikke ved siden af',
      !!sorteRamme && !!fundet && sorteRamme.x0 >= fundet.x0 && sorteRamme.y0 >= fundet.y0 && sorteRamme.x1 <= fundet.x1 && sorteRamme.y1 <= fundet.y1,
      `sort ${JSON.stringify(sorteRamme)} · vindue ${JSON.stringify(fundet)}`);
  }
  // 5. Bundet til kilden (mutantporten genbygger ikke hjaelperen).
  const cap = readFileSync(join(ROOT, 'helper', 'Sources', 'cmcp-helper', 'Capture.swift'), 'utf8');
  check('5 optagelsen faar en udtrykkelig kilde-ramme: hele skaermen',
    /cfg\.sourceRect = CGRect\(x: 0, y: 0, width: display\.width, height: display\.height\)/.test(cap));
} finally {
  try { barn.kill(); } catch {}
  rmSync(ARB, { recursive: true, force: true });
}
console.log(fails.length ? `DUMPET: ${fails.length} tjek` : 'Alle tjek bestået.');
process.exit(fails.length ? 1 : 0);
