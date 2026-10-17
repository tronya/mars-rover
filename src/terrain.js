import * as THREE from 'three';
import { PLANET } from './planet.js';
import { REAL, REAL_ROUTE } from './real-mars.js';
import { LANDMARK_TYPES, settlementLayout, SETTLEMENT_R } from './landmark-types.js';
import { BASE_LAYOUTS, baseSolids } from './base-layout.js';

// A ~10 km crossing between two bases. The world is far too large for one mesh, so
// the ground is analytic (terrainHeight) and the visuals are streamed as tiles that
// follow the rover. Rocks come from the same hash the physics reads, so what you see
// is what you hit.

function hash(i, j) {
  const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function vnoise(x, y) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j);
  const b = hash(i + 1, j);
  const c = hash(i, j + 1);
  const d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, octaves) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * freq, y * freq);
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------- the route ----------

// A rough zigzag through control points, smoothed with a Catmull-Rom spline and pushed
// about by low-frequency noise so it never looks compass-drawn. Roughly 10 km long
// while the bases sit ~5.5 km apart, so cutting across is much shorter but crosses
// rough, rocky ground instead of the road.
//
// One shape per planet. This used to be a single list, which meant the same S-shaped
// road on all three worlds — you could fly to another planet and find the identical
// ten kilometres of tarmac, which did more damage to the illusion than any palette.
// Everything else follows from ROUTE_PTS on its own: base positions, the distance
// field, the flattening along the road, where missions and scrap are laid out, even
// the wreck site in the Moon flashback. Mars keeps its original numbers exactly, so
// its world is unchanged.
export const ROAD_HALF = 34; // half-width of the graded strip
const WALL_START = 1650; // farther than this from the road, ridges close the world in
const ROUTES = {
  // The original S: two long opposing curves.
  mars: {
    scale: 0.8,
    wander: 300,
    control: [
      [1650, -2900], [900, -3250], [-250, -3050], [-1150, -2450], [-1500, -1500], [-1100, -650],
      [-200, -80], [700, 350], [1350, 1000], [1500, 1900], [900, 2650], [-100, 2950], [-1050, 2850], [-1750, 2400],
    ],
  },
  // A survey traverse threading a crater field: short legs and hard dog-legs rather
  // than curves, and barely any wander — nothing up there erodes a road into a bend.
  moon: {
    scale: 0.85,
    wander: 120,
    control: [
      [1500, -2750], [640, -2880], [880, -2050], [40, -1960], [300, -1180], [-560, -1240],
      [-360, -380], [-1280, -300], [-1180, 560], [-320, 700], [-520, 1560], [360, 1500],
      [220, 2340], [1060, 2260], [900, 2900],
    ],
  },
  // A valley road: one long crescent that leans on the terrain instead of cutting
  // across it, and wanders more, the way a road worn by water and use would.
  verdanta: {
    scale: 0.82,
    wander: 420,
    control: [
      [-1500, -2950], [-400, -2800], [500, -2350], [1150, -1550], [1400, -600], [1250, 350],
      [800, 1200], [100, 1850], [-750, 2300], [-1600, 2500], [-2100, 2950],
    ],
  },
};
// Real Mars (real-mars.js) replaces the S-shaped road with a path that picks its way
// across the Jezero DTM: control points in world metres, no wander, no scale.
if (REAL_ROUTE) ROUTES.mars = { scale: 1, wander: 0, control: REAL_ROUTE };
const ROUTE = ROUTES[PLANET] || ROUTES.mars;
const ROUTE_SCALE = ROUTE.scale; // tunes the overall length
const ROUTE_CONTROL = ROUTE.control;

export const ROUTE_PTS = (() => {
  const c = ROUTE_CONTROL.map(([x, z]) => [x * ROUTE_SCALE, z * ROUTE_SCALE]);
  const pts = [];
  const at = (i) => c[Math.min(c.length - 1, Math.max(0, i))];
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const n = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 24));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const q = (a0, a1, a2, a3) =>
        0.5 * (2 * a1 + (-a0 + a2) * t + (2 * a0 - 5 * a1 + 4 * a2 - a3) * t2 + (-a0 + 3 * a1 - 3 * a2 + a3) * t3);
      pts.push({ x: q(p0[0], p1[0], p2[0], p3[0]), z: q(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  pts.push({ x: c[c.length - 1][0], z: c[c.length - 1][1] });
  // Wander a little, but keep both ends where they are.
  const last = pts.length - 1;
  pts.forEach((p, i) => {
    const fade = Math.min(1, Math.min(i, last - i) / 12);
    p.x += (fbm(p.x * 0.0011 + 40, p.z * 0.0011 + 3, 2) - 0.5) * ROUTE.wander * fade;
    p.z += (fbm(p.x * 0.0011 - 20, p.z * 0.0011 + 70, 2) - 0.5) * ROUTE.wander * fade;
  });
  let s = 0;
  pts[0].s = 0;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    pts[i].s = s;
  }
  if (REAL) {
    // Road surface height: the real ground averaged over ~±250 m, so the road reads as
    // graded — it follows the land but doesn't copy every bump.
    const raw = pts.map((p) => REAL.height(p.x, p.z));
    pts.forEach((p, i) => {
      let sum = 0, n = 0;
      for (let k = i; k >= 0 && p.s - pts[k].s <= 250; k--) { sum += raw[k]; n++; }
      for (let k = i + 1; k < pts.length && pts[k].s - p.s <= 250; k++) { sum += raw[k]; n++; }
      p.e = sum / n;
    });
    // zero the world at АЛЬФА so heights stay in the range the rest of the game expects
    const ref = pts[0].e;
    pts.forEach((p) => { p.e -= ref; });
    REAL.ref = ref;
  }
  return pts;
})();
export const ROUTE_LEN = ROUTE_PTS[ROUTE_PTS.length - 1].s;

// Each base is turned so its layout's +z (base-layout.js) faces the way the road
// leaves it — measured 40 m out, past the first wiggle — which keeps the lane from
// the road onto the main pad clear on every planet. `cargo` is the cargo pad in world
// space, where jobs.js leaves crates for pick-up.
const BASE_ROAD_LOOK = 40;
export const BASES = [0, 1].map((i) => {
  const n = ROUTE_PTS.length;
  const end = i === 1;
  const p = ROUTE_PTS[end ? n - 1 : 0];
  const dir = end ? -1 : 1;
  let k = end ? n - 1 : 0;
  while (k + dir >= 0 && k + dir < n && Math.abs(ROUTE_PTS[k].s - p.s) < BASE_ROAD_LOOK) k += dir;
  const yaw = Math.atan2(ROUTE_PTS[k].x - p.x, ROUTE_PTS[k].z - p.z);
  const b = { name: end ? 'БЕТА' : 'АЛЬФА', x: p.x, z: p.z, yaw, layout: BASE_LAYOUTS[i], y: p.e || 0 };
  b.cargo = basePoint(b, b.layout.pads[1].x, b.layout.pads[1].z);
  return b;
});
export const BASE_FLAT_R = 95;

// A point in a base's own frame (base-layout.js) to world x/z — the same turn three.js
// gives the base's group with rotation.y = yaw.
export function basePoint(b, lx, lz) {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}

// Верданта's seed lab parks beside АЛЬФА, off to one side of where the road leaves
// it — still on the base's flattened pad. Defined here (seeds.js re-exports it) so
// its walls can join the landmark solids below without an import cycle.
export const LAB = (() => {
  const a = ROUTE_PTS[0];
  const b = ROUTE_PTS[Math.min(8, ROUTE_PTS.length - 1)];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const fx = (b.x - a.x) / len;
  const fz = (b.z - a.z) / len;
  return { name: 'ЛАБОРАТОРІЯ', x: BASES[0].x - fz * 58 - fx * 12, z: BASES[0].z + fx * 58 - fz * 12 };
})();

export const ROUTE_BOUNDS = (() => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of ROUTE_PTS) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  return { x0, x1, z0, z1 };
})();

// Distance to the road, from a coarse field built once. Bilinear lookups are far
// cheaper than searching the polyline, and terrainHeight asks for this constantly.
const FSTEP = 25;
const FMARGIN = 2000;
const FIELD = (() => {
  const { x0, x1, z0, z1 } = ROUTE_BOUNDS;
  const fx0 = x0 - FMARGIN;
  const fz0 = z0 - FMARGIN;
  const nx = Math.ceil((x1 - x0 + 2 * FMARGIN) / FSTEP) + 2;
  const nz = Math.ceil((z1 - z0 + 2 * FMARGIN) / FSTEP) + 2;
  const d = new Float32Array(nx * nz);
  const e = new Float32Array(nx * nz); // road surface height at the nearest road point
  const n = ROUTE_PTS.length;
  for (let j = 0; j < nz; j++) {
    const pz = fz0 + j * FSTEP;
    for (let i = 0; i < nx; i++) {
      const px = fx0 + i * FSTEP;
      // Nearest vertex first; the nearest point on the line is on one of its two segments.
      let bi = 0;
      let bd = Infinity;
      for (let k = 0; k < n; k++) {
        const dx = px - ROUTE_PTS[k].x;
        const dz = pz - ROUTE_PTS[k].z;
        const dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; bi = k; }
      }
      let best = bd;
      let be = ROUTE_PTS[bi].e || 0;
      for (const k of [bi - 1, bi]) {
        if (k < 0 || k >= n - 1) continue;
        const a = ROUTE_PTS[k];
        const b = ROUTE_PTS[k + 1];
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const t = clamp(((px - a.x) * ex + (pz - a.z) * ez) / (ex * ex + ez * ez), 0, 1);
        const dx = px - (a.x + ex * t);
        const dz = pz - (a.z + ez * t);
        const dd2 = dx * dx + dz * dz;
        if (dd2 < best) { best = dd2; be = (a.e || 0) + ((b.e || 0) - (a.e || 0)) * t; }
      }
      d[j * nx + i] = Math.sqrt(best);
      e[j * nx + i] = be;
    }
  }
  return { x0: fx0, z0: fz0, nx, nz, d, e };
})();

export function roadDist(x, z) {
  const fx = clamp((x - FIELD.x0) / FSTEP, 0, FIELD.nx - 1.001);
  const fz = clamp((z - FIELD.z0) / FSTEP, 0, FIELD.nz - 1.001);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const o = j * FIELD.nx + i;
  const d = FIELD.d;
  return d[o] * (1 - u) * (1 - v) + d[o + 1] * u * (1 - v) + d[o + FIELD.nx] * (1 - u) * v + d[o + FIELD.nx + 1] * u * v;
}

// Height of the road surface at the road point nearest to (x, z) — same coarse field.
function roadElevAt(x, z) {
  const fx = clamp((x - FIELD.x0) / FSTEP, 0, FIELD.nx - 1.001);
  const fz = clamp((z - FIELD.z0) / FSTEP, 0, FIELD.nz - 1.001);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const o = j * FIELD.nx + i;
  const e = FIELD.e;
  return e[o] * (1 - u) * (1 - v) + e[o + 1] * u * (1 - v) + e[o + FIELD.nx] * (1 - u) * v + e[o + FIELD.nx + 1] * u * v;
}

// Index of the route vertex closest to a point.
export function nearestRouteIndex(x, z) {
  let bi = 0;
  let bd = Infinity;
  for (let k = 0; k < ROUTE_PTS.length; k++) {
    const dx = x - ROUTE_PTS[k].x;
    const dz = z - ROUTE_PTS[k].z;
    const dd = dx * dx + dz * dz;
    if (dd < bd) { bd = dd; bi = k; }
  }
  return bi;
}

// Where to put the rover at a base and which way the road leaves it.
// Measured in metres along the road, not in route points: point spacing follows the
// control points, so counting two of them put the rover 48 m clear of the base on one
// planet and 29 m on another — close enough for the chase camera to end up inside the
// buildings.
const SPAWN_CLEAR = 50;
export function roadSpawn(atEnd) {
  const n = ROUTE_PTS.length;
  let k = atEnd ? n - 1 : 0;
  const dir = atEnd ? -1 : 1;
  const from = ROUTE_PTS[k].s;
  while (k + dir >= 0 && k + dir < n && Math.abs(ROUTE_PTS[k].s - from) < SPAWN_CLEAR) k += dir;
  const p = ROUTE_PTS[k];
  const q = ROUTE_PTS[clamp(k + dir, 0, n - 1)];
  return { x: p.x, z: p.z, yaw: Math.atan2(q.x - p.x, q.z - p.z) };
}

// Metres left along the road from where you are to one end, plus the detour to reach it.
export function roadRemaining(x, z, toEnd) {
  const k = nearestRouteIndex(x, z);
  const along = toEnd ? ROUTE_LEN - ROUTE_PTS[k].s : ROUTE_PTS[k].s;
  return along + Math.hypot(x - ROUTE_PTS[k].x, z - ROUTE_PTS[k].z);
}

// Ridges that close the world in far from the road.
function wallAmount(x, z) {
  const off = roadDist(x, z) + (fbm(x * 0.0016 + 11, z * 0.0016 + 5, 2) - 0.5) * 170;
  return smooth(WALL_START, WALL_START + 240, off);
}

// Flat apron around each base so the habitat sits level and you can park.
function baseFlatten(x, z) {
  let k = 1;
  for (const b of BASES) {
    k = Math.min(k, smooth(BASE_FLAT_R * 0.55, BASE_FLAT_R * 1.7, Math.hypot(x - b.x, z - b.z)));
  }
  return k;
}

