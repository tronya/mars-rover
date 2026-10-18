// Quick ASCII look at a lon/lat window of the 200 m MOLA/HRSC blended DEM, reading only a
// few rows over HTTP range requests (curl) instead of downloading the 11 GB file.
//   node tools/region-peek.mjs <west> <south> <east> <north>
import { execFileSync } from 'node:child_process';
const URL_ = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif';
const W = 106694, OFF0 = 854272, ROW = 213388, D = 360 / W;
const [lon0, lat0, lon1, lat1] = process.argv.slice(2).map(Number);
const x0 = Math.round((lon0 + 180) / D), x1 = Math.round((lon1 + 180) / D);
const y0 = Math.round((90 - lat1) / D), y1 = Math.round((90 - lat0) / D);
const rows = 32, cols = 64, grid = [];
let lo = Infinity, hi = -Infinity;
for (let r = 0; r < rows; r++) {
  const y = y0 + Math.floor((r + 0.5) * (y1 - y0) / rows);
  const buf = execFileSync('curl', ['-s', '-m', '60', '-r', `${OFF0 + y * ROW + x0 * 2}-${OFF0 + y * ROW + x1 * 2 - 1}`, URL_], { maxBuffer: 1 << 24 });
  const a = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const line = [];
  for (let c = 0; c < cols; c++) { const v = a[Math.floor((c + 0.5) * a.length / cols)]; line.push(v); if (v > -30000) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
  grid.push(line);
}
console.log({ lo, hi, widthKm: ((x1 - x0) * 0.2).toFixed(0), heightKm: ((y1 - y0) * 0.2).toFixed(0) });
const ch = ' .:-=+*#%@';
for (const line of grid) console.log(line.map((v) => ch[Math.max(0, Math.min(9, Math.floor(((v - lo) / (hi - lo)) * 9.99)))]).join(''));
