import * as THREE from 'three';
import { lamp } from './glow.js';
import { bake } from './landmarks.js';
import { terrainHeight } from './terrain.js';
import { tubeY } from './base-layout.js';

// A base at each end of the route, drawn from its layout in base-layout.js (the same
// data terrain.js makes the solids from, so what you see is what you hit): geodesic
// domes — clear habitats, greenhouses with the crop showing through, panelled shells —
// joined by tube corridors, fenced solar fields, round pads, and the comms mast whose
// beacon you navigate towards from far off.
//
// Everything static is built from primitives in the base's own frame, then baked into
// one mesh per material (landmarks.js bake), so a whole base costs about a dozen draw
// calls however many struts and plants it has. Only the beacon parts stay separate,
// since main.js animates them.
const std = (color, metalness = 0, roughness = 0.6, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });

const M = {
  shell: std(0xd8d4c8, 0.2, 0.55),
  panel: std(0xd2cec2, 0.2, 0.6, { flatShading: true }),
  frame: std(0xe2e4e6, 0.6, 0.35),
  trim: std(0x3a3e46, 0.6, 0.4),
  dark: std(0x1a1c21, 0.4, 0.5),
  floor: std(0x8c8f92, 0.2, 0.75),
  soil: std(0x4a3424, 0, 0.95),
  pad: std(0x55524c, 0.1, 0.9),
  paint: std(0xe6dfc8, 0, 0.7),
  solar: std(0x16294a, 0.45, 0.28),
  // The only see-through material on a base, shared by every dome; no depth write, so
  // the frame, crop and rooms behind it draw whatever order they come in.
  glass: std(0xa6d6de, 0.3, 0.06, { transparent: true, opacity: 0.26, depthWrite: false }),
  // The crop glows faintly under its grow lights at night (emissive set in updateBases).
  plant: std(0x4f9a3c, 0, 0.75),
  beacon: new THREE.MeshBasicMaterial({ color: lamp(0x4fe0ff) }),
  stripe: new THREE.MeshBasicMaterial({ color: lamp(0xff9420, 3) }),
  // Windows and grow lamps: dark by day, lit as the sun goes down (updateBases).
  win: new THREE.MeshBasicMaterial({ color: 0x223038 }),
  grow: new THREE.MeshBasicMaterial({ color: 0x3a3438 }),
};
const NO_SHADOW = new Set([M.glass, M.beacon, M.stripe, M.win, M.grow]);

// A SpriteMaterial with no map draws a hard square, so the beacon needs a soft disc.
const haloTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.28, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

// --- tiny builders, all in the base's frame ---
function add(g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}
const box = (g, w, h, d, mat, x, y, z, ry = 0) => add(g, new THREE.BoxGeometry(w, h, d), mat, x, y, z, 0, ry);
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
// A strut between two points.
function rod(g, a, b, r, mat, seg = 5) {
  _a.set(...a);
  _b.set(...b);
  const m = add(g, new THREE.CylinderGeometry(r, r, _a.distanceTo(_b), seg, 1, true), mat);
  m.position.copy(_a).add(_b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, _b.sub(_a).normalize());
  return m;
}
// A tube lying horizontally from (ax, az) to (bx, bz) at height y.
function tube(g, ax, az, bx, bz, y, r, mat, seg = 12) {
  const len = Math.hypot(bx - ax, bz - az);
  const m = add(g, new THREE.CylinderGeometry(r, r, len, seg, 1, true), mat, (ax + bx) / 2, y, (az + bz) / 2);
  m.rotation.set(0, -Math.atan2(bz - az, bx - ax), Math.PI / 2);
  return m;
}
// A deterministic 0..1 sequence, so both bases look the same on every load.
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// The triangulated frame of a geodesic dome: rings of struts, each ring turned half a
// step from the one below and zig-zag braced to it, closing at an apex.
function geodesic(g, x, z, r, y0) {
  const N = r > 6 ? 5 : 4;
  const n = r > 6 ? 16 : 12;
  const pt = (k, j) => {
    if (k >= N) return [x, y0 + r, z];
    const th = (k / N) * (Math.PI / 2);
    const ph = ((j + (k % 2) * 0.5) / n) * Math.PI * 2;
    return [x + r * Math.cos(th) * Math.cos(ph), y0 + r * Math.sin(th), z + r * Math.cos(th) * Math.sin(ph)];
  };
  const t = Math.max(0.05, r * 0.012);
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < n; j++) {
      rod(g, pt(k, j), pt(k, j + 1), t, M.frame);
      if (k === N - 1) { rod(g, pt(k, j), pt(N, 0), t, M.frame); continue; }
      // Even rings sit under the gaps of the ring above, odd rings under its struts.
      if (k % 2 === 0) { rod(g, pt(k, j), pt(k + 1, j), t, M.frame); rod(g, pt(k, j + 1), pt(k + 1, j), t, M.frame); }
      else { rod(g, pt(k, j), pt(k + 1, j), t, M.frame); rod(g, pt(k, j), pt(k + 1, j + 1), t, M.frame); }
    }
  }
}