// Craters lie beside the road, never on it, and get more frequent the farther you go.
// Parametrized so the Moon can reuse it for a much denser, closer-in field instead
// of a second copy of the same loop — `seed` keeps the two planets' crater sets from
// landing on exactly the same spots along the route.
function buildCraters(count, seed, { pad, sizeMin, sizeMax, spread }) {
  const list = [];
  const n = ROUTE_PTS.length;
  for (let i = 0; i < count; i++) {
    const r1 = hash(i * 3 + 1 + seed, 7);
    const r2 = hash(i * 5 + 2 + seed, 13);
    const r3 = hash(i * 7 + 3 + seed, 29);
    const r4 = hash(i * 11 + 5 + seed, 41);
    const k = 1 + Math.floor(r1 * (n - 3));
    const a = ROUTE_PTS[k - 1];
    const b = ROUTE_PTS[k + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    const R = sizeMin + r3 * (sizeMax - sizeMin);
    const off = (r2 < 0.5 ? -1 : 1) * (pad + R + r4 * spread);
    const x = ROUTE_PTS[k].x + nx * off;
    const z = ROUTE_PTS[k].z + nz * off;
    if (roadDist(x, z) < pad + R) continue;
    if (BASES.some((bs) => Math.hypot(x - bs.x, z - bs.z) < BASE_FLAT_R + R + 40)) continue;
    list.push({ x, z, R });
  }
  return list;
}

const CRATERS = PLANET === 'moon'
  // No atmosphere to weather them away — heavily, uniformly cratered right up
  // close to the path, at every size from potholes to real bowls.
  ? buildCraters(950, 1000, { pad: ROAD_HALF - 6, sizeMin: 5, sizeMax: 70, spread: 1500 })
  : PLANET === 'verdanta'
  // A living world weathers its impact scars away — none left to speak of.
  ? []
  : buildCraters(150, 0, { pad: ROAD_HALF + 30, sizeMin: 14, sizeMax: 48, spread: 900 });

// A winding river, independent of the road: not a built polyline but the zero
// contour of a slow noise field, which is naturally sinuous for free — no path-
// finding or distance search needed, just evaluate it at (x, z) like every other
// height/colour term here. Only Верданта has one.
export const RIVER_HALF = 17; // metres from the centre line to the bank
export const RIVER_DEPTH = 4; // how deep the channel is cut at the centre line
const RIVER_F = 0.0011;
const _rn = (x, z) => fbm(x * RIVER_F + 500, z * RIVER_F - 300, 3) - 0.5;
function riverAmount(x, z) {
  if (PLANET !== 'verdanta') return 0;
  const n = _rn(x, z);
  // Distance to the centre line in *metres*, not in noise value. Dividing by the
  // local gradient is what converts one into the other, and it is the whole reason
  // the channel keeps its width: thresholding the raw value instead made the river
  // 400 m across wherever the noise happened to flatten out and a hairline wherever
  // it steepened, which is why it read as a stain rather than as a river. Forward
  // differences, not central — two extra noise taps instead of four, and the extra
  // accuracy would not survive the smoothstep anyway.
  const e = 9;
  const gx = (_rn(x + e, z) - n) / e;
  const gz = (_rn(x, z + e) - n) / e;
  const grad = Math.max(Math.sqrt(gx * gx + gz * gz), 1e-7);
  return 1 - smooth(0, RIVER_HALF, Math.abs(n) / grad);
}

// How far up the channel the water line sits. The surface is therefore at
// bank - RIVER_DEPTH * RIVER_FILL, which puts it above the ground exactly where
// riverAmount > RIVER_FILL and under it everywhere else — see water.js.
export const RIVER_FILL = 0.5;

// Height of the ground the river cut its channel into — the bank level. The channel
// is carved out of this, so anything that needs to know where the water sits (see
// water.js) can reconstruct it without a second copy of the terrain formula.
export function riverBankHeight(x, z) {
  return terrainHeight(x, z) + riverAmount(x, z) * RIVER_DEPTH;
}
export function riverDepthAt(x, z) {
  return riverAmount(x, z);
}

// The one place anything asks "is there water here, and how deep": the splash spray,
// the wake, the drag on the wheels and the surface mesh itself all read these two,
// so they can never disagree about where the waterline is.
export function waterDepthAt(x, z) {
  if (PLANET !== 'verdanta') return 0;
  const d = (riverAmount(x, z) - RIVER_FILL) * RIVER_DEPTH;
  return d > 0 ? d : 0;
}
export function waterLevelAt(x, z) {
  return terrainHeight(x, z) + (riverAmount(x, z) - RIVER_FILL) * RIVER_DEPTH;
}

// How thick the moss is at a point, 0..1. It does not fade evenly outwards from the
// water the way the first version did — that read as a painted gradient. Real moss
// fields (the Icelandic ones this planet is modelled on) grow in irregular cushions
// with bare rock showing between them, so a patch field does most of the shaping and
// the distance to water only decides where moss is possible at all. Shared with
// grass.js, which plants its tufts wherever this is already high, so the 3D tufts and
// the painted green can never disagree about where the moss is.
function mossAmount(x, z, steep) {
  const river = riverAmount(x, z);
  if (river <= 0) return 0;
  const patchy = smooth(0.34, 0.7, fbm(x * 0.021 + 33, z * 0.021 - 71, 3));
  const fine = smooth(0.15, 0.45, fbm(x * 0.2, z * 0.2, 2));
  return clamp(river * 2.4, 0, 1) * (1 - steep) * (0.12 + 0.88 * patchy) * (0.55 + 0.45 * fine);
}

// Bucket the craters by x so a lookup touches only a few.
const CRATER_BIN = 400;
const craterBins = new Map();
for (const c of CRATERS) {
  const k = Math.floor(c.x / CRATER_BIN);
  for (const d of [-1, 0, 1]) {
    if (!craterBins.has(k + d)) craterBins.set(k + d, []);
    craterBins.get(k + d).push(c);
  }
}

function craterHeight(x, z) {
  const bin = craterBins.get(Math.floor(x / CRATER_BIN));
  if (!bin) return 0;
  let h = 0;
  for (const c of bin) {
    const dx = x - c.x;
    const dz = z - c.z;
    const lim = c.R * 2.2;
    if (dx * dx + dz * dz > lim * lim) continue;
    const t = (Math.sqrt(dx * dx + dz * dz) / c.R) * (1 + 0.14 * (vnoise(x * 0.05, z * 0.05) - 0.5));
    if (t < 1) h -= c.R * 0.085 * (1 - t * t);
    h += c.R * 0.03 * Math.exp(-(((t - 1) / 0.3) ** 2));
  }
  return h;
}

// ---------- big landforms: impact basins, collapse pits, scarps, a canyon ----------
// Scattered off the road (it stays drivable: each one fades out before it reaches
// the graded strip) and away from where the town goes. Plain data, placed once.
//
// Where «Обрій» may stand (see placeSettlement): kept clear of all of this.
const TOWN_SPOTS = (() => {
  const k = Math.floor(ROUTE_PTS.length * 0.42);
  const a = ROUTE_PTS[k];
  const b = ROUTE_PTS[Math.min(k + 4, ROUTE_PTS.length - 1)];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const nx = -(b.z - a.z) / len;
  const nz = (b.x - a.x) / len;
  return [1, -1].map((s) => ({ x: a.x + nx * s * 340, z: a.z + nz * s * 340 }));
})();
const nearTownSpot = (x, z, r) => PLANET === 'mars' && TOWN_SPOTS.some((t) => Math.hypot(x - t.x, z - t.z) < 190 + r);

// Somewhere off the road at a random point along it: `gap` metres of clear ground
// between the road strip and the feature's edge, plus up to `spread` more.
function offRoadSpot(i, seed, R, gap, spread) {
  const n = ROUTE_PTS.length;
  const k = 1 + Math.floor(hash(i * 3 + 1 + seed, 17) * (n - 3));
  const a = ROUTE_PTS[k - 1];
  const b = ROUTE_PTS[k + 1];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const nx = -(b.z - a.z) / len;
  const nz = (b.x - a.x) / len;
  const off = (hash(i * 5 + 2 + seed, 23) < 0.5 ? -1 : 1) * (ROAD_HALF + gap + R + hash(i * 7 + 3 + seed, 31) * spread);
  const x = ROUTE_PTS[k].x + nx * off;
  const z = ROUTE_PTS[k].z + nz * off;
  if (roadDist(x, z) < ROAD_HALF + gap + R * 0.9) return null;
  if (BASES.some((bs) => Math.hypot(x - bs.x, z - bs.z) < BASE_FLAT_R + R + 120)) return null;
  if (nearTownSpot(x, z, R)) return null;
  return { x, z };
}

// Impact basins: a flat floor well below the plain, steep inner walls, a raised
// rim, ejecta tapering away outside, and a central peak in the biggest.
const BASINS = (() => {
  const cfg = { mars: [26, 70, 210, 160, 1500], moon: [30, 60, 240, 90, 1500] }[PLANET];
  if (!cfg) return [];
  const [count, rMin, rMax, gap, spread] = cfg;
  const out = [];
  for (let i = 0; i < count * 3 && out.length < count; i++) {
    const R = rMin + Math.pow(hash(i * 13 + 7, 3), 1.6) * (rMax - rMin);
    const p = offRoadSpot(i, 5000, R * 1.6, gap, spread);
    if (!p) continue;
    if (out.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < (c.R + R) * 1.3)) continue;
    out.push({ x: p.x, z: p.z, R, D: R * (0.16 + 0.06 * hash(i, 99)), peak: R > 140 });
  }
  return out;
})();

// Collapse pits: ground fallen into a void underneath — round holes with sheer
// walls, some alone, most in a row along a buried fault, like the pit chains of
// Mars and the skylights of the Moon. They are deep: drive in and you stay in.
export const TERRAIN_FEATURES = { get basins() { return BASINS; }, get pits() { return PITS; } };
const PITS = (() => {
  const cfg = { mars: [16, 12, 28, 40, 700], moon: [8, 12, 30, 30, 900] }[PLANET];
  if (!cfg) return [];
  const [chains, rMin, rMax, gap, spread] = cfg;
  const out = [];
  for (let c = 0; c < chains; c++) {
    const n = 1 + Math.floor(hash(c, 61) * 4);
    const R0 = rMin + hash(c, 62) * (rMax - rMin);
    const p = offRoadSpot(c, 8000, R0 * n * 1.4, gap, spread);
    if (!p) continue;
    const ang = hash(c, 63) * Math.PI * 2;
    for (let j = 0; j < n; j++) {
      const R = R0 * (0.65 + 0.5 * hash(c * 7 + j, 64));
      const along = (j - (n - 1) / 2) * R0 * 2.4;
      const x = p.x + Math.cos(ang) * along;
      const z = p.z + Math.sin(ang) * along;
      if (roadDist(x, z) < ROAD_HALF + gap + R) continue;
      if (BASINS.some((b) => Math.hypot(b.x - x, b.z - z) < b.R * 1.4 + R)) continue;
      out.push({ x, z, R, D: R * (0.7 + 0.4 * hash(c * 7 + j, 65)) });
    }
  }
  return out;
})();

const FEATURE_BIN = 600;
const featureBins = new Map();
for (const f of [...BASINS.map((b) => ({ ...b, kind: 0 })), ...PITS.map((p) => ({ ...p, kind: 1 }))]) {
  const reach = f.kind === 0 ? f.R * 1.9 : f.R * 1.3;
  for (let i = Math.floor((f.x - reach) / FEATURE_BIN); i <= Math.floor((f.x + reach) / FEATURE_BIN); i++) {
    for (let j = Math.floor((f.z - reach) / FEATURE_BIN); j <= Math.floor((f.z + reach) / FEATURE_BIN); j++) {
      const key = i * 65536 + j;
      if (!featureBins.has(key)) featureBins.set(key, []);
      featureBins.get(key).push(f);
    }
  }
}

function featureHeight(x, z) {
  const bin = featureBins.get(Math.floor(x / FEATURE_BIN) * 65536 + Math.floor(z / FEATURE_BIN));
  if (!bin) return 0;
  let h = 0;
  for (const f of bin) {
    const dx = x - f.x;
    const dz = z - f.z;
    const d2 = dx * dx + dz * dz;
    if (f.kind === 0) {
      if (d2 > (f.R * 1.9) ** 2) continue;
      // A ragged outline, not a compass circle.
      const t = (Math.sqrt(d2) / f.R) * (1 + 0.08 * (vnoise(x * 0.012 + f.x * 0.001, z * 0.012) - 0.5));
      const bowl = 1 - smooth(0.62, 0.97, t); // floor .. top of the inner wall
      h -= f.D * bowl;
      h += f.R * 0.045 * Math.exp(-(((t - 1) / 0.13) ** 2)); // the rim
      if (t > 1) h += f.R * 0.03 * Math.exp(-(t - 1) * 3) * smooth(1.9, 1.3, t); // ejecta apron
      if (f.peak) h += f.D * 0.55 * Math.exp(-((t / 0.17) ** 2));
    } else {
      if (d2 > (f.R * 1.3) ** 2) continue;
      const t = (Math.sqrt(d2) / f.R) * (1 + 0.12 * (vnoise(x * 0.08, z * 0.08) - 0.5));
      h -= f.D * (1 - smooth(0.72, 1.0, t)); // near-vertical walls
      if (t > 0.95) h -= 0.8 * smooth(1.3, 1.0, t); // a slumped lip round the edge
    }
  }
  return h;
}

