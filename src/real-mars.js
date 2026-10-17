// Real Mars: the western rim, river delta and floor of Jezero crater, from the USGS
// CTX stereo DTM of the Mars 2020 landing site (20 m/px, see tools/prep-dem.mjs and
// textures/CREDITS.md). Loaded once, up front, so terrain.js can ask for a height
// synchronously like it always has. If the file is missing (or the player picked the
// classic region) REAL stays null and the procedural Mars is used unchanged.
import { PLANET } from './planet.js';

let region = 'jezero';
try { region = localStorage.getItem('rover.region') || 'jezero'; } catch (e) { /* keep default */ }

async function loadBytes(name) {
  const url = new URL(`../textures/mars/${name}`, import.meta.url);
  if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node) {
    const mod = 'node:fs'; // not a literal, so the bundler leaves it alone
    const fs = await import(/* @vite-ignore */ mod);
    return fs.readFileSync(url);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function build(meta, bytes) {
  const u16 = new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const { width: W, height: H, mppX, mppY, minH, maxH } = meta;
  const span = (maxH - minH) / 65535;
  const halfW = (W - 1) * mppX / 2;
  const halfH = (H - 1) * mppY / 2;
  const at = (i, j) => minH + u16[j * W + i] * span;
  // World x/z in metres from the middle of the map; +z is south, like the image rows.
  function height(x, z) {
    const fx = Math.min(W - 1.001, Math.max(0, (x + halfW) / mppX));
    const fz = Math.min(H - 1.001, Math.max(0, (z + halfH) / mppY));
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    return at(i, j) * (1 - u) * (1 - v) + at(i + 1, j) * u * (1 - v) + at(i, j + 1) * (1 - u) * v + at(i + 1, j + 1) * u * v;
  }
  return { meta, halfW, halfH, height };
}

export const REAL = await (async () => {
  if (PLANET !== 'mars' || region !== 'jezero') return null;
  try {
    const [metaBytes, bytes] = await Promise.all([loadBytes('jezero-meta.json'), loadBytes('jezero-height.bin')]);
    return build(JSON.parse(new TextDecoder().decode(metaBytes)), bytes);
  } catch (e) {
    console.warn('real Mars unavailable, using the procedural one:', e);
    return null;
  }
})();

// ---- a road that follows the ground ----
// Cheapest path between two map pixels where steep ground costs a lot. Run on a coarse
// grid (100 m) of block-averaged heights, so it ignores pebble-scale noise.
const STEP = 5;
function findRoute(real, waypoints) {
  const { meta } = real;
  const gw = Math.floor(meta.width / STEP), gh = Math.floor(meta.height / STEP);
  const cell = STEP * meta.mppX;
  const hg = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    hg[j * gw + i] = real.height((i + 0.5) * cell - real.halfW, (j + 0.5) * cell - real.halfH);
  }
  const slopeAt = (a, b, d) => Math.abs(hg[a] - hg[b]) / d;
  const legs = [];
  for (let w = 0; w + 1 < waypoints.length; w++) {
    const [sx, sz] = waypoints[w], [ex, ez] = waypoints[w + 1];
    const toCell = ([px, pz]) => [Math.round((px + real.halfW) / cell - 0.5), Math.round((pz + real.halfH) / cell - 0.5)];
    const [si, sj] = toCell([sx, sz]), [ei, ej] = toCell([ex, ez]);
    const start = sj * gw + si, goal = ej * gw + ei;
    const g = new Float32Array(gw * gh).fill(Infinity);
    const from = new Int32Array(gw * gh).fill(-1);
    const heap = [[0, start]];
    g[start] = 0;
    const push = (e) => { heap.push(e); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let m = k; const l = 2 * k + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const hx = (n) => Math.hypot((n % gw) - ei, Math.floor(n / gw) - ej) * cell;
    while (heap.length) {
      const [, n] = pop();
      if (n === goal) break;
      const ni = n % gw, nj = (n / gw) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const mi = ni + di, mj = nj + dj;
        if (mi < 2 || mj < 2 || mi >= gw - 2 || mj >= gh - 2) continue;
        const m = mj * gw + mi;
        const d = Math.hypot(di, dj) * cell;
        const s = slopeAt(n, m, d);
        if (s > 0.3) continue;
        const c = g[n] + d * (1 + 60 * s * s + 6 * s);
        if (c < g[m]) { g[m] = c; from[m] = n; push([c + hx(m), m]); }
      }
    }
    const path = [];
    for (let n = goal; n !== -1; n = from[n]) path.push(n);
    path.reverse();
    legs.push(...(w ? path.slice(1) : path));
  }
  return legs.map((n) => [((n % gw) + 0.5) * cell - real.halfW, (((n / gw) | 0) + 0.5) * cell - real.halfH]);
}

// Map pixels (col,row) of the two bases: АЛЬФА on the crater floor, БЕТА up on the delta.
const PIXELS = [[1000, 860], [760, 560]];
export const REAL_ROUTE = (() => {
  if (!REAL) return null;
  const m = REAL.meta;
  const toWorld = ([c, r]) => [c * m.mppX - REAL.halfW, r * m.mppY - REAL.halfH];
  const pts = findRoute(REAL, PIXELS.map(toWorld));
  // thin it to a control point every ~300 m so the spline can round the corners
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc >= 300 || i === pts.length - 1) { out.push(pts[i]); acc = 0; }
  }
  return out;
})();
