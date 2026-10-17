// Crops the Gale crater HRSC DTM (30 m/px, Persaud et al. 2021, CC BY 4.0, Zenodo
// 10.5281/zenodo.5808354; put it in tools/cache/gale-hrsc.tif) to a 33x30 km window between
// Bradbury Landing and the foot of Aeolis Mons, and writes the game's raw files.
//   node tools/prep-gale.mjs
// There is no orthoimage in this source, so the albedo is derived from the terrain itself:
// steep ground reads as dark rock, flat ground as bright dust.
import { fromFile } from 'geotiff';
import fs from 'node:fs';

const CACHE = new URL('./cache/', import.meta.url).pathname;
const OUT = new URL('../textures/mars/', import.meta.url).pathname;
const R = 3396190;
const deg = Math.PI / 180;
const img = await (await fromFile(CACHE + 'gale-hrsc.tif')).getImage();
const [west, south, east, north] = img.getBoundingBox();
const W0 = img.getWidth(), H0 = img.getHeight(), MPP = 30;
const centre = { lon: 137.55, lat: -4.72 };
const cx = (R * centre.lon * deg - west) / MPP, cy = (north - R * centre.lat * deg) / MPP;
const w = 1100, h = 1000;
const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
if (x0 < 0 || y0 < 0 || x0 + w > W0 || y0 + h > H0) throw new Error('window outside the mosaic');
const [data] = await img.readRasters({ window: [x0, y0, x0 + w, y0 + h] });
let lo = Infinity, hi = -Infinity, bad = 0;
const clean = Float32Array.from(data, (v) => (Number.isFinite(v) && v > -1e4 ? v : NaN));
for (const v of clean) { if (Number.isNaN(v)) { bad++; continue; } lo = Math.min(lo, v); hi = Math.max(hi, v); }
// the stereo matching leaves a faint grid; a 3x3 average takes it out without losing relief
for (let i = 0; i < clean.length; i++) if (Number.isNaN(clean[i])) clean[i] = lo;
const sm = Float32Array.from(clean);
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
  let a = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += clean[(y + dy) * w + x + dx];
  sm[y * w + x] = a / 9;
}
clean.set(sm);
// fill holes with the minimum so nothing spikes
for (let i = 0; i < clean.length; i++) if (Number.isNaN(clean[i])) clean[i] = lo;
console.log({ x0, y0, w, h, lo, hi, bad });
const u16 = new Uint16Array(w * h);
for (let i = 0; i < clean.length; i++) u16[i] = Math.round(((clean[i] - lo) / (hi - lo)) * 65535);
fs.writeFileSync(OUT + 'gale-height.bin', Buffer.from(u16.buffer));
// pseudo-albedo from slope, smoothed a little
const slope = new Float32Array(w * h);
for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
  const i = y * w + x;
  slope[i] = Math.hypot(clean[i + 1] - clean[i - 1], clean[i + w] - clean[i - w]) / (2 * MPP);
}
const u8 = new Uint8Array(w * h);
for (let i = 0; i < u8.length; i++) u8[i] = Math.round(255 * Math.max(0, Math.min(1, 1 - slope[i] * 2.2)));
fs.writeFileSync(OUT + 'gale-albedo.bin', Buffer.from(u8));
const originX = west + x0 * MPP, originY = north - y0 * MPP; // top-left corner, projected metres
fs.writeFileSync(OUT + 'gale-meta.json', JSON.stringify({
  width: w, height: h, mppX: MPP, mppY: MPP, minH: lo, maxH: hi, originX, originY, radius: R,
  source: 'HRSC DTM mosaic of Gale crater, 30 m/px (Persaud et al. 2021, CC BY 4.0, doi:10.5281/zenodo.5808354)',
}, null, 1));
console.log('done');