// Fault scarps: whole tracts of ground dropped down along a line, leaving a wall of
// rock tens of metres high. A slow field picks the sunken side; a very narrow step
// across its threshold makes the wall, a little noise on the threshold frays it.
// Fades out near the road, which ramps down the step where it crosses.
function scarpHeight(wx, wz, rd) {
  const away = smooth(110, 380, rd);
  if (away <= 0) return 0;
  const f = fbm(wx * 0.00075 + 700, wz * 0.00075 - 420, 3) + (fbm(wx * 0.012 + 3, wz * 0.012 + 8, 2) - 0.5) * 0.012;
  const step = smooth(0.535, 0.545, f);
  if (step <= 0) return 0;
  const depth = 26 + 22 * fbm(wx * 0.002 + 9, wz * 0.002 - 4, 2);
  // A second, lower step on part of it: terraces going down.
  const step2 = smooth(0.585, 0.593, f) * smooth(0.45, 0.6, fbm(wx * 0.0011 + 33, wz * 0.0011 + 71, 2));
  return -away * (step * depth + step2 * depth * 0.6);
}

// A canyon: the zero line of a slow field winds across the plain like a dry river;
// within a band either side of it the ground falls away to a flat floor between
// steep walls. Shallow where it nears the road, so the road crosses on a saddle.
function canyonHeight(wx, wz, rd) {
  const away = smooth(150, 520, rd);
  if (away <= 0) return 0;
  const c = Math.abs(fbm(wx * 0.00055 - 900, wz * 0.00055 + 260, 3) - 0.5);
  const half = 0.011 + 0.004 * fbm(wx * 0.003, wz * 0.003 + 5, 2);
  const inside = 1 - smooth(half * 0.62, half, c);
  if (inside <= 0) return 0;
  const depth = 38 + 20 * fbm(wx * 0.0015 + 61, wz * 0.0015 + 2, 2);
  return -away * inside * depth;
}

// Flat-topped mesas standing over the plain, the shape Mars is photographed in.
// A slow field says where one stands, and a very narrow smoothstep across its edge
// turns what would be a hillside into a sheer wall and leaves the top dead level.
// The second tier only rises where the first is already there, so they stack into
// terraces. Returns the height; `onTop` says how flat the ground up there should be.
const MESA = { onTop: 0 };
function mesaHeight(wx, wz) {
  const m1 = fbm(wx * 0.00068 + 310, wz * 0.00068 - 180, 3);
  // A narrow band right at the threshold gave every barely-there wobble of the coarse
  // field the same sharp-walled edge as a real mesa: dozens of shin-high "cliffs"
  // scattered over otherwise flat ground, which read from a distance as dark smudges.
  // Starting the ramp well above the field's middle means only its actual local
  // maxima ever clear it, so a mesa now stands somewhere there was already a broad
  // rise, instead of any point where the noise merely ticks past the midline.
  const k1 = smooth(0.58, 0.635, m1);
  if (k1 <= 0) {
    MESA.onTop = 0;
    return 0;
  }
  const m2 = fbm(wx * 0.00152 + 52, wz * 0.00152 + 640, 2);
  const k2 = smooth(0.52, 0.55, m2);
  MESA.onTop = k1 * (0.55 + 0.45 * k2);
  return k1 * 84 + k1 * k2 * 50;
}

// No atmosphere, no volcanism, no dunes — just rolling regolith and craters,
// everywhere, right up to the path. None of Mars's mesas/dune fields/mountain
// ranges; the crater field itself (see CRATERS above) does almost all the work.
function moonHeight(x, z) {
  const rd = roadDist(x, z);
  const rough = smooth(ROAD_HALF + 6, ROAD_HALF + 90, rd);
  let h = (fbm(x * 0.006 + 5, z * 0.006 + 9, 3) - 0.46) * 5 * (0.3 + 2.0 * rough);
  h += (fbm(x * 0.03 + 60, z * 0.03 - 18, 2) - 0.46) * 1.6 * (0.3 + 2.4 * rough);
  h += craterHeight(x, z);
  h += featureHeight(x, z);

  const wall = wallAmount(x, z);
  if (wall > 0) h += wall * (30 + 50 * fbm(x * 0.0075 + 400, z * 0.0075 + 120, 3));

  const flat = baseFlatten(x, z);
  const mid = (fbm(x * 0.06, z * 0.06, 3) - 0.44) * 0.7 * (0.5 + 1.0 * rough);
  const bumpy = (fbm(x * 0.18 + 9, z * 0.18 + 4, 2) - 0.44) * 0.22 * (0.5 + 2.0 * rough);
  const small = (vnoise(x * 0.35, z * 0.35) - 0.5) * 0.1;
  return (h + mid + bumpy + small) * flat;
}

// Верданта: a living world, roughly human gravity — mountains and a winding river,
// no craters, no dunes. Reuses Mars's own mesa/mountain-range shapes (they're just
// good basalt-peak shapes) rather than inventing a third mountain formula, recoloured
// black-and-moss instead of red by verdantaColorAt below.
function verdantaHeight(x, z) {
  const rd = roadDist(x, z);
  const rough = smooth(ROAD_HALF + 14, ROAD_HALF + 170, rd);
  const away = smooth(60, 340, rd);
  const wx = x + (fbm(x * 0.02 + 11, z * 0.02 + 3, 2) - 0.5) * 26;
  const wz = z + (fbm(x * 0.02 - 7, z * 0.02 + 29, 2) - 0.5) * 26;

  const mesa = away > 0 ? mesaHeight(wx, wz) : 0;
  const flatTop = 1 - 0.75 * MESA.onTop * away;

  let h = (fbm(wx * 0.009 + 5, wz * 0.009 + 9, 3) - 0.46) * 7 * (0.3 + 2.2 * rough) * flatTop;
  h += (fbm(wx * 0.026 + 60, wz * 0.026 - 18, 2) - 0.46) * 2 * (0.3 + 2.6 * rough) * flatTop;

  if (away > 0) {
    h += away * mesa;
    const range = smooth(0.4, 0.64, fbm(wx * 0.00085 + 120, wz * 0.00085 - 60, 4));
    if (range > 0) {
      const ridge = 1 - Math.abs(fbm(wx * 0.0013 + 7, wz * 0.0013 + 81, 3) * 2 - 1);
      h += away * range * (55 + 120 * ridge * ridge + 35 * fbm(wx * 0.005 + 3, wz * 0.005 + 44, 3));
    }
  }

  // The river carves its own shallow valley so it actually sits low instead of
  // just being painted onto flat ground (see verdantaColorAt for the water/moss).
  h -= riverAmount(x, z) * RIVER_DEPTH;
  h += scarpHeight(wx, wz, rd) * 0.8 * flatTop * (1 - riverAmount(x, z));

  const wall = wallAmount(x, z);
  if (wall > 0) h += wall * (32 + 58 * fbm(x * 0.0075 + 400, z * 0.0075 + 120, 3));

  const flat = baseFlatten(x, z);
  const mid = (fbm(x * 0.06, z * 0.06, 3) - 0.44) * 0.85 * (0.5 + 1.2 * rough);
  const bumpy = (fbm(x * 0.18 + 9, z * 0.18 + 4, 2) - 0.44) * 0.28 * (0.5 + 2.2 * rough);
  const small = (vnoise(x * 0.35, z * 0.35) - 0.5) * 0.11;
  return (h + mid + bumpy + small) * flat;
}

// A graded road across rough country: gentle along the road, hilly, cratered and
// strewn with boulders once you leave it. Raw: before landmarks level their ground.
// Wind-blown ripples on the flat, bright, dusty ground (the low basins of the orbiter
// photo): crests a score of metres apart across a global wind direction, bent a little by
// noise. Zero on the road, on slopes and on bare dark ground. Returns metres of height.
const WIND = 0.6; // radians: the crests run perpendicular to this
export function sandRipples(x, z) {
  if (!REAL) return 0;
  const amt = dustDepth(x, z) * (1 - smooth(0.04, 0.12, REAL.slope(x, z)));
  if (amt <= 0.02) return 0;
  const ph = (x * Math.cos(WIND) + z * Math.sin(WIND)) * 0.36 + (fbm(x * 0.02 + 5, z * 0.02 - 8, 2) - 0.44) * 9;
  return amt * 0.16 * (Math.sin(ph) + 0.4 * Math.sin(2 * ph + 1));
}

// Real Mars: the DTM is the ground. Along the road it is graded to the road's own
// profile; far off it, the land is as measured. Small noise on top because 20 m pixels
// say nothing about what a wheel feels.
// Craters the DTM cannot show: 5-40 m across, the many small ones that outnumber the big
// (a power-law of sizes), one candidate per 64 m cell, each at a hashed spot. Fresh bowls
// with a low raised rim. Returns the height they add at (x, z), metres (negative inside).
const SC_CELL = 64;
const SC_RMAX = 20;
export function smallCraters(x, z) {
  const ci = Math.floor(x / SC_CELL), cj = Math.floor(z / SC_CELL);
  const fx = x / SC_CELL - ci, fz = z / SC_CELL - cj;
  const m = (SC_RMAX * 1.4) / SC_CELL; // how far a crater's skirt reaches into the next cell, as a fraction
  let bowl = 0, rim = 0; // the deepest bowl wins where two overlap; rims add
  for (let j = fz < m ? -1 : 0; j <= (fz > 1 - m ? 1 : 0); j++) for (let i = fx < m ? -1 : 0; i <= (fx > 1 - m ? 1 : 0); i++) {
    const a = ci + i, b = cj + j;
    for (let n = 0; n < 2; n++) { // two candidates per cell
      if (hash(a * 1.7 + 13.1 + n * 40, b * 2.3 + 5.7 - n * 17) > 0.85) continue;
      const u = hash(a + 71 + n * 9, b + 29);
      const r = Math.min(SC_RMAX, 2.5 / Math.pow(1 - u * 0.97, 1 / 1.8)); // radius 2.5 m and up, mostly small
      const cx = (a + 0.2 + 0.6 * hash(a + 3 + n, b + 91)) * SC_CELL, cz = (b + 0.2 + 0.6 * hash(a + 57, b + 13 + n)) * SC_CELL;
      const t = Math.hypot(x - cx, z - cz) / r;
      if (t > 1.7) continue;
      const depth = 0.24 * r;
      if (t < 1) bowl = Math.min(bowl, -depth * (1 - t * t) * (1 - 0.25 * t * t));
      else rim += depth * 0.14 * Math.exp(-(((t - 1.08) / 0.3) ** 2));
    }
  }
  return bowl + rim;
}

function realMarsHeight(x, z) {
  const rd = roadDist(x, z);
  const rough = smooth(ROAD_HALF + 14, ROAD_HALF + 170, rd);
  const re = roadElevAt(x, z);
  let h = (REAL.height(x, z) - REAL.ref) * rough + re * (1 - rough);
  // past the edge of the map, ridges close the world in
  const over = Math.max(Math.abs(x) - (REAL.halfW - 1500), Math.abs(z) - (REAL.halfH - 1500), 0);
  if (over > 0) h += smooth(0, 1500, over) * 400;
  let k = 1;
  for (const b of BASES) {
    const f = smooth(BASE_FLAT_R * 0.55, BASE_FLAT_R * 1.7, Math.hypot(x - b.x, z - b.z));
    h = b.y + (h - b.y) * f;
    k = Math.min(k, f);
  }
  const mid = (fbm(x * 0.06, z * 0.06, 3) - 0.44) * 0.9 * (0.5 + 1.2 * rough);
  const bumpy = (fbm(x * 0.18 + 9, z * 0.18 + 4, 2) - 0.44) * 0.3 * (0.5 + 2.4 * rough);
  const small = (vnoise(x * 0.35, z * 0.35) - 0.5) * 0.12;
  // The DTM is 20-30 m per pixel: smooth where the real ground is rough, which is on steep
  // faces (rims, scarps). Broken-up rock there, in metres, growing with the slope and
  // gone on the road and the base pads.
  const slope = REAL.slope(x, z);
  // small craters only on open, gentle ground well off the road and the base pads
  const open = (1 - smooth(0.08, 0.2, slope)) * smooth(0.3, 0.9, rough);
  const bowls = open > 0 ? smallCraters(x, z) * open : 0;
  const ripples = sandRipples(x, z);
  const steep = smooth(0.1, 0.4, slope);
  const crag = steep > 0
    ? ((fbm(x * 0.11 + 70, z * 0.11 - 30, 3) - 0.44) * 8 + (vnoise(x * 0.45 + 5, z * 0.45 + 9) - 0.5) * 2) * steep * rough
    : 0;
  return h + (mid + bumpy + small + crag + bowls + ripples) * k;
}

