// Builds a game region from the 200 m MOLA/HRSC blended DEM (USGS Astrogeology, public
// domain; Fergason et al. 2018, doi:10.5066/P9MZCD1V) by reading only the window it needs
// over HTTP range requests, then resampling it to 50 m per pixel. The albedo is derived
// from the terrain (steep = dark rock, flat = bright dust), like Gale's.
//   node tools/prep-region.mjs <name> <centre lon> <centre lat> <size km>
//   node tools/prep-region.mjs melas -74.25 -10.25 41
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [name, cLon, cLat, sizeKm] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5]];
if (!name || !sizeKm) throw new Error('usage: prep-region.mjs <name> <lon> <lat> <km>');
const URL_ = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif';
const SW = 106694, OFF0 = 854272, ROW = 213388, D = 360 / SW; // source layout: int16 rows, one strip each
const R = 3396190, deg = Math.PI / 180, SRC_MPP = R * D * deg, OUT_MPP = 50;
const OUT = new URL('../textures/mars/', import.meta.url).pathname;
const CACHE = new URL('./cache/', import.meta.url).pathname;
fs.mkdirSync(CACHE, { recursive: true });

const halfDeg = (sizeKm * 1000 / 2) / (R * deg);
const x0 = Math.round((cLon - halfDeg + 180) / D), x1 = Math.round((cLon + halfDeg + 180) / D) + 1;
const y0 = Math.round((90 - (cLat + halfDeg)) / D), y1 = Math.round((90 - (cLat - halfDeg)) / D) + 1;
const sw = x1 - x0, sh = y1 - y0;
console.log({ sw, sh, srcMppKm: SRC_MPP });

// one curl run, every row range as its own request
const rawFile = `${CACHE}${name}-rows.bin`;
if (!fs.existsSync(rawFile) || fs.statSync(rawFile).size !== sw * sh * 2) {
  const cfg = [];
  const parts = [];
  for (let y = y0; y < y1; y++) {
    const f = `${CACHE}${name}-row-${y}.bin`;
    parts.push(f);
    cfg.push(`url = "${URL_}"`, `range = "${OFF0 + y * ROW + x0 * 2}-${OFF0 + y * ROW + x1 * 2 - 1}"`, `output = "${f}"`, 'next');
  }
  cfg.pop(); // no `next` after the last request
  fs.writeFileSync(`${CACHE}${name}-curl.cfg`, cfg.join('\n'));
  execFileSync('curl', ['-s', '-Z', '--parallel-max', '6', '--retry', '4', '-m', '600', '-K', `${CACHE}${name}-curl.cfg`], { stdio: 'inherit' });
  const all = Buffer.concat(parts.map((f) => fs.readFileSync(f)));
  if (all.length !== sw * sh * 2) throw new Error(`downloaded ${all.length} bytes, wanted ${sw * sh * 2}`);
  fs.writeFileSync(rawFile, all);
  for (const f of parts) fs.unlinkSync(f);
}
const buf = fs.readFileSync(rawFile);
const src = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const bad = src.filter((v) => v <= -30000).length;
if (bad) console.log('no-data pixels:', bad);

// bicubic-ish (smooth) resample to OUT_MPP: Catmull-Rom on the 200 m grid
const w = Math.floor((sw - 3) * SRC_MPP / OUT_MPP), h = Math.floor((sh - 3) * SRC_MPP / OUT_MPP);
const at = (i, j) => src[Math.min(sh - 1, Math.max(0, j)) * sw + Math.min(sw - 1, Math.max(0, i))];
const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
const out = new Float32Array(w * h);
let lo = Infinity, hi = -Infinity;
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
  const fx = 1 + i * OUT_MPP / SRC_MPP, fy = 1 + j * OUT_MPP / SRC_MPP;
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const rows = [-1, 0, 1, 2].map((dy) => cr(at(ix - 1, iy + dy), at(ix, iy + dy), at(ix + 1, iy + dy), at(ix + 2, iy + dy), tx));
  const v = cr(rows[0], rows[1], rows[2], rows[3], ty);
  out[j * w + i] = v;
  lo = Math.min(lo, v); hi = Math.max(hi, v);
}
console.log({ w, h, lo, hi });
const u16 = new Uint16Array(w * h);
for (let i = 0; i < out.length; i++) u16[i] = Math.round(((out[i] - lo) / (hi - lo)) * 65535);
fs.writeFileSync(`${OUT}${name}-height.bin`, Buffer.from(u16.buffer));
const u8 = new Uint8Array(w * h);
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
  const i = y * w + x;
  const s = Math.hypot(out[i + 1] - out[i - 1], out[i + w] - out[i - w]) / (2 * OUT_MPP);
  u8[i] = Math.round(255 * Math.max(0, Math.min(1, 1 - s * 1.6)));
}
fs.writeFileSync(`${OUT}${name}-albedo.bin`, Buffer.from(u8));
const west = R * (cLon - halfDeg) * deg + 0, north = R * (cLat + halfDeg) * deg;
fs.writeFileSync(`${OUT}${name}-meta.json`, JSON.stringify({
  width: w, height: h, mppX: OUT_MPP, mppY: OUT_MPP, minH: lo, maxH: hi,
  originX: west + 1 * SRC_MPP, originY: north - 1 * SRC_MPP, radius: R,
  source: 'MOLA/HRSC blended DEM, 200 m/px, resampled to 50 m (USGS Astrogeology, doi:10.5066/P9MZCD1V)',
}, null, 1));
console.log('done');