const DOME_Y = 0.3; // domes stand on a low dark plinth
function buildDome(g, d) {
  const { x, z, r } = d;
  add(g, new THREE.CylinderGeometry(r + 0.25, r + 0.45, DOME_Y * 2, 32), M.dark, x, 0, z);
  if (d.kind === 'shell') {
    // Opaque, faceted panels, a band of small windows and a door facing the pads.
    add(g, new THREE.SphereGeometry(r, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2), M.panel, x, DOME_Y, z);
    const wy = r * 0.32;
    const wr = Math.sqrt(r * r - wy * wy) + 0.02;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      box(g, 0.9, 0.5, 0.08, M.win, x + Math.cos(a) * wr, DOME_Y + wy, z + Math.sin(a) * wr, Math.PI / 2 - a);
    }
    box(g, 1.6, 2.2, 1.2, M.trim, x, DOME_Y + 1.1, z + r - 0.3);
    return;
  }
  // Glass: a clear shell over a geodesic frame, what is inside showing through.
  add(g, new THREE.SphereGeometry(r, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, x, DOME_Y, z);
  geodesic(g, x, z, r * 1.01, DOME_Y);
  if (d.kind === 'green') {
    // Raised beds in rows with the crop on them, grow lamps hung above each row.
    add(g, new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.1, 28), M.soil, x, DOME_Y + 0.05, z);
    const leaf = new THREE.IcosahedronGeometry(0.42, 0);
    const lampY = Math.min(r * 0.55, 3.4);
    for (let rz = -r * 0.62; rz <= r * 0.62 + 0.01; rz += 1.9) {
      const half = Math.sqrt(Math.max(0, (r * 0.8) ** 2 - rz * rz));
      if (half < 1) continue;
      box(g, half * 2, 0.4, 0.9, M.soil, x, DOME_Y + 0.3, z + rz);
      for (let px = -half + 0.5; px <= half - 0.4; px += 0.85) {
        const s = 0.7 + rnd() * 0.6;
        const p = add(g, leaf, M.plant, x + px, DOME_Y + 0.6 + 0.3 * s, z + rz + (rnd() - 0.5) * 0.25, rnd() * 3, rnd() * 3);
        p.scale.set(s, s * 1.3, s);
      }
      const lh = Math.min(half, Math.sqrt(r * r - lampY * lampY) - 0.6);
      if (lh > 0.5) box(g, lh * 2, 0.08, 0.18, M.grow, x, DOME_Y + lampY, z + rz);
    }
    return;
  }
  // A habitat: floor, a few rooms round the middle, their windows, a mezzanine.
  add(g, new THREE.CylinderGeometry(r * 0.97, r * 0.97, 0.12, 28), M.floor, x, DOME_Y + 0.06, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const rx = x + Math.cos(a) * r * 0.45;
    const rz = z + Math.sin(a) * r * 0.45;
    box(g, r * 0.42, 2.4, r * 0.3, M.shell, rx, DOME_Y + 1.2, rz, -a);
    box(g, r * 0.3, 0.5, r * 0.3 + 0.06, M.win, rx, DOME_Y + 1.6, rz, -a);
  }
  add(g, new THREE.CylinderGeometry(r * 0.32, r * 0.32, 0.2, 20), M.trim, x, DOME_Y + r * 0.5, z);
  add(g, new THREE.CylinderGeometry(0.25, 0.25, r * 0.5, 8), M.trim, x, DOME_Y + r * 0.25, z);
}