function rawTerrainHeight(x, z) {
  if (REAL) return realMarsHeight(x, z);
  if (PLANET === 'moon') return moonHeight(x, z);
  if (PLANET === 'verdanta') return verdantaHeight(x, z);
  const rd = roadDist(x, z);
  const rough = smooth(ROAD_HALF + 14, ROAD_HALF + 170, rd); // 0 on the road, 1 out in the rough
  const away = smooth(60, 340, rd);
  const wx = x + (fbm(x * 0.02 + 11, z * 0.02 + 3, 2) - 0.5) * 26;
  const wz = z + (fbm(x * 0.02 - 7, z * 0.02 + 29, 2) - 0.5) * 26;

  // Mesas are worked out first: the rolling hills are flattened away on top of one,
  // or the plateau reads as another lumpy hill instead of a table.
  const mesa = away > 0 ? mesaHeight(wx, wz) : 0;
  const flatTop = 1 - 0.75 * MESA.onTop * away;

  let h = (fbm(wx * 0.009 + 5, wz * 0.009 + 9, 3) - 0.46) * 9 * (0.3 + 2.5 * rough) * flatTop;
  h += (fbm(wx * 0.026 + 60, wz * 0.026 - 18, 2) - 0.46) * 2.4 * (0.3 + 3.0 * rough) * flatTop;

  const duneZone = smooth(0.44, 0.6, fbm(wx * 0.012 + 200, wz * 0.012 + 90, 2)) * flatTop;
  if (duneZone > 0) {
    const ph = (wx * 0.7 + wz * 0.4) * 0.16 + (fbm(wx * 0.03, wz * 0.03, 2) - 0.44) * 5;
    h += duneZone * 1.15 * 0.5 * (Math.sin(ph) + 0.5 * Math.sin(2 * ph + 0.6)) * (0.4 + 1.2 * rough);
  }
  h += craterHeight(x, z);
  h += featureHeight(x, z);
  h += scarpHeight(wx, wz, rd) * flatTop;
  h += canyonHeight(wx, wz, rd);

  // Real mountains, kept off the road: the road threads the valleys between them, so
  // cutting across means climbing. The foothills start ~70 m from the road.
  if (away > 0) {
    h += away * mesa;
    const range = smooth(0.4, 0.64, fbm(wx * 0.00085 + 120, wz * 0.00085 - 60, 4));
    if (range > 0) {
      const ridge = 1 - Math.abs(fbm(wx * 0.0013 + 7, wz * 0.0013 + 81, 3) * 2 - 1);
      h += away * range * (60 + 110 * ridge * ridge + 40 * fbm(wx * 0.005 + 3, wz * 0.005 + 44, 3));
    }
  }

  const wall = wallAmount(x, z);
  if (wall > 0) h += wall * (34 + 62 * fbm(x * 0.0075 + 400, z * 0.0075 + 120, 3));

  const flat = baseFlatten(x, z);
  const mid = (fbm(x * 0.06, z * 0.06, 3) - 0.44) * 0.9 * (0.5 + 1.2 * rough);
  const bumpy = (fbm(x * 0.18 + 9, z * 0.18 + 4, 2) - 0.44) * 0.3 * (0.5 + 2.4 * rough);
  const small = (vnoise(x * 0.35, z * 0.35) - 0.5) * 0.12;
  return (h + mid + bumpy + small) * flat;
}

// ---------- landmarks: buildings and wrecks out in the wilds ----------
// Each planet scatters its own set (see landmark-types.js) across the country off
// the road. Here they are only data: where each stands, the ground it levels to
// stand on, and its solid shapes, which groundHeight below folds in so the rover
// meets a wall the same way it meets a boulder. landmarks.js draws them.
//
// Placed lazily, on first use: terrainHeight is already called while this module
// is still loading (the road field, craters), long before everything placement
// reads exists. Until `lmArmed` is set at the bottom of the file the plain height is
// used. `var`, not `let`, so an early read sees undefined instead of throwing.
var lmArmed;
var lmList = null;
var lmGrid = null;
const LM_CELL = 160;
const lmKey = (i, j) => i * 65536 + j;

// ---------- bridges ----------
// A span across the canyon, so you can cross it on the level instead of driving
// down one wall and up the other. Each is placed from a point in the canyon: the
// direction with the shortest way out to both rims wins, and the deck runs from rim
// to rim a little way back from each edge. The deck is ground only for something at
// its level (see deckRef): drive along the canyon floor and you pass underneath.
export const BRIDGES = [];
const BRIDGE_SEEDS = (REAL ? {} : { mars: [[755, -2067]] })[PLANET] || [];
const BRIDGE_W = 12; // deck width: two of the widest rover side by side, with room to spare
let deckRef = -Infinity;
// physics.js sets this to the rover's height each step.
export function setDeckRef(y) { deckRef = y; }
function planBridge(sx, sz) {
  const floor = rawTerrainHeight(sx, sz);
  let best = null;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const out = [];
    for (const sg of [1, -1]) {
      let hit = null;
      for (let d = 4; d < 220; d += 2) {
        const h = rawTerrainHeight(sx + dx * d * sg, sz + dz * d * sg);
        if (h > floor + 28) { hit = d; break; }
      }
      out.push(hit);
    }
    if (out[0] === null || out[1] === null) continue;
    const span = out[0] + out[1];
    if (!best || span < best.span) best = { span, dx, dz, d1: out[0], d2: out[1] };
  }
  if (!best) return;
  // Run each end back from the lip until the ground has levelled off.
  const end = (sg, d0) => {
    let d = d0;
    let prev = rawTerrainHeight(sx + best.dx * d * sg, sz + best.dz * d * sg);
    for (let n = 0; n < 30; n++) {
      d += 2;
      const h = rawTerrainHeight(sx + best.dx * d * sg, sz + best.dz * d * sg);
      if (Math.abs(h - prev) < 0.5) break;
      prev = h;
    }
    d += 10;
    const x = sx + best.dx * d * sg;
    const z = sz + best.dz * d * sg;
    return { x, z, y: rawTerrainHeight(x, z) };
  };
  const A = end(1, best.d1);
  const B = end(-1, best.d2);
  const len = Math.hypot(B.x - A.x, B.z - A.z);
  BRIDGES.push({ ax: A.x, az: A.z, ay: A.y, bx: B.x, bz: B.z, by: B.y, len, w: BRIDGE_W,
    ux: (B.x - A.x) / len, uz: (B.z - A.z) / len, floor });
}
// Top of the deck at (x, z), or -Infinity off every bridge.
export function deckHeight(x, z) {
  let top = -Infinity;
  for (const b of BRIDGES) {
    const dx = x - b.ax;
    const dz = z - b.az;
    const t = (dx * b.ux + dz * b.uz) / b.len;
    if (t < 0 || t > 1) continue;
    if (Math.abs(-dx * b.uz + dz * b.ux) > b.w / 2) continue;
    // A gentle camber up over the middle, ramps easing on at each end.
    // The plate's 35 cm thickness eases in over the first and last few metres, so
    // the wheels roll on rather than hitting a step.
    const ramp = Math.min(1, (t * b.len) / 5, ((1 - t) * b.len) / 5);
    const y = b.ay + (b.by - b.ay) * t + Math.sin(Math.PI * t) * Math.min(3, b.len * 0.02) + 0.35 * ramp;
    if (y > top) top = y;
  }
  return top;
}
function bridgeSites() {
  for (const b of BRIDGES) {
    const yaw = Math.atan2(b.ux, b.uz); // local +z along the deck
    const lo = Math.min(b.ay, b.by);
    const rails = Math.abs(b.by - b.ay) + Math.min(3, b.len * 0.02) + 1.8;
    const mid = { x: (b.ax + b.bx) / 2, z: (b.az + b.bz) / 2 };
    // Kerb walls along both sides of the deck, standing from the lower end up.
    const deck = {
      name: 'Міст', id: 'bridge', colliders: [-1, 1].map((sg) => ({ k: 'box', x: sg * (b.w / 2 + 0.25), z: 0, w: 0.5, d: b.len - 6, h: rails })),
    };
    const lm = { type: deck, x: mid.x, z: mid.z, y: lo - 0.5, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), r: 0, R: b.len / 2 + 10, hidden: true };
    pushSite(lm);
    // The piers, standing on the canyon floor.
    b.piers = [0.35, 0.65].map((t) => ({ x: b.ax + (b.bx - b.ax) * t, z: b.az + (b.bz - b.az) * t }));
    for (const p of b.piers) {
      const py = rawTerrainHeight(p.x, p.z);
      pushSite({ type: { name: 'Опора', id: 'pier', colliders: [{ k: 'box', x: 0, z: 0, w: b.w * 0.8, d: 2.4, h: lo - py - 1.5 }] },
        x: p.x, z: p.z, y: py, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), r: 0, R: 10, hidden: true });
    }
  }
}
function pushSite(lm) {
  lmList.push(lm);
  for (let i = Math.floor((lm.x - lm.R) / LM_CELL); i <= Math.floor((lm.x + lm.R) / LM_CELL); i++) {
    for (let j = Math.floor((lm.z - lm.R) / LM_CELL); j <= Math.floor((lm.z + lm.R) / LM_CELL); j++) {
      const key = lmKey(i, j);
      if (!lmGrid.has(key)) lmGrid.set(key, []);
      lmGrid.get(key).push(lm);
    }
  }
}

function initLandmarks() {
  lmList = [];
  lmGrid = new Map();
  for (const b of BASES) addSolidSite({ name: `База ${b.name}`, id: 'base', colliders: baseSolids(b.layout) }, b.x, b.z, b.yaw, BASE_SITE_R);
  for (const [x, z] of BRIDGE_SEEDS) planBridge(x, z);
  bridgeSites();
  if (PLANET === 'verdanta') addSolidSite(LAB_SOLIDS, LAB.x, LAB.z);
  if (PLANET === 'mars') placeSettlement();
  const types = LANDMARK_TYPES[PLANET] || [];
  if (!types.length) return;
  let seed = PLANET === 'moon' ? 7331 : PLANET === 'verdanta' ? 4242 : 9001;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const totalW = types.reduce((n, t) => n + t.weight, 0);
  const pickType = () => {
    let r = rand() * totalW;
    for (const t of types) if ((r -= t.weight) < 0) return t;
    return types[types.length - 1];
  };
  const PAD = 650;
  const cands = [];
  for (let z = ROUTE_BOUNDS.z0 - PAD; z <= ROUTE_BOUNDS.z1 + PAD; z += 95) {
    for (let x = ROUTE_BOUNDS.x0 - PAD; x <= ROUTE_BOUNDS.x1 + PAD; x += 95) {
      cands.push({ x: x + (rand() - 0.5) * 60, z: z + (rand() - 0.5) * 60, o: rand() });
    }
  }
  cands.sort((a, b) => a.o - b.o);
  const TARGET = 42 + lmList.length; // the base sites are already in the list
  const SEP = 320;
  for (const c of cands) {
    if (lmList.length >= TARGET) break;
    // Off the road and its shoulders (mission crates and мотлох lie in that band),
    // clear of both bases.
    if (roadDist(c.x, c.z) < 230) continue;
    if (BASES.some((b) => Math.hypot(c.x - b.x, c.z - b.z) < 360)) continue;
    if (BRIDGES.some((b) => Math.hypot(c.x - (b.ax + b.bx) / 2, c.z - (b.az + b.bz) / 2) < b.len / 2 + 120)) continue;
    if (lmList.some((l) => !l.hidden && Math.hypot(c.x - l.x, c.z - l.z) < Math.max(SEP, l.R + 60))) continue;
    const type = pickType();
    // Fairly level ground, and no river underfoot.
    let lo = Infinity, hi = -Infinity, sum = 0, wet = false;
    for (let k = 0; k < 9; k++) {
      const a = (k / 8) * Math.PI * 2;
      const rr = k === 8 ? 0 : type.r;
      const px = c.x + Math.cos(a) * rr;
      const pz = c.z + Math.sin(a) * rr;
      const h = rawTerrainHeight(px, pz);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
      sum += h;
      if (riverDepthAt(px, pz) > 0) wet = true;
    }
    if (wet || hi - lo > type.r * 0.32) continue;
    const yaw = rand() * Math.PI * 2;
    const lm = {
      type, x: c.x, z: c.z, y: sum / 9, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw),
      r: type.r, R: type.r * 1.7 + 12,
    };
    lmList.push(lm);
    const i0 = Math.floor((lm.x - lm.R) / LM_CELL);
    const i1 = Math.floor((lm.x + lm.R) / LM_CELL);
    const j0 = Math.floor((lm.z - lm.R) / LM_CELL);
    const j1 = Math.floor((lm.z + lm.R) / LM_CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = lmKey(i, j);
        if (!lmGrid.has(key)) lmGrid.set(key, []);
        lmGrid.get(key).push(lm);
      }
    }
  }
}

// The bases' own buildings (base.js) and Верданта's lab (seeds.js) are solid too —
// they used to be drive-through. They join the same grid, but level no ground
// (their pads are flattened already) and draw nothing here.
// Their shapes come from base-layout.js and reach well past the main pad, so a base
// site reaches farther than the lab's.
const BASE_SITE_R = 70;
const LAB_SOLIDS = {
  name: 'Лабораторія', id: 'lab', colliders: [
    { k: 'cyl', x: -5, z: 0, r: 3.9, h: 6.5 },
    { k: 'box', x: 7, z: 2, w: 6.2, d: 9.2, h: 3.2 },
    { k: 'cyl', x: 2, z: -6, r: 0.25, h: 12 },
  ],
};
function addSolidSite(type, x, z, yaw = 0, R = 45) {
  const lm = { type, x, z, y: rawTerrainHeight(x, z), yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), r: 0, R, hidden: true };
  lmList.push(lm);
  for (let i = Math.floor((x - lm.R) / LM_CELL); i <= Math.floor((x + lm.R) / LM_CELL); i++) {
    for (let j = Math.floor((z - lm.R) / LM_CELL); j <= Math.floor((z + lm.R) / LM_CELL); j++) {
      const key = lmKey(i, j);
      if (!lmGrid.has(key)) lmGrid.set(key, []);
      lmGrid.get(key).push(lm);
    }
  }
}

