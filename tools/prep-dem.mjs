// Turns the USGS Jezero CTX mosaics (tools/cache, not in git) into the small files the
// game loads: a 16-bit heightmap (.bin) and a grey albedo (.png).
//   node tools/prep-dem.mjs
// Source: Mars 2020 TRN CTX DTM (20 m) and CTX ortho mosaic (6 m), USGS Astrogeology.
import { fromFile } from 'geotiff';
import { PNG } from 'pngjs';
import fs from 'node:fs';

const CACHE = new URL('./cache/', import.meta.url).pathname;
const OUT = new URL('../textures/mars/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const dem = await (await fromFile(CACHE + 'JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif')).getImage();
const w = dem.getWidth(), h = dem.getHeight();
const [data] = await dem.readRasters();
const [, , , , pixY] = [0, 0, 0, 0, dem.getResolution()[1]];
const R = 3396190; // Mars equatorial radius, m
const [west, south, east, north] = dem.getBoundingBox();
const midLat = ((north + south) / 2) * Math.PI / 180;
// the file is already in degrees-of-an-Eqc-with-lat_ts=0 projection: units are metres
const mppX = (east - west) / w, mppY = (north - south) / h;
console.log({ w, h, bbox: [west, south, east, north], mppX, mppY, midLat });

let lo = Infinity, hi = -Infinity, bad = 0;
for (const v of data) { if (!Number.isFinite(v) || v < -1e5) { bad++; continue; } lo = Math.min(lo, v); hi = Math.max(hi, v); }
console.log({ lo, hi, bad });
const u16 = new Uint16Array(w * h);
for (let i = 0; i < data.length; i++) {
  const v = Number.isFinite(data[i]) && data[i] > -1e5 ? data[i] : lo;
  u16[i] = Math.round(((v - lo) / (hi - lo)) * 65535);
}
fs.writeFileSync(OUT + 'jezero-height.bin', Buffer.from(u16.buffer));
fs.writeFileSync(OUT + 'jezero-meta.json', JSON.stringify({
  width: w, height: h, mppX, mppY, minH: lo, maxH: hi,
  source: 'USGS Astrogeology, Mars 2020 TRN CTX DTM mosaic, 20 m/px (Bland et al. 2024, doi:10.5066/P13CPYYU)',
}, null, 1));

// albedo: ortho is 5322x5040 at 6 m; resample to the DEM's footprint at 2x DEM resolution
const ortho = await (await fromFile(CACHE + 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif')).getImage();
const ow = ortho.getWidth(), oh = ortho.getHeight();
const [od] = await ortho.readRasters();
const tw = 2048, th = Math.round(2048 * h / w);
const png = new PNG({ width: tw, height: th, colorType: 0, inputColorType: 0 });
for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
  // box average over the source pixels this texel covers
  const x0 = Math.floor(x * ow / tw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * ow / tw));
  const y0 = Math.floor(y * oh / th), y1 = Math.max(y0 + 1, Math.floor((y + 1) * oh / th));
  let s = 0, n = 0;
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const v = od[yy * ow + xx]; if (v > 0) { s += v; n++; } }
  const g = n ? s / n : 128;
  const o = (y * tw + x) * 4;
  png.data[o] = png.data[o + 1] = png.data[o + 2] = g; png.data[o + 3] = 255;
}
fs.writeFileSync(OUT + 'jezero-albedo.png', PNG.sync.write(png, { colorType: 0 }));
console.log('done', fs.readdirSync(OUT));