// A corridor on short legs, with ribs and a lit window strip down each side. It runs
// between the two domes' skins, not their centres, so nothing pokes out inside a glass one.
function buildTube(g, ax, az, ar, bx, bz, br, r) {
  const y = tubeY(r);
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  const sa = Math.sqrt(Math.max(0, ar * ar - y * y)) - 0.15;
  const sb = Math.sqrt(Math.max(0, br * br - y * y)) - 0.15;
  const x0 = ax + ux * sa, z0 = az + uz * sa;
  const x1 = bx - ux * sb, z1 = bz - uz * sb;
  const L = len - sa - sb;
  if (L <= 0) return;
  tube(g, x0, z0, x1, z1, y, r, M.shell);
  for (const sg of [-1, 1]) {
    const ox = -uz * sg * (r + 0.01);
    const oz = ux * sg * (r + 0.01);
    box(g, L * 0.86, 0.32, 0.05, M.win, (x0 + x1) / 2 + ox, y + 0.2, (z0 + z1) / 2 + oz, -Math.atan2(uz, ux));
  }
  const ribs = Math.max(2, Math.round(L / 3));
  for (let i = 0; i <= ribs; i++) {
    const t = i / ribs;
    const cx = x0 + (x1 - x0) * t;
    const cz = z0 + (z1 - z0) * t;
    tube(g, cx - ux * 0.15, cz - uz * 0.15, cx + ux * 0.15, cz + uz * 0.15, y, r + 0.08, M.trim, 12);
    if (i % 2 === 0) box(g, 0.3, y - r + 0.05, 0.3, M.trim, cx, (y - r) / 2, cz);
  }
}

// БЕТА's ring corridor, ribbed, with lit windows round its outer and inner faces.
function buildRing(g, R) {
  const y = tubeY(R.tr);
  add(g, new THREE.TorusGeometry(R.r, R.tr, 12, 80), M.shell, R.x, y, R.z, Math.PI / 2);
  for (const off of [-1, 1]) {
    add(g, new THREE.TorusGeometry(R.r + off * R.tr * 0.93, 0.13, 4, 80), M.win, R.x, y + 0.25, R.z, Math.PI / 2);
  }
  const ribs = 28;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    const cx = R.x + Math.cos(a) * R.r;
    const cz = R.z + Math.sin(a) * R.r;
    // A rib is a short fat tube across the corridor, tangent to the ring.
    const tx = -Math.sin(a) * 0.15;
    const tz = Math.cos(a) * 0.15;
    tube(g, cx - tx, cz - tz, cx + tx, cz + tz, y, R.tr + 0.08, M.trim, 12);
    if (i % 2 === 0) box(g, 0.3, y - R.tr + 0.05, 0.3, M.trim, cx, (y - R.tr) / 2, cz);
  }
}

// A fenced field of tilted panels on posts, in rows across the base's frame.
function buildSolar(g, f) {
  const cols = Math.floor(f.w / 2.3);
  const rows = Math.floor(f.d / 3);
  const panel = new THREE.BoxGeometry(2.1, 0.07, 1.4);
  const post = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 5);
  for (let i = 0; i < rows; i++) {
    const pz = f.z - f.d / 2 + (i + 0.5) * (f.d / rows);
    for (let j = 0; j < cols; j++) {
      const px = f.x - f.w / 2 + (j + 0.5) * (f.w / cols);
      add(g, post, M.trim, px, 0.55, pz);
      add(g, panel, M.solar, px, 1.2, pz, -0.5);
    }
  }
  // The fence is what the rover actually meets (the field's collider).
  const hw = f.w / 2 + 0.2;
  const hd = f.d / 2 + 0.2;
  for (const [x0, z0, x1, z1] of [[-hw, -hd, hw, -hd], [hw, -hd, hw, hd], [hw, hd, -hw, hd], [-hw, hd, -hw, -hd]]) {
    rod(g, [f.x + x0, 0.9, f.z + z0], [f.x + x1, 0.9, f.z + z1], 0.05, M.trim, 4);
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 4));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      box(g, 0.12, 1.1, 0.12, M.trim, f.x + x0 + (x1 - x0) * t, 0.55, f.z + z0 + (z1 - z0) * t);
    }
  }
}