// Mars's town, «Обрій» (layout in landmark-types.js): beside the road about halfway
// along, on whichever side the ground is calmer, its main street turned to face
// the road. It is a landmark like any other to the rest of the code, just a big one.
function placeSettlement() {
  const L = settlementLayout();
  const k = Math.floor(ROUTE_PTS.length * 0.42);
  const a = ROUTE_PTS[k];
  const b = ROUTE_PTS[Math.min(k + 4, ROUTE_PTS.length - 1)];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const nx = -(b.z - a.z) / len;
  const nz = (b.x - a.x) / len;
  let best = null;
  for (const side of [1, -1]) {
    const x = a.x + nx * side * 340;
    const z = a.z + nz * side * 340;
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (let i = 0; i < 13; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const rr = i === 12 ? 0 : SETTLEMENT_R;
      const h = rawTerrainHeight(x + Math.cos(ang) * rr, z + Math.sin(ang) * rr);
      lo = Math.min(lo, h); hi = Math.max(hi, h); sum += h;
    }
    if (!best || hi - lo < best.spread) best = { x, z, side, spread: hi - lo, y: sum / 13 };
  }
  // Local +z (the main street) runs toward the road.
  const yaw = Math.atan2(-nx * best.side, -nz * best.side);
  const lm = {
    type: { id: 'settlement', name: 'Поселення «Обрій»', r: SETTLEMENT_R, colliders: L.solids },
    layout: L, x: best.x, z: best.z, y: best.y, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw),
    r: SETTLEMENT_R, R: SETTLEMENT_R * 1.25 + 24,
  };
  lmList.push(lm);
  for (let i = Math.floor((lm.x - lm.R) / LM_CELL); i <= Math.floor((lm.x + lm.R) / LM_CELL); i++) {
    for (let j = Math.floor((lm.z - lm.R) / LM_CELL); j <= Math.floor((lm.z + lm.R) / LM_CELL); j++) {
      const key = lmKey(i, j);
      if (!lmGrid.has(key)) lmGrid.set(key, []);
      lmGrid.get(key).push(lm);
    }
  }
}

// How worn the ground is by the town's traffic at (x, z), 0..1: the two streets and
// the plaza, with soft, noisy edges so they read as trodden dirt, not a laid surface.
var townLm;
function townWear(x, z) {
  if (!lmArmed) return 0;
  if (townLm === undefined) townLm = getSettlement();
  if (!townLm) return 0;
  const dx = x - townLm.x;
  const dz = z - townLm.z;
  if (dx * dx + dz * dz > 120 * 120) return 0;
  const lx = Math.abs(dx * townLm.cos - dz * townLm.sin);
  const lz = Math.abs(dx * townLm.sin + dz * townLm.cos);
  const ragged = (fbm(x * 0.12 + 31, z * 0.12 - 7, 2) - 0.5) * 3;
  const main = (1 - smooth(2 + ragged, 7.5 + ragged, lx)) * (1 - smooth(84, 98, lz));
  const cross = (1 - smooth(2 + ragged, 7 + ragged, lz)) * (1 - smooth(84, 98, lx));
  const plaza = 1 - smooth(9 + ragged, 20 + ragged, Math.hypot(lx, lz));
  const w = Math.max(main, cross, plaza);
  return w * (0.55 + 0.25 * fbm(x * 0.05 + 3, z * 0.05 + 9, 2));
}

// The town, if this planet has one (null otherwise).
export function getSettlement() {
  if (!lmGrid) initLandmarks();
  return lmList.find((l) => l.type.id === 'settlement') || null;
}

const LM_NONE = [];
function lmAt(x, z) {
  if (!lmGrid) initLandmarks();
  return lmGrid.get(lmKey(Math.floor(x / LM_CELL), Math.floor(z / LM_CELL))) || LM_NONE;
}

// Every landmark on this planet, for landmarks.js to draw (not the base sites).
export function getLandmarks() {
  if (!lmGrid) initLandmarks();
  return lmList.filter((l) => !l.hidden);
}

// True when (x, z) is within `pad` metres of a landmark's levelled ground — used to
// keep rocks and pickups off building sites.
export function nearLandmark(x, z, pad = 0) {
  if (!lmArmed) return false;
  for (const lm of lmAt(x, z)) if (!lm.hidden && Math.hypot(x - lm.x, z - lm.z) < lm.r + pad) return true;
  return false;
}

// Solid walls. Buildings are not part of the ground: driven into, a ground bump
// gets climbed (the hull is pushed up its slope), which put rovers on rooftops.
// Instead physics asks whether a hull point is inside a landmark's shapes and, if
// so, gets the way out — horizontal, so a wall stops the rover rather than lifting
// it. `out` receives the push-out normal {x, z}; returns the depth, 0 if outside.
export function landmarkWall(px, py, pz, out) {
  if (!lmArmed) return 0;
  let best = moving.length ? movingWall(px, py, pz, out, 0) : 0;
  for (const lm of lmAt(px, pz)) {
    const dx = px - lm.x;
    const dz = pz - lm.z;
    if (dx * dx + dz * dz > lm.R * lm.R) continue;
    const ly = py - lm.y;
    if (ly < -1) continue;
    // World -> landmark frame (inverse of three.js rotation.y = yaw).
    const lx = dx * lm.cos - dz * lm.sin;
    const lz = dx * lm.sin + dz * lm.cos;
    for (const c of lm.type.colliders) {
      const ux = lx - c.x;
      const uz = lz - c.z;
      let depth = 0;
      let nx = 0;
      let nz = 0;
      if (c.k === 'box') {
        if (ly > c.h) continue;
        const ex = c.w / 2 - Math.abs(ux);
        const ez = c.d / 2 - Math.abs(uz);
        if (ex <= 0 || ez <= 0) continue;
        if (ex < ez) { depth = ex; nx = Math.sign(ux) || 1; } else { depth = ez; nz = Math.sign(uz) || 1; }
      } else if (c.k === 'seg') {
        // A corridor lying along the ground: a round tube from (x, z) to (x2, z2),
        // pushed out sideways from its axis.
        if (ly > c.h) continue;
        const sx = c.x2 - c.x;
        const sz = c.z2 - c.z;
        const t = clamp((ux * sx + uz * sz) / (sx * sx + sz * sz), 0, 1);
        const qx = ux - sx * t;
        const qz = uz - sz * t;
        const d = Math.hypot(qx, qz);
        if (d >= c.r) continue;
        depth = c.r - d;
        if (d < 1e-6) { nx = -sz; nz = sx; const l = Math.hypot(nx, nz); nx /= l; nz /= l; } else { nx = qx / d; nz = qz / d; }
      } else {
        const d = Math.hypot(ux, uz);
        if (c.k === 'ring') {
          if (ly > c.h) continue;
          const off = d - c.r;
          depth = c.w / 2 - Math.abs(off);
          if (depth <= 0 || d < 1e-6) continue;
          const sg = off >= 0 ? 1 : -1;
          nx = (ux / d) * sg;
          nz = (uz / d) * sg;
        } else {
          if (d >= c.r) continue;
          // A dome's wall is only as tall as its curve at that radius.
          const top = c.k === 'dome' ? c.h * Math.sqrt(1 - (d * d) / (c.r * c.r)) : c.h;
          if (ly > top) continue;
          depth = c.r - d;
          if (d < 1e-6) { nx = 1; } else { nx = ux / d; nz = uz / d; }
        }
      }
      if (depth > best) {
        best = depth;
        // Landmark frame -> world.
        out.x = nx * lm.cos + nz * lm.sin;
        out.z = -nx * lm.sin + nz * lm.cos;
      }
    }
  }
  return best;
}

// Things that move — the NPC rovers (npc.js) — as upright boxes {x, z, y, yaw, w,
// d, h}, refreshed each frame by their owner and tested by landmarkWall too.
let moving = [];
export function setMovingSolids(list) {
  moving = list;
}
function movingWall(px, py, pz, out, best) {
  for (const m of moving) {
    const dx = px - m.x;
    const dz = pz - m.z;
    if (dx * dx + dz * dz > 64) continue;
    if (py < m.y - 0.5 || py > m.y + m.h) continue;
    const c = Math.cos(m.yaw);
    const s = Math.sin(m.yaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const ex = m.w / 2 - Math.abs(lx);
    const ez = m.d / 2 - Math.abs(lz);
    if (ex <= 0 || ez <= 0) continue;
    let nx = 0;
    let nz = 0;
    let depth;
    if (ex < ez) { depth = ex; nx = Math.sign(lx) || 1; } else { depth = ez; nz = Math.sign(lz) || 1; }
    if (depth > best) {
      best = depth;
      out.x = nx * c + nz * s;
      out.z = -nx * s + nz * c;
    }
  }
  return best;
}

// Thin upright solids (masts, legs) near (x, z), in world space: hull points sit too
// far apart to catch one, so physics tests these against the rover's box instead.
const POLE_R = 1.4;
export function landmarkPoles(x, z, out) {
  out.length = 0;
  if (!lmArmed) return out;
  for (const lm of lmAt(x, z)) {
    if (Math.hypot(x - lm.x, z - lm.z) > lm.R + 10) continue;
    for (const c of lm.type.colliders) {
      if (c.k !== 'cyl' || c.r > POLE_R) continue;
      out.push({ x: lm.x + c.x * lm.cos + c.z * lm.sin, z: lm.z - c.x * lm.sin + c.z * lm.cos, r: c.r, y0: lm.y, y1: lm.y + c.h });
    }
  }
  return out;
}

export function terrainHeight(x, z) {
  let h = rawTerrainHeight(x, z);
  if (!lmArmed) return h;
  // Each landmark levels a pad of ground to its own height and blends back out.
  for (const lm of lmAt(x, z)) {
    if (lm.hidden) continue;
    const d = Math.hypot(x - lm.x, z - lm.z);
    if (d < lm.R) h = lm.y + (h - lm.y) * smooth(lm.r * 0.9, lm.R, d);
  }
  return h;
}

// How deep the soft dust lies at a spot, 0..1: the bright patches of the orbiter photo,
// off the graded road. A rover rolls harder through it and grips a little less. Zero
// everywhere except real Mars, so the other worlds drive exactly as before.
export function dustDepth(x, z) {
  if (!REAL) return 0;
  return smooth(ROAD_HALF + 14, ROAD_HALF + 170, roadDist(x, z)) * smooth(0.5, 0.85, REAL.albedo(x, z));
}

// How thickly loose pebbles lie at a spot, 0..1. Gravel comes in patches a few
// hundred metres across with clear ground between them, and each patch is itself
// uneven, so the amount changes as you drive instead of being spread evenly.
export function pebbleDensity(x, z) {
  const patch = smooth(0.32, 0.64, fbm(x * 0.0065 + 710, z * 0.0065 - 330, 2));
  const grain = 0.55 + 1.2 * fbm(x * 0.045 + 40, z * 0.045 + 9, 2);
  return clamp(0.16 + 0.84 * patch * Math.min(1, grain), 0, 1);
}

// ---------- rocks: one hash, used by both the physics and the visuals ----------

const STONE_CELL = 13;
export const stone = { x: 0, z: 0, r: 0, h: 0, big: false };

// Returns false when the cell is empty. Fills the shared `stone` record otherwise.
function stoneInCell(ci, cj) {
  const a = hash(ci * 1.37 + 5.1, cj * 2.11 + 9.7);
  const x = (ci + 0.15 + 0.7 * hash(ci + 31, cj + 17)) * STONE_CELL;
  const z = (cj + 0.15 + 0.7 * hash(ci + 7, cj + 53)) * STONE_CELL;
  // Rocks clump into fields, leaving clear lanes between them.
  // Sparse and small on the road, dense with big boulders off it.
  const rough = smooth(ROAD_HALF + 14, ROAD_HALF + 170, roadDist(x, z));
  let density = Math.min(0.95, (0.12 + 0.72 * smooth(0.42, 0.62, fbm(x * 0.0055 + 300, z * 0.0055 - 60, 2))) * (0.22 + 1.5 * rough));
  // Real Mars: rubble gathers on slopes (crater rims, the delta's scarp) and where the
  // orbiter photo is dark; bright dust-covered flats are nearly clear.
  if (REAL) {
    const sx = REAL.height(x + 20, z) - REAL.height(x - 20, z);
    const sz = REAL.height(x, z + 20) - REAL.height(x, z - 20);
    const slope = Math.hypot(sx, sz) / 40;
    density = Math.min(0.95, density * (0.4 + 1.1 * (1 - REAL.albedo(x, z))) * (0.7 + 4 * slope));
  }
  if (a > density) return false;
  if (baseFlatten(x, z) < 0.999) return false;
  if (nearLandmark(x, z, 4)) return false;
  const b = hash(ci + 91, cj + 3);
  // The graded road is kept clear of boulders: a lane a truck can follow without a
  // rescue. Small stones stay; they are what makes the road feel like a road.
  const big = b > 0.97 - 0.13 * rough && (!REAL || roadDist(x, z) > 9);
  const r = big ? 1.3 + b * 2.2 : 0.35 + b * 1.15;
  stone.x = x;
  stone.z = z;
  stone.r = r;
  stone.h = big ? r * (0.75 + 0.35 * hash(ci + 2, cj + 44)) : Math.min(0.62, r * (0.3 + 0.3 * hash(ci + 2, cj + 44)));
  stone.big = big;
  return true;
}

// Rocks tall enough to actually block the rover (see src/sonar.js), within `radius`
// of (x,z). Same cell-hash scan `groundHeight`/the near-shadow rocks use — cheap
// enough to run every sonar tick. `out` is reused across calls, no per-scan alloc.
export function findObstacles(x, z, radius, minH, out = []) {
  out.length = 0;
  const ci0 = Math.floor((x - radius) / STONE_CELL);
  const cj0 = Math.floor((z - radius) / STONE_CELL);
  const span = Math.ceil((2 * radius) / STONE_CELL) + 2;
  const r2 = radius * radius;
  for (let dj = 0; dj < span; dj++) {
    for (let di = 0; di < span; di++) {
      if (!stoneInCell(ci0 + di, cj0 + dj)) continue;
      if (stone.h < minH) continue;
      const dx = stone.x - x;
      const dz = stone.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      out.push({ x: stone.x, z: stone.z, r: stone.r, h: stone.h, d: Math.sqrt(d2) });
    }
  }
  return out;
}

// Physics asks for the ground ~100 times a substep, 240 substeps a second, and each
// ask used to re-derive the nine surrounding stone cells from scratch — road
// distance, density noise, base flattening — which cost as much as the terrain noise
// itself. A cell's stone never changes, so it is resolved once and remembered, along
// with the terrain height under its centre. Exactly the same result, a fraction of
// the work. The cache is dropped whole when it grows past twenty thousand cells.
const stoneCache = new Map();
const NO_STONE = null;
function cachedStone(ci, cj) {
  const key = ci * 131072 + cj;
  let s = stoneCache.get(key);
  if (s === undefined) {
    if (stoneCache.size > 20000) stoneCache.clear();
    s = stoneInCell(ci, cj)
      ? {
        x: stone.x, z: stone.z, r: stone.r, h: stone.h, big: stone.big,
        r2: stone.r * stone.r, top: stone.h * 0.95, base: terrainHeight(stone.x, stone.z),
      }
      : NO_STONE;
    stoneCache.set(key, s);
  }
  return s;
}

// Terrain plus any rock the wheel is standing on.
export function groundHeight(x, z) {
  let h = terrainHeight(x, z);
  if (BRIDGES.length) {
    const d = deckHeight(x, z);
    if (d > h && deckRef > d - 2.5) h = d;
  }
  const ci = Math.floor(x / STONE_CELL);
  const cj = Math.floor(z / STONE_CELL);
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const s = cachedStone(ci + di, cj + dj);
      if (!s) continue;
      const dx = x - s.x;
      const dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= s.r2) continue;
      const top = s.base + s.top * Math.pow(1 - d2 / s.r2, 0.55);
      if (top > h) h = top;
    }
  }
  return h;
}

// Height of the *rendered* surface, which is a coarse triangulation of terrainHeight.
// Anything laid on the ground (tyre tracks) has to follow this, not the analytic
// height, or it sinks below the mesh between vertices.
export function surfaceHeight(x, z) {
  const g = surfaceHeight0(x, z);
  if (BRIDGES.length) {
    const d = deckHeight(x, z);
    if (d > g && deckRef > d - 2.5) return d;
  }
  return g;
}
function surfaceHeight0(x, z) {
  const s = 220 / 48;
  const i = Math.floor(x / s);
  const j = Math.floor(z / s);
  const fx = x / s - i;
  const fz = z / s - j;
  const h00 = terrainHeight(i * s, j * s);
  const h10 = terrainHeight((i + 1) * s, j * s);
  const h01 = terrainHeight(i * s, (j + 1) * s);
  const h11 = terrainHeight((i + 1) * s, (j + 1) * s);
  // PlaneGeometry splits every cell into two triangles across the anti-diagonal, so
  // interpolate over the matching triangle. Averaging the cell bilinearly instead
  // put the surface up to 8 cm off, and anything laid on the ground sank through it.
  return fx + fz <= 1
    ? h00 * (1 - fx - fz) + h01 * fz + h10 * fx
    : h11 * (fx + fz - 1) + h01 * (1 - fx) + h10 * (1 - fz);
}

// ---------- streamed visuals ----------

const TILE = 220;
const GRID = 21; // tiles across, centred on the rover
const SEG = 48; // uniform, so a tile keeps its geometry as the window scrolls
// Rocks this close always cast a real shadow (see the dedicated `nearRocks` mesh in
// createTerrain — InstancedMesh.castShadow is one flag for the whole batch, so the
// old approach of toggling it per streamed 220 m tile made two rocks a few metres
// apart disagree about shadows whenever they landed in different tiles).
const NEAR_SHADOW_REACH = 200;
const BEAM_REACH = 300; // and rocks this far along the long-range spotlight
const BEAM_HALF_WIDTH = 45;
const ROCK_DIST_BASE = 774; // rocks are drawn this far out; fog hides the rest
let ROCK_DIST = ROCK_DIST_BASE;
export function setViewScale(k) {
  ROCK_DIST = ROCK_DIST_BASE * k;
}
export const MESH_STEP = 220 / 48; // TILE / SEG, the spacing of terrain vertices
const TEX_METERS = 26; // one texture tile covers this many metres of ground

// Close-up surface detail: a tileable height (R) + albedo (G) map, generated per
// planet — pebbles and hairline cracks on Mars, micro-craters on the Moon, soil clumps
// on Верданта. It is laid in world space under the rover and faded out by ~70 m, so it
// adds relief where you actually look (next to the wheels) and never tiles visibly far off.
// Scanned ground (Poly Haven, CC0) for the close-up detail layer, packed the same way
// as makeDetailTexture — R height, G albedo around 0.5 — so the shader is unchanged.
// Only the luminance of the photo is used: the planet's own colours stay in the
// vertex colours. Swapped in once both images arrive; the procedural one shows
// until then (and for good, if they never do).
const SCAN = {
  mars: 'red_laterite_soil_stones',
  moon: 'moon_dusted_02',
  verdanta: 'forest_ground_04',
}[PLANET];
const texUrl = (name) => new URL(`../textures/${name}`, import.meta.url).href;
function loadImage(url) {
  return new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = fail;
    im.src = url;
  });
}
function pixels(im, N) {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(im, 0, 0, N, N);
  return x.getImageData(0, 0, N, N).data;
}
async function loadScanDetail(anisotropy) {
  if (!SCAN) return null;
  const [diff, disp] = await Promise.all([loadImage(texUrl(`${SCAN}_diff.jpg`)), loadImage(texUrl(`${SCAN}_disp.jpg`))]);
  const N = 1024;
  const a = pixels(diff, N);
  const h = pixels(disp, N);
  let mean = 0;
  const L = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    L[i] = 0.2126 * a[i * 4] + 0.7152 * a[i * 4 + 1] + 0.0722 * a[i * 4 + 2];
    mean += L[i];
  }
  mean /= N * N;
  const px = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    px[i * 4] = h[i * 4];
    px[i * 4 + 1] = Math.max(0, Math.min(255, Math.round((L[i] / mean) * 0.5 * 255)));
    px[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

function makeDetailTexture(anisotropy) {
  const N = 512;
  const H = new Float32Array(N * N);
  const A = new Float32Array(N * N);
  let seed = 90173;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const wrap = (v) => ((v % N) + N) % N;

  // Tileable value noise: a lattice whose period divides N.
  function vnoise(period, amp, albedo = 0) {
    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = rnd() - 0.5;
    const cell = N / period;
    for (let y = 0; y < N; y++) {
      const fy = y / cell;
      const y0 = Math.floor(fy);
      let ty = fy - y0;
      ty = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % period) * period;
      const r1 = ((y0 + 1) % period) * period;
      for (let x = 0; x < N; x++) {
        const fx = x / cell;
        const x0 = Math.floor(fx);
        let tx = fx - x0;
        tx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % period;
        const c1 = (x0 + 1) % period;
        const a = g[r0 + c0] + (g[r0 + c1] - g[r0 + c0]) * tx;
        const b = g[r1 + c0] + (g[r1 + c1] - g[r1 + c0]) * tx;
        const v = a + (b - a) * ty;
        H[y * N + x] += amp * v;
        A[y * N + x] += albedo * v;
      }
    }
  }
  // Round feature of radius r; fn(d in 0..~1.3) returns [dh, da].
  function stamp(cx, cy, r, reach, fn) {
    const R = Math.ceil(r * reach);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > reach) continue;
        const [dh, da] = fn(d);
        const i = wrap(cy + dy) * N + wrap(cx + dx);
        H[i] += dh;
        A[i] += da;
      }
    }
  }
  function crack(len, depth) {
    let x = rnd() * N;
    let y = rnd() * N;
    let a = rnd() * Math.PI * 2;
    for (let k = 0; k < len; k++) {
      a += (rnd() - 0.5) * 0.7;
      x += Math.cos(a);
      y += Math.sin(a);
      const i = wrap(Math.round(y)) * N + wrap(Math.round(x));
      H[i] -= depth;
      A[i] -= depth * 0.9;
    }
  }
  const pebble = (h, shade) => (d) => (d < 1 ? [h * Math.sqrt(1 - d * d), shade * (1 - d * 0.5)] : [0, 0]);

  vnoise(16, 0.35, 0.18);
  vnoise(64, 0.18, 0.1);
  vnoise(256, 0.08, 0.06);
  if (PLANET === 'moon') {
    for (let k = 0; k < 170; k++) {
      const r = 3 + Math.pow(rnd(), 2.5) * 22;
      const depth = 0.35 + rnd() * 0.3;
      stamp(Math.floor(rnd() * N), Math.floor(rnd() * N), r, 1.35, (d) => {
        if (d < 0.85) return [-depth * (1 - (d / 0.85) ** 2), -0.08];
        const rim = 1 - Math.min(1, Math.abs(d - 1) / 0.3);
        return [depth * 0.45 * rim, 0.1 * rim];
      });
    }
    for (let k = 0; k < 500; k++) stamp(Math.floor(rnd() * N), Math.floor(rnd() * N), 1 + rnd() * 3, 1, pebble(0.3, (rnd() - 0.3) * 0.3));
  } else if (PLANET === 'verdanta') {
    for (let k = 0; k < 900; k++) stamp(Math.floor(rnd() * N), Math.floor(rnd() * N), 2 + rnd() * 8, 1, pebble(0.28, -0.12 - rnd() * 0.12));
    for (let k = 0; k < 350; k++) stamp(Math.floor(rnd() * N), Math.floor(rnd() * N), 1 + rnd() * 3, 1, pebble(0.45, (rnd() - 0.4) * 0.35));
  } else {
    for (let k = 0; k < 70; k++) crack(30 + rnd() * 90, 0.28);
    for (let k = 0; k < 1500; k++) {
      const r = 1.2 + Math.pow(rnd(), 2) * 7;
      stamp(Math.floor(rnd() * N), Math.floor(rnd() * N), r, 1, pebble(0.5 * Math.min(1, r / 4), (rnd() - 0.45) * 0.45));
    }
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const v of H) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const px = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    px[i * 4] = Math.round(((H[i] - lo) / (hi - lo)) * 255);
    px[i * 4 + 1] = Math.max(0, Math.min(255, Math.round((0.5 + A[i]) * 255)));
    px[i * 4 + 2] = 0;
    px[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

function makeGroundTexture(anisotropy) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 190 + Math.random() * 65;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Fine grain only. A layer of big, dark blotches used to sit here too, and because
  // this texture doubles as a bump map, each one also faked a shallow dent in the
  // lighting — at a grazing look-out across the plain, dozens of these tiled across
  // the view as soft dark ovals scattered over otherwise flat ground.
  for (const [count, rMin, rMax, alpha] of [[160, 5, 20, 0.028]]) {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${alpha * (0.4 + Math.random())})`;
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = rMin + Math.random() * (rMax - rMin);
      // Draw across the seam too, so the wrap has no visible edge.
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          ctx.beginPath();
          ctx.ellipse(x + ox, y + oy, r, r * (0.6 + Math.random() * 0.8), Math.random() * 3.14, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // UVs are written in world space per vertex, so repeat stays 1:1 here.
  tex.repeat.set(1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

function makeRockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const s = 0.72 + 0.5 * vnoise(x * 1.7 + z * 2.9, y * 2.1 + 7);
    p.setXYZ(i, x * s, y * s, z * s);
  }
  geo.computeVertexNormals();
  return geo;
}

const MARS_PALETTE = {
  dark: 0x8a452b, base: 0xb4633c, dust: 0xd09462, rockCol: 0x5b3326,
  strata: 0xb46f45, pale: 0xd9b189, rust: 0x7d3a22, roadCol: 0xcf9666,
};
// No iron oxide, no dust storms to sort it by grain size — just grey regolith, a bit
// darker in the low "seas", a bit paler where a young crater threw up fresh material.
const MOON_PALETTE = {
  dark: 0x3a3a3d, base: 0x69696c, dust: 0x8c8c88, rockCol: 0x2c2c2e,
  strata: 0x77726c, pale: 0xaaa8a2, rust: 0x55524e, roadCol: 0x8d8d8a,
};
// Black basalt instead of red iron oxide — moss and the river water get painted on
// top in verdantaColorAt below, this is just the bare rock underneath.
const VERDANTA_PALETTE = {
  dark: 0x1c1c1e, base: 0x333335, dust: 0x47474a, rockCol: 0x141416,
  strata: 0x3a4a3a, pale: 0x7c8f82, rust: 0x2f4a30, roadCol: 0x53534f,
};
const P = PLANET === 'moon' ? MOON_PALETTE : PLANET === 'verdanta' ? VERDANTA_PALETTE : MARS_PALETTE;
const dark = new THREE.Color(P.dark);
const base = new THREE.Color(P.base);
const dust = new THREE.Color(P.dust);
const rockCol = new THREE.Color(P.rockCol);
const strata = new THREE.Color(P.strata);
const pale = new THREE.Color(P.pale);
const rust = new THREE.Color(P.rust);
const roadCol = new THREE.Color(P.roadCol);
const trodden = new THREE.Color(P.roadCol).lerp(new THREE.Color(P.pale), 0.45);
const mossCol = new THREE.Color(0x5c7a3f);
const mossLit = new THREE.Color(0x8fab55); // sunlit tops of the thickest cushions
const waterCol = new THREE.Color(0x2a6570);
const _c = new THREE.Color();

// Heights for the tile plus a one-cell margin. computeVertexNormals() only sees the
// triangles inside its own tile, so border normals came out wrong and every tile
// edge showed as a straight dark seam across the plain. Central differences on a
// padded grid depend only on world position, so neighbouring tiles agree exactly.
// Every tile shares the same vertex layout, so the vertex -> padded-grid mapping is
// computed once instead of rounding coordinates for every vertex of every tile.
let padIndex = null;

// Vertex k of a tile's geometry -> its cell in a padded (SEG+3)² height grid, so the
// normal at every vertex can read its four neighbours, border ones included.
function ensurePadIndex(pos, step, P) {
  if (padIndex) return padIndex;
  padIndex = new Int32Array(pos.count);
  for (let k = 0; k < pos.count; k++) {
    const i = Math.round(pos.getX(k) / step);
    const j = Math.round(pos.getZ(k) / step);
    padIndex[k] = (j + 1) * P + (i + 1);
  }
  return padIndex;
}

// The ground's own colour at a point — shared by the terrain mesh's vertex colours
// above and by anything outside that wants to match it, like dust kicked up off it
// (see dust.js), so a puff thrown up over these reddish mountains actually reads
// reddish instead of always the same generic tan.
function groundColorAt(x, z, y, normalY, out) {
  const a = fbm(x * 0.03 + 40, z * 0.03 - 20, 3);
  const m = fbm(x * 0.2, z * 0.2, 2);
  // Very low frequency wash over hundreds of metres, which is what stops the eye
  // from locking onto the texture tiling when looking into the distance.
  const macro = fbm(x * 0.0022 + 900, z * 0.0022 - 400, 3);
  const patch = fbm(x * 0.008 - 210, z * 0.008 + 77, 2);
  out.copy(dark).lerp(base, smooth(0.25, 0.6, a)).lerp(dust, smooth(0.5, 0.85, m) * 0.55);
  out.lerp(pale, smooth(0.46, 0.74, macro) * 0.5).lerp(rust, smooth(0.48, 0.72, patch) * 0.32);
  // Real Mars: the orbiter photo says where the ground is bright dust and where dark.
  if (REAL) out.multiplyScalar(0.55 + 0.9 * REAL.albedo(x, z));
  // The graded road is paler, packed dust; off it the ground is darker and rockier.
  const onRoad = 1 - smooth(ROAD_HALF + 14, ROAD_HALF + 170, roadDist(x, z));
  out.lerp(roadCol, onRoad * 0.6);
  // The town's streets are not paved: just ground packed pale by boots and wheels,
  // ragged at the edges (see townWear).
  const worn = townWear(x, z);
  if (worn > 0) out.lerp(trodden, worn);
  // Widening the mountains' roughness earlier made ordinary rolling ground pick up
  // enough small-scale slope to light this up too, so gentle hillsides across the
  // whole off-road plain were reading as dark rock smudges from a distance. Only
  // genuinely steep faces — mesa walls, crater rims, real cliffs — should tint.
  const steep = smooth(0.24, 0.58, 1 - normalY);
  if (steep > 0) {
    // Sedimentary beds: broad layers with finer banding inside them, keyed to world
    // height, so they run dead level right around a mesa the way real strata do.
    const bed = Math.sin(y * 0.21 + a * 2.2);
    const fine = Math.sin(y * 0.78 + a * 3.5);
    const band = clamp(0.5 + 0.34 * bed + 0.16 * fine, 0, 1);
    out.lerp(rockCol, steep * (0.55 + 0.45 * (1 - band)));
    out.lerp(strata, steep * band * 0.6);
  }
  // Moss creeps up from the river on anything not too steep to hold it; the water
  // itself is painted right over the top, at the centre of the same contour that
  // carved its channel in verdantaHeight.
  if (PLANET === 'verdanta') {
    const river = riverAmount(x, z);
    const moss = mossAmount(x, z, steep);
    out.lerp(mossCol, moss * 0.92);
    // The thickest cushions catch the light and go noticeably yellower. That
    // two-tone green is most of what separates moss from flat green paint, and
    // squaring `moss` keeps the highlight to the deep patches instead of smearing
    // it over every faintly-green pixel.
    out.lerp(mossLit, moss * moss * 0.5);
    out.lerp(waterCol, clamp((river - 0.55) * 2.4, 0, 1));
  }
  return out;
}

// For callers outside the tile builder (no ready-made vertex normal): a cheap central
// difference of the height field itself, same trick the tile builder uses for lighting.
const _gcEps = 0.6;
export function groundColorAtXZ(x, z, out = new THREE.Color()) {
  const y = terrainHeight(x, z);
  const dx = (terrainHeight(x + _gcEps, z) - terrainHeight(x - _gcEps, z)) / (2 * _gcEps);
  const dz = (terrainHeight(x, z + _gcEps) - terrainHeight(x, z - _gcEps)) / (2 * _gcEps);
  const normalY = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
  return groundColorAt(x, z, y, normalY, out);
}

// How thick the moss/grass is at this spot, 0..1 — the exact same recipe
// groundColorAt blends in as colour, exposed standalone so grass.js can place real
// tufts where the ground already reads green, instead of duplicating the noise.
// Always 0 off Верданта.
export function vegetationAmount(x, z) {
  if (PLANET !== 'verdanta') return 0;
  const dx = (terrainHeight(x + _gcEps, z) - terrainHeight(x - _gcEps, z)) / (2 * _gcEps);
  const dz = (terrainHeight(x, z + _gcEps) - terrainHeight(x, z - _gcEps)) / (2 * _gcEps);
  const normalY = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
  return mossAmount(x, z, smooth(0.24, 0.58, 1 - normalY));
}

function tileGeometry(seg) {
  const geo = new THREE.PlaneGeometry(TILE, TILE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(TILE / 2, 0, TILE / 2);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  return geo;
}

// The whole DTM as one coarse mesh (100 m cells), so the rim, the delta and the crater
// floor stand on the horizon far beyond the streamed tiles. Near the rover it is sunk
// out of the way, so the real tiles always win the depth test.
const FAR_STEP = 5;
function createFarMesh() {
  const W = Math.floor((REAL.meta.width - 1) / FAR_STEP) + 1;
  const H = Math.floor((REAL.meta.height - 1) / FAR_STEP) + 1;
  const pos = new Float32Array(W * H * 3);
  const col = new Float32Array(W * H * 3);
  const c = new THREE.Color();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = i * FAR_STEP * REAL.meta.mppX - REAL.halfW;
    const z = j * FAR_STEP * REAL.meta.mppY - REAL.halfH;
    const k = (j * W + i) * 3;
    pos[k] = x; pos[k + 1] = REAL.height(x, z) - REAL.ref; pos[k + 2] = z;
    c.copy(base).lerp(dust, 0.35).multiplyScalar(0.55 + 0.9 * REAL.albedo(x, z));
    col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
  }
  const idx = new Uint32Array((W - 1) * (H - 1) * 6);
  let n = 0;
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = j * W + i;
    idx[n++] = a; idx[n++] = a + W; idx[n++] = a + 1;
    idx[n++] = a + 1; idx[n++] = a + W; idx[n++] = a + W + 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const uniforms = { uRover: { value: new THREE.Vector2() } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRover = uniforms.uRover;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uRover;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y -= 40.0 * (1.0 - smoothstep(1700.0, 2300.0, distance(position.xz, uRover)));`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.uniforms = uniforms;
  return mesh;
}