// A round pad: amber edge lights, a painted ring and cross on the main pad and a
// square on the cargo pad, where crates are left for pick-up.
function buildPad(g, p, main) {
  add(g, new THREE.CylinderGeometry(p.r, p.r + 0.2, 0.14, 40), M.pad, p.x, 0.07, p.z);
  const n = main ? 12 : 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    box(g, 0.9, 0.06, 0.35, M.stripe, p.x + Math.cos(a) * (p.r - 0.8), 0.16, p.z + Math.sin(a) * (p.r - 0.8), -a);
  }
  if (main) {
    add(g, new THREE.RingGeometry(p.r * 0.5, p.r * 0.56, 40), M.paint, p.x, 0.15, p.z, -Math.PI / 2);
    box(g, p.r * 0.7, 0.02, 0.5, M.paint, p.x, 0.15, p.z);
    box(g, 0.5, 0.02, p.r * 0.7, M.paint, p.x, 0.15, p.z);
  } else {
    const s = p.r * 0.55;
    for (const [w, d, ox, oz] of [[s * 2, 0.35, 0, -s], [s * 2, 0.35, 0, s], [0.35, s * 2, -s, 0], [0.35, s * 2, s, 0]]) {
      box(g, w, 0.02, d, M.paint, p.x + ox, 0.15, p.z + oz);
    }
  }
}

export function buildBase(b) {
  const L = b.layout;
  seed = b.name === 'АЛЬФА' ? 11 : 23;
  const src = new THREE.Group();
  L.pads.forEach((p, i) => buildPad(src, p, i === 0));
  for (const d of L.domes) buildDome(src, d);
  for (const [i, j, r] of L.tubes) {
    const A = L.domes[i];
    const B = L.domes[j];
    buildTube(src, A.x, A.z, A.r, B.x, B.z, B.r, r);
  }
  if (L.ring) buildRing(src, L.ring);
  // Spokes run from the hub's skin to the ring corridor's inner wall.
  for (const s of L.spokes) {
    const hub = L.domes[0];
    const len = Math.hypot(s.x2 - s.x, s.z2 - s.z);
    const k = (len - L.ring.tr * 0.8) / len;
    buildTube(src, s.x, s.z, hub.r, s.x + (s.x2 - s.x) * k, s.z + (s.z2 - s.z) * k, 0, s.r);
  }
  for (const f of L.solar) buildSolar(src, f);

  // Comms mast with a beacon that is visible from far away
  const { x: mx, z: mz } = L.mast;
  add(src, new THREE.CylinderGeometry(0.5, 0.8, 34, 10), M.trim, mx, 17, mz);
  add(src, new THREE.CylinderGeometry(5, 5, 0.4, 6), M.shell, mx, 30, mz, -0.5, 0, 0.3);

  const g = bake(src, NO_SHADOW);
  g.position.set(b.x, terrainHeight(b.x, b.z), b.z);
  g.rotation.y = b.yaw;

  const beacon = add(g, new THREE.SphereGeometry(1.8, 12, 10), M.beacon, mx, 35, mz);

  // A navigation beacon has to punch through the haze, so the column and the marker
  // both ignore fog. The column reads up close; the marker keeps a constant size on
  // screen, so the base stays findable from any distance.
  const beamGeo = new THREE.CylinderGeometry(2.6, 0.9, 150, 14, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x63e6ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const beam = add(g, beamGeo, beamMat, mx, 110, mz);
  beam.renderOrder = 2;

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture, color: 0x8df0ff, transparent: true, opacity: 0.85, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: false,
  }));
  halo.position.set(mx, 36, mz);
  halo.scale.set(0.06, 0.06, 1);
  halo.renderOrder = 3;
  g.add(halo);
  return { group: g, beacon, beam, halo };
}

// Dusk: habitat windows and the greenhouses' grow lamps come on as the sun sinks, and
// the crop picks up a soft glow from them — modest, so the bases read at night
// without outshining the beacon. Shared materials, so one call covers both bases.
const _warm = lamp(0xffb45a, 2.4);
const _grow = lamp(0xffc4ec, 2);
const _leaf = new THREE.Color(0x2a6a1c);
export function updateBases(daylight) {
  const dark = THREE.MathUtils.smoothstep(1 - daylight, 0.25, 0.75);
  M.win.color.setRGB(0.13, 0.19, 0.22).lerp(_warm, dark);
  M.grow.color.setRGB(0.23, 0.2, 0.22).lerp(_grow, dark);
  M.plant.emissive.copy(_leaf).multiplyScalar(0.5 * dark);
}