export function createTerrain(anisotropy = 8) {
  const group = new THREE.Group();
  const farMesh = REAL ? createFarMesh() : null;
  if (farMesh) group.add(farMesh);
  const tex = makeGroundTexture(anisotropy);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: tex, bumpMap: tex, bumpScale: 0.35, roughness: 1, metalness: 0,
  });
  // One texture repeating every few metres reads as an obvious grid from a distance.
  // Mixing a second sample at an incommensurate scale and offset pushes the combined
  // repeat period far beyond what the eye picks up.
  const detail = makeDetailTexture(anisotropy);
  const detailU = { value: detail };
  loadScanDetail(anisotropy).then((t) => { if (t) detailU.value = t; }).catch(() => {});
  const detailAmt = { value: 1 };
  // Rain (weather.js) soaks the ground: 0 dry .. 1 drenched, driven from main.js.
  const wet = { value: 0 };
  // Cloud shadows drifting over the ground (main.js moves `off` with the wind).
  const cloud = { amt: { value: 0 }, off: { value: new THREE.Vector2() } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tDetail = detailU;
    shader.uniforms.detailAmt = detailAmt;
    shader.uniforms.wet = wet;
    shader.uniforms.cloudAmt = cloud.amt;
    shader.uniforms.cloudOff = cloud.off;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailPos;\nvarying vec3 vDetailN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDetailPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvDetailN = normalize( mat3( modelMatrix ) * objectNormal );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vDetailPos;
varying vec3 vDetailN;
uniform sampler2D tDetail;
uniform float detailAmt;
uniform float wet;
uniform float cloudAmt;
uniform vec2 cloudOff;
// Smooth value noise for where rain pools into puddles.
float wetHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wetNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wetHash( i ), wetHash( i + vec2( 1.0, 0.0 ) ), f.x ),
              mix( wetHash( i + vec2( 0.0, 1.0 ) ), wetHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// Triplanar: the same detail laid from above and from both sides, blended by which
// way the ground faces — a flat top-down projection smeared into streaks on slopes.
vec4 triDetail( vec3 p, vec3 w, float scale ) {
  return texture2D( tDetail, p.xz / scale ) * w.y
       + texture2D( tDetail, p.xy / scale + 0.31 ) * w.z
       + texture2D( tDetail, p.zy / scale + 0.67 ) * w.x;
}`)
      .replace(
        '#include <map_fragment>',
        `vec2 detailDH = vec2( 0.0 );
       float wetPuddle = 0.0;
       #ifdef USE_MAP
         // Coarse layer carries the blotches and repeats only every ~26 m; the fine
         // layer is folded in as a brightness modulation so close-up grain stays
         // crisp. Averaging the two would just wash the contrast out to flat mud.
         vec3 coarse = texture2D( map, vMapUv ).rgb;
         float fine = texture2D( map, vMapUv * 8.37 + vec2( 0.21, 0.63 ) ).g;
         float grain = texture2D( map, vMapUv * 31.7 + vec2( 0.55, 0.11 ) ).r;
         diffuseColor.rgb *= coarse * ( 0.72 + 0.34 * fine ) * ( 0.88 + 0.16 * grain );
       #endif
         // Close-up detail (makeDetailTexture): two rotated world-space scales so it
         // never lines up into a grid, fading out by ~70 m.
         float dNear = detailAmt * ( 1.0 - smoothstep( 30.0, 120.0, length( vViewPosition ) ) );
         if ( dNear > 0.0 ) {
           vec3 tw = pow( abs( normalize( vDetailN ) ), vec3( 4.0 ) );
           tw /= ( tw.x + tw.y + tw.z );
           vec4 d1 = triDetail( vDetailPos, tw, 5.0 );
           vec4 d2 = triDetail( vDetailPos * mat3( 0.8, 0.0, -0.6, 0.0, 1.0, 0.0, 0.6, 0.0, 0.8 ) + 0.37, tw, 1.6 );
           float h = d1.r * 0.6 + d2.r * 0.4;
           float albedo = max( 0.1, ( 0.2 + 1.6 * d1.g ) * ( 0.62 + 0.76 * d2.g ) );
           diffuseColor.rgb *= mix( 1.0, albedo, min( dNear, 1.0 ) );
           detailDH = vec2( dFdx( h ), dFdy( h ) ) * 0.64 * dNear;
         }
         if ( cloudAmt > 0.0 ) {
           vec2 cp = vDetailPos.xz / 240.0 + cloudOff;
           float cn = wetNoise( cp ) * 0.6 + wetNoise( cp * 2.3 + 5.1 ) * 0.28 + wetNoise( cp * 5.7 + 1.3 ) * 0.12;
           diffuseColor.rgb *= 1.0 - cloudAmt * smoothstep( 0.52, 0.7, cn );
         }
         // Soaked: the whole ground darkens, and on flat patches water pools into
         // puddles — darker still, glassy, their bumps smoothed away.
         if ( wet > 0.0 ) {
           float flatG = smoothstep( 0.93, 0.99, normalize( vDetailN ).y );
           float pm = wetNoise( vDetailPos.xz / 9.0 ) * 0.7 + wetNoise( vDetailPos.xz / 2.7 + 7.3 ) * 0.3;
           wetPuddle = smoothstep( 0.63, 0.69, pm ) * flatG * smoothstep( 0.35, 1.0, wet );
           diffuseColor.rgb *= mix( 1.0, 0.72, wet );
           diffuseColor.rgb *= mix( 1.0, 0.55, wetPuddle );
         }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', '( ( dHdxy_fwd() + detailDH ) * ( 1.0 - wetPuddle ) )')
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = mix( roughnessFactor, 0.5, wet * 0.6 );
         roughnessFactor = mix( roughnessFactor, 0.05, wetPuddle );`
      );
  };
  const rockGeo = makeRockGeometry();
  const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true, vertexColors: true });
  // Scanned rock surface (Poly Haven, CC0) laid on triplanar in world space: its
  // luminance modulates each rock's own colour and doubles as a bump height, so the
  // facets read as weathered stone instead of flat plastic.
  const rockTex = { value: null };
  loadImage(texUrl('rock_boulder_dry_diff.jpg')).then((im) => {
    const t = new THREE.Texture(im);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    rockTex.value = t;
    rockMat.needsUpdate = true;
  }).catch(() => {});
  rockMat.bumpMap = new THREE.Texture(); // switches on the bump path; replaced below
  rockMat.customProgramCacheKey = () => (rockTex.value ? 'rock-scan' : 'rock');
  rockMat.onBeforeCompile = (shader) => {
    if (!rockTex.value) return;
    shader.uniforms.tRock = rockTex;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;\nvarying vec3 vRockN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vRockPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
          vRockN = normalize( mat3( modelMatrix * instanceMatrix ) * objectNormal );
        #else
          vRockPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
          vRockN = normalize( mat3( modelMatrix ) * objectNormal );
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRockPos;
varying vec3 vRockN;
uniform sampler2D tRock;
float rockLum( vec3 p, vec3 w ) {
  vec3 c = texture2D( tRock, p.xz ).rgb * w.y + texture2D( tRock, p.xy ).rgb * w.z + texture2D( tRock, p.zy ).rgb * w.x;
  return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 rw = pow( abs( normalize( vRockN ) ), vec3( 4.0 ) );
        rw /= ( rw.x + rw.y + rw.z );
        float rl = rockLum( vRockPos / 1.4, rw );
        diffuseColor.rgb *= 0.45 + 1.3 * rl;`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('dHdxy_fwd()', 'vec2( dFdx( rl ), dFdy( rl ) ) * 1.6'));
  };
  const ROCKS_PER_TILE = Math.ceil(TILE / STONE_CELL + 2) ** 2;

  // A small, always-shadow-casting set of rocks confined to a disc around the rover
  // (the same "rebuild every frame within a radius" trick src/sand.js uses), instead
  // of the big per-tile batches ever casting a near shadow. colorWrite/depthWrite are
  // off, so it draws nothing into the beauty pass — its only effect is the shadow it
  // casts — and so it can't double-render or z-fight the same rocks the visible tile
  // mesh already draws.
  const nearRockMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const NEAR_ROCKS_MAX = Math.ceil((2 * NEAR_SHADOW_REACH) / STONE_CELL + 2) ** 2;
  const nearRocks = new THREE.InstancedMesh(rockGeo, nearRockMat, NEAR_ROCKS_MAX);
  nearRocks.castShadow = true;
  nearRocks.receiveShadow = false;
  nearRocks.frustumCulled = false;
  nearRocks.count = 0;
  group.add(nearRocks);

  const half = (GRID - 1) / 2;
  const tiles = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const m = new THREE.Mesh(tileGeometry(SEG), mat);
      m.receiveShadow = true;
      // Hills throw shadows now that the cascaded sun (sunshadow.js) reaches past the
      // rover's own neighbourhood — long ones across the dunes at dawn and dusk.
      m.castShadow = true;
      m.matrixAutoUpdate = false;
      group.add(m);
      const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS_PER_TILE);
      rocks.castShadow = false;
      rocks.receiveShadow = true;
      rocks.frustumCulled = false;
      rocks.count = 0;
      group.add(rocks);
      tiles.push({ i, j, mesh: m, rocks, ti: null, tj: null });
    }
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const posV = new THREE.Vector3();
  const axisY = new THREE.Vector3(0, 1, 0);

  // Writes stone record `s` (from cachedStone) into instance slot n. Shared by the per-tile fill below and the
  // near-field shadow fill, so both draw the exact same rock the exact same way.
  function writeRockInstance(im, n, ci, cj, s) {
    q.setFromAxisAngle(axisY, hash(ci + 5, cj + 9) * Math.PI * 2);
    posV.set(s.x, s.base, s.z);
    scl.set(s.r, s.h, s.r);
    m4.compose(posV, q, scl);
    im.setMatrixAt(n, m4);
    // Верданта's boulders were nearly black, and against its bright moss that read
    // as holes punched in the ground rather than as rock. Basalt is dark, but not
    // that dark next to green — lifting the lightness and pulling the hue towards
    // the ground's own grey-green is what makes them sit in the landscape.
    const lo = PLANET === 'verdanta' ? 0.3 : 0.2;
    const span = PLANET === 'verdanta' ? 0.22 : 0.18;
    const shade = lo + span * hash(ci + 77, cj + 12);
    const sat = PLANET === 'moon' ? 0.03 : PLANET === 'verdanta' ? 0.05 : 0.38;
    const hue = PLANET === 'verdanta' ? 0.28 : 0.045;
    _c.setHSL(hue + 0.03 * hash(ci, cj + 3), sat, s.big ? shade * 0.85 : shade);
    im.setColorAt(n, _c);
  }

  function fillRocks(tile, ox, oz) {
    const im = tile.rocks;
    const ci0 = Math.floor(ox / STONE_CELL);
    const cj0 = Math.floor(oz / STONE_CELL);
    const span = Math.ceil(TILE / STONE_CELL) + 1;
    let n = 0;
    for (let dj = 0; dj < span && n < im.instanceMatrix.count; dj++) {
      for (let di = 0; di < span && n < im.instanceMatrix.count; di++) {
        const ci = ci0 + di;
        const cj = cj0 + dj;
        const st = cachedStone(ci, cj);
        if (!st) continue;
        writeRockInstance(im, n, ci, cj, st);
        n++;
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  // Every rock within NEAR_SHADOW_REACH of the rover, regardless of which streamed
  // tile it happens to belong to — this is what actually gives each rock its own
  // shadow verdict instead of inheriting its tile's.
  function fillNearRocks(x, z) {
    const ci0 = Math.floor((x - NEAR_SHADOW_REACH) / STONE_CELL);
    const cj0 = Math.floor((z - NEAR_SHADOW_REACH) / STONE_CELL);
    const span = Math.ceil((2 * NEAR_SHADOW_REACH) / STONE_CELL) + 2;
    const r2 = NEAR_SHADOW_REACH * NEAR_SHADOW_REACH;
    let n = 0;
    for (let dj = 0; dj < span && n < nearRocks.instanceMatrix.count; dj++) {
      for (let di = 0; di < span && n < nearRocks.instanceMatrix.count; di++) {
        const ci = ci0 + di;
        const cj = cj0 + dj;
        const st = cachedStone(ci, cj);
        if (!st) continue;
        const dx = st.x - x;
        const dz = st.z - z;
        if (dx * dx + dz * dz > r2) continue;
        writeRockInstance(nearRocks, n, ci, cj, st);
        n++;
      }
    }
    nearRocks.count = n;
    nearRocks.instanceMatrix.needsUpdate = true;
  }

  // Slot i holds whichever world tile in the window satisfies index % GRID === i, so
  // scrolling the window by one recycles a single row instead of all 49 tiles.
  function slotWorld(centre, slot) {
    let t = Math.floor((centre - half - slot) / GRID) * GRID + slot;
    if (t < centre - half) t += GRID;
    return t;
  }

  const queue = [];
  let centerI = NaN;
  let centerJ = NaN;

  // Building a tile takes 20–40 ms (2 600 terrain samples, then four noise layers of
  // colour per vertex, then its rocks), and crossing a tile border re-slots a whole
  // row of 21. Built a few whole tiles a frame, that was a half-second freeze every
  // 220 m. Now one tile at a time is built in slices — a row of heights, then a row
  // of colours — against a per-frame time budget, and only written into its
  // geometry once complete. Same result as building it in one go, spread thin.
  const NB = SEG + 1;
  const PB = NB + 2;
  const STEP = TILE / SEG;
  const INV2 = 1 / (2 * STEP);
  const jobH = new Float32Array(PB * PB);
  const jobC = new Float32Array(NB * NB * 3);
  let job = null;

  function commitJob() {
    const { t, ox, oz } = job;
    const geo = t.mesh.geometry;
    const pos = geo.attributes.position;
    const idx = ensurePadIndex(pos, STEP, PB);
    const posArr = pos.array;
    const nrmArr = geo.attributes.normal.array;
    const col = geo.attributes.color;
    const uv = geo.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      const p = idx[k];
      posArr[k * 3 + 1] = jobH[p];
      const dx = (jobH[p + 1] - jobH[p - 1]) * INV2;
      const dz = (jobH[p + PB] - jobH[p - PB]) * INV2;
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      nrmArr[k * 3] = -dx * inv;
      nrmArr[k * 3 + 1] = inv;
      nrmArr[k * 3 + 2] = -dz * inv;
      const c = (((p / PB) | 0) - 1) * NB * 3 + ((p % PB) - 1) * 3;
      col.setXYZ(k, jobC[c], jobC[c + 1], jobC[c + 2]);
      // World-space UVs: the texture runs continuously across tile borders.
      uv.setXY(k, (ox + pos.getX(k)) / TEX_METERS, (oz + pos.getZ(k)) / TEX_METERS);
    }
    pos.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    col.needsUpdate = true;
    uv.needsUpdate = true;
    geo.computeBoundingSphere();
    fillRocks(t, ox, oz);
  }

  // Advance the current tile until `deadline`; clears `job` once it is in place.
  function stepJob(deadline) {
    const { t, ox, oz } = job;
    // Re-slotted while half built: it is already back in the queue for its new spot.
    if (t.ti !== job.ti || t.tj !== job.tj) { job = null; return; }
    do {
      const j = job.row;
      if (job.phase === 0) {
        const wz = oz + j * STEP;
        for (let i = -1; i <= NB; i++) jobH[(j + 1) * PB + (i + 1)] = terrainHeight(ox + i * STEP, wz);
        if (++job.row > NB) { job.phase = 1; job.row = 0; }
      } else if (job.phase === 1) {
        for (let i = 0; i < NB; i++) {
          const p = (j + 1) * PB + (i + 1);
          const dx = (jobH[p + 1] - jobH[p - 1]) * INV2;
          const dz = (jobH[p + PB] - jobH[p - PB]) * INV2;
          groundColorAt(ox + i * STEP, oz + j * STEP, jobH[p], 1 / Math.sqrt(dx * dx + 1 + dz * dz), _c);
          const c = (j * NB + i) * 3;
          jobC[c] = _c.r;
          jobC[c + 1] = _c.g;
          jobC[c + 2] = _c.b;
        }
        if (++job.row >= NB) job.phase = 2;
      } else {
        commitJob();
        job = null;
        return;
      }
    } while (performance.now() < deadline);
  }

  // beam: optional {dx, dz} unit vector of the long-range spotlight, so rocks along it
  // cast shadows as far out as the beam reaches.
  function update(x, z, budget = 1, beam = null) {
    if (farMesh) farMesh.userData.uniforms.uRover.value.set(x, z);
    const ci = Math.round(x / TILE);
    const cj = Math.round(z / TILE);
    if (ci !== centerI || cj !== centerJ) {
      centerI = ci;
      centerJ = cj;
      for (const t of tiles) {
        const ti = slotWorld(ci, t.i);
        const tj = slotWorld(cj, t.j);
        if (t.ti === ti && t.tj === tj) continue;
        t.ti = ti;
        t.tj = tj;
        t.mesh.position.set(ti * TILE, 0, tj * TILE);
        t.mesh.updateMatrix();
        t.rocks.count = 0;
        queue.push(t);
      }
      queue.sort((a, b) =>
        Math.hypot(a.ti * TILE - x, a.tj * TILE - z) - Math.hypot(b.ti * TILE - x, b.tj * TILE - z));
    }
    // Tile rebuilds, sliced against a time budget in ms (see stepJob). More than a
    // row behind (the speedster at full tilt), it spends twice that to catch up.
    const deadline = performance.now() + (queue.length > GRID ? budget * 2 : budget);
    while ((job || queue.length) && performance.now() < deadline) {
      if (!job) {
        const t = queue.shift();
        job = { t, ti: t.ti, tj: t.tj, ox: t.ti * TILE, oz: t.tj * TILE, phase: 0, row: -1 };
      }
      stepJob(deadline);
    }
    // Near-field rock shadows are handled entirely by the dedicated nearRocks mesh
    // now (see below) — accurate per rock, not per 220 m tile.
    fillNearRocks(x, z);
    for (const t of tiles) {
      const cx = t.ti * TILE + TILE / 2;
      const cz = t.tj * TILE + TILE / 2;
      t.rocks.visible = Math.hypot(cx - x, cz - z) < ROCK_DIST;
      // The far beam-reach case is the only thing tile-level shadow casting still
      // does — rare (headlights, at night, far ahead), so the same per-tile
      // granularity that was wrong up close is fine out there.
      let cast = false;
      if (beam && t.rocks.visible) {
        // Does the beam corridor (out to BEAM_REACH, a little wide) touch this tile?
        for (let d = 40; d <= BEAM_REACH && !cast; d += 40) {
          const px = x + beam.dx * d;
          const pz = z + beam.dz * d;
          const ex = Math.max(Math.abs(cx - px) - TILE / 2, 0);
          const ez = Math.max(Math.abs(cz - pz) - TILE / 2, 0);
          cast = Math.hypot(ex, ez) < BEAM_HALF_WIDTH;
        }
      }
      t.rocks.castShadow = cast;
    }
    return queue.length + (job ? 1 : 0);
  }

  function prime(x, z) {
    update(x, z, 0);
    while (queue.length || job) update(x, z, Infinity);
  }

  return { group, update, prime, TILE, GRID, detailAmt, wet, cloud };
}

// Everything placement reads is defined by now; from here on terrainHeight levels
// landmark sites and groundHeight knows their walls.
lmArmed = true;
