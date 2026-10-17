import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lamp } from './glow.js';
import { PLANET } from './planet.js';
import { getLandmarks, groundHeight, BRIDGES } from './terrain.js';
import { settlementLayout } from './landmark-types.js';

// The buildings, wrecks and odd structures terrain.js scatters across each planet.
// Every one is built from primitives in its own frame (ground level at y = 0, the
// same frame as its colliders in landmark-types.js), then merged into one mesh per
// material, so a whole outpost costs a handful of draw calls. Only those within
// sight are shown at all.

const std = (color, metalness = 0, roughness = 0.6, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });

const M = {
  white: std(0xd9d6cc, 0.2, 0.55),
  grey: std(0x8a8d90, 0.5, 0.45),
  dark: std(0x2a2d32, 0.5, 0.5),
  metal: std(0x9aa0a6, 0.85, 0.3),
  rust: std(0x8a4a2a, 0.4, 0.7),
  orange: std(0xc8642a, 0.3, 0.55),
  blue: std(0x2f5a8a, 0.3, 0.55),
  gold: std(0xc9a040, 0.9, 0.35),
  solar: std(0x16294a, 0.45, 0.28),
  glass: std(0x9fd0c8, 0.3, 0.08, { transparent: true, opacity: 0.32, depthWrite: false }),
  green: std(0x3f7a3a, 0, 0.8),
  wood: std(0x6b5640, 0, 0.85),
  stone: std(PLANET === 'verdanta' ? 0x6e7568 : 0x7a6a5c, 0, 0.95, { flatShading: true }),
  regolith: std(0x6c6c6a, 0, 0.95),
  hab2: std(0xb8c4cc, 0.25, 0.5),
  hab3: std(0xd8c0a0, 0.15, 0.6),
  cloth: std(0xe07a3a, 0, 0.9, { side: THREE.DoubleSide }),
  red: new THREE.MeshBasicMaterial({ color: lamp(0xff3a2a, 3) }),
  amber: new THREE.MeshBasicMaterial({ color: lamp(0xff9420, 3) }),
  green_l: new THREE.MeshBasicMaterial({ color: lamp(0x7ce68f, 3) }),
  white_l: new THREE.MeshBasicMaterial({ color: lamp(0xfff2d6, 3) }),
};
// Town night lights: three window groups (people turn in at different hours, so the
// town goes dark a window at a time), and the street lamps. Their colour is set every
// frame from the daylight; by day the windows are dark glass and the lamps are off.
const WIN = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: 0x223038 }));
const STREET = new THREE.MeshBasicMaterial({ color: 0x8a8a80 });
const POOL_COL = new THREE.Color(0xffc27a);
let winPick = 0;
const nextWin = () => WIN[(winPick = (winPick * 7 + 5) % 11) % 3];
const NO_SHADOW = new Set([M.glass, M.red, M.amber, M.green_l, M.white_l, STREET, ...WIN]);

// --- tiny builders, all in the landmark's frame ---
function add(g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  g.add(m);
  return m;
}
const box = (g, w, h, d, mat, x, y, z, ry = 0) => add(g, new THREE.BoxGeometry(w, h, d), mat, x, y, z, 0, ry);
const cyl = (g, rt, rb, h, mat, x, y, z, seg = 16) => add(g, new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
const dome = (g, r, mat, x, y, z, seg = 24) =>
  add(g, new THREE.SphereGeometry(r, seg, Math.ceil(seg / 2), 0, Math.PI * 2, 0, Math.PI / 2), mat, x, y, z);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
// A strut between two points.
function rod(g, a, b, r, mat) {
  const A = V(...a);
  const B = V(...b);
  const len = A.distanceTo(B);
  const m = add(g, new THREE.CylinderGeometry(r, r, len, 6), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, B.clone().sub(A).normalize());
  return m;
}
// A lattice tower: four legs tapering to the top, braced every `step` metres.
function lattice(g, w0, w1, h, mat, x = 0, z = 0, step = 3) {
  const corners = (y) => {
    const w = (w0 + (w1 - w0) * (y / h)) / 2;
    return [[-w, -w], [w, -w], [w, w], [-w, w]].map(([a, b]) => [x + a, y, z + b]);
  };
  const base = corners(0);
  const top = corners(h);
  for (let k = 0; k < 4; k++) rod(g, base[k], top[k], 0.09, mat);
  for (let y = step; y < h; y += step) {
    const c0 = corners(y - step);
    const c1 = corners(y);
    for (let k = 0; k < 4; k++) {
      rod(g, c1[k], c1[(k + 1) % 4], 0.05, mat);
      rod(g, c0[k], c1[(k + 1) % 4], 0.04, mat);
    }
  }
}
function solarRow(g, n, x, z, ry = 0) {
  const row = new THREE.Group();
  row.position.set(x, 0, z);
  row.rotation.y = ry;
  for (let i = 0; i < n; i++) {
    cyl(row, 0.06, 0.06, 1.2, M.metal, i * 2.4, 0.6, 0);
    add(row, new THREE.BoxGeometry(2.2, 0.06, 1.5), M.solar, i * 2.4, 1.25, 0, -0.5);
  }
  g.add(row);
}

// --- Mars ---
const BUILD = {
  outpost(g) {
    dome(g, 5.2, M.white, 0, 0, 0);
    cyl(g, 5.3, 5.3, 0.6, M.dark, 0, 0.3, 0, 28);
    dome(g, 3.6, M.white, 9.5, 0, 2);
    cyl(g, 3.7, 3.7, 0.5, M.dark, 9.5, 0.25, 2, 24);
    add(g, new THREE.CylinderGeometry(0.9, 0.9, 4.6, 12), M.grey, 4.8, 1.1, 1, 0, 0, Math.PI / 2);
    box(g, 1.6, 2.2, 1.2, M.dark, -5.4, 1.1, 0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      box(g, 0.6, 0.3, 0.06, M.amber, Math.cos(a) * 4.2, 2.6, Math.sin(a) * 4.2, -a + Math.PI / 2);
    }
    solarRow(g, 4, -3, 8);
    solarRow(g, 4, -3, 10.5);
    cyl(g, 0.14, 0.2, 12, M.metal, -6, 6, -6, 8);
    cyl(g, 0.25, 0.25, 0.3, M.red, -6, 12.2, -6, 8);
    rod(g, [-6, 10, -6], [-10, 0, -9], 0.025, M.metal);
    rod(g, [-6, 10, -6], [-2, 0, -9], 0.025, M.metal);
    add(g, new THREE.CylinderGeometry(7, 7, 0.15, 32), M.dark, 2, 0.05, -12);
    // A rusted, stripped rover left on the pad.
    box(g, 2, 0.8, 3, M.rust, 2, 1.1, -12);
    for (const [wx, wz] of [[-1.2, -1.1], [1.2, -1.1], [-1.2, 1.1], [1.2, 1.1]]) {
      add(g, new THREE.CylinderGeometry(0.45, 0.45, 0.35, 12), M.dark, 2 + wx, 0.45, -12 + wz, 0, 0, Math.PI / 2);
    }
  },
  geodome(g) {
    const geo = new THREE.IcosahedronGeometry(8.2, 1);
    add(g, geo, M.glass, 0, 0, 0);
    add(g, new THREE.IcosahedronGeometry(8.25, 1), new THREE.MeshStandardMaterial({ color: 0xc8c8c0, metalness: 0.6, roughness: 0.4, wireframe: true }), 0, 0, 0);
    cyl(g, 8.4, 8.6, 0.8, M.dark, 0, 0.4, 0, 30);
    for (const x of [-4, 0, 4]) {
      box(g, 2.2, 0.6, 9, M.dark, x, 0.7, 0);
      box(g, 2, 0.8, 8.6, M.green, x, 1.3, 0);
    }
    box(g, 2.4, 3, 3, M.white, 0, 1.5, 8.6);
    box(g, 1.2, 2, 0.1, M.dark, 0, 1.2, 10.15);
  },
  drill(g) {
    lattice(g, 4.4, 1.2, 16, M.orange);
    box(g, 1.6, 1.4, 1.6, M.dark, 0, 16.6, 0);
    cyl(g, 0.15, 0.15, 17, M.metal, 0, 8, 0, 8);
    cyl(g, 0.6, 0.6, 1.2, M.dark, 0, 0.6, 0, 12);
    for (const tz of [-2, 2.4]) {
      add(g, new THREE.CapsuleGeometry(1.6, 3, 6, 16), M.white, 6, 2.2, tz, 0, 0, 0);
    }
    rod(g, [6, 4.2, -2], [0, 3, 0], 0.12, M.metal);
    rod(g, [6, 4.2, 2.4], [0, 3, 0], 0.12, M.metal);
    box(g, 3.5, 2.6, 5, M.grey, -5.5, 1.3, 0);
    box(g, 0.06, 0.5, 2, M.amber, -3.72, 2.1, 0);
    cyl(g, 0.2, 0.2, 0.3, M.red, 0, 17.5, 0, 8);
  },
  comms(g) {
    cyl(g, 0.5, 0.9, 30, M.white, 0, 15, 0, 10);
    for (const y of [10, 20]) cyl(g, 1.2, 1.2, 0.4, M.dark, 0, y, 0, 12);
    for (const [y, a] of [[24, 0.4], [18, 2.4], [27, 4.2]]) {
      const d = add(g, new THREE.SphereGeometry(1.8, 20, 8, 0, Math.PI * 2, 0, 0.9), M.white, Math.cos(a) * 1.4, y, Math.sin(a) * 1.4);
      d.rotation.set(0, -a, Math.PI / 2);
    }
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      rod(g, [0, 26, 0], [Math.cos(a) * 14, 0, Math.sin(a) * 14], 0.03, M.metal);
    }
    cyl(g, 0.3, 0.3, 0.4, M.red, 0, 30.3, 0, 8);
    box(g, 4, 2.8, 3, M.grey, 4, 1.4, 3);
    solarRow(g, 2, 2.5, 6.5);
  },
  depot(g) {
    const cols = [M.orange, M.blue, M.grey, M.rust, M.white];
    const crate = (x, y, z, ry, i) => {
      box(g, 6, 2.5, 2.5, cols[i % cols.length], x, y + 1.25, z, ry);
      box(g, 6.05, 0.1, 2.55, M.dark, x, y + 2.4, z, ry);
    };
    crate(-4, 0, -3, 0, 0);
    crate(-4, 2.55, -3, 0, 1);
    crate(-4, 0, 1.2, 0, 2);
    crate(4, 0, -3, 0, 3);
    crate(4.5, 0, 3.5, Math.PI / 2, 4);
    // Gantry crane over the yard.
    for (const x of [-7.5, 7.5]) for (const z of [-6, 6]) cyl(g, 0.2, 0.2, 8, M.orange, x, 4, z, 8);
    for (const x of [-7.5, 7.5]) box(g, 0.4, 0.5, 12.4, M.orange, x, 8, 0);
    box(g, 15.4, 0.6, 0.6, M.orange, 0, 8.2, 1);
    rod(g, [1, 7.9, 1], [1, 3, 1], 0.03, M.metal);
    box(g, 0.8, 0.4, 0.8, M.dark, 1, 2.8, 1);
  },
  wreck(g) {
    const hull = add(g, new THREE.CylinderGeometry(3.4, 3.8, 4.2, 8, 1, true), M.white, 0, 1.6, 0, 0.35, 0, 0.25);
    hull.material = M.white;
    add(g, new THREE.ConeGeometry(3.4, 2, 8), M.grey, -0.6, 3.9, 0.5, 0.5, 0, 0.3);
    add(g, new THREE.CylinderGeometry(3.85, 3.85, 0.3, 8), M.dark, 0.3, 0.4, -0.4, 0.35, 0, 0.25);
    for (let k = 0; k < 3; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.6;
      rod(g, [Math.cos(a) * 3, 1.2, Math.sin(a) * 3], [Math.cos(a) * 5.4, 0, Math.sin(a) * 5.4], 0.14, M.metal);
    }
    // Scattered panels and a scorched patch.
    add(g, new THREE.BoxGeometry(3, 0.1, 2), M.white, 5.5, 0.3, 3, 0.3, 0.6, 0.2);
    add(g, new THREE.BoxGeometry(2, 0.1, 1.4), M.grey, -6, 0.2, 4, 0.1, 1.2, 0.4);
    add(g, new THREE.BoxGeometry(1.2, 0.1, 2.4), M.solar, 3, 0.2, -6, 0.2, 2, 0.1);
    add(g, new THREE.CircleGeometry(7, 24), M.dark, 0, 0.04, 0, -Math.PI / 2);
  },
  ring(g) {
    dome(g, 5, M.white, 0, 0, 0);
    cyl(g, 5.1, 5.1, 1, M.dark, 0, 0.5, 0, 28);
    cyl(g, 0.3, 0.3, 2.5, M.metal, 0, 6.2, 0, 8);
    cyl(g, 0.3, 0.3, 0.3, M.green_l, 0, 7.6, 0, 8);
    add(g, new THREE.TorusGeometry(15, 1.2, 12, 64), M.white, 0, 2.6, 0, Math.PI / 2);
    add(g, new THREE.TorusGeometry(15, 1.25, 4, 64, Math.PI * 2), M.dark, 0, 2.6, 0, Math.PI / 2);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const sp = add(g, new THREE.CylinderGeometry(0.7, 0.7, 10, 10), M.grey, Math.cos(a) * 10, 2.4, Math.sin(a) * 10, 0, -a, Math.PI / 2);
      sp.rotation.order = 'YXZ';
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      cyl(g, 0.25, 0.3, 1.4, M.metal, Math.cos(a) * 15, 0.7, Math.sin(a) * 15, 6);
      box(g, 0.7, 0.25, 0.06, M.amber, Math.cos(a) * 16.25, 2.8, Math.sin(a) * 16.25, -a + Math.PI / 2);
    }
    solarRow(g, 5, -6, 20);
    solarRow(g, 5, -6, 22.5);
  },

  // --- Moon ---
  lander(g) {
    add(g, new THREE.CylinderGeometry(2.2, 2.2, 1.6, 8), M.gold, 0, 2.2, 0, 0, Math.PI / 8);
    box(g, 2.4, 1.2, 2.4, M.grey, 0, 3.6, 0);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      rod(g, [Math.cos(a) * 1.8, 2, Math.sin(a) * 1.8], [Math.cos(a) * 3.6, 0.15, Math.sin(a) * 3.6], 0.08, M.metal);
      cyl(g, 0.45, 0.5, 0.1, M.gold, Math.cos(a) * 3.6, 0.08, Math.sin(a) * 3.6, 12);
    }
    rod(g, [1.2, 1.4, 2.2], [2.4, 0, 3.8], 0.06, M.metal); // ladder side
    cyl(g, 0.03, 0.03, 2.6, M.metal, 4.5, 1.3, 1.5, 6);
    box(g, 0.9, 0.55, 0.02, M.white, 4.95, 2.2, 1.5);
    box(g, 0.6, 0.15, 0.4, M.metal, -3.5, 0.3, 2);
    box(g, 0.4, 0.6, 0.4, M.gold, -3.2, 0.3, -2.4);
  },
  dish(g) {
    cyl(g, 1.2, 2, 4.5, M.white, 0, 2.25, 0, 12);
    box(g, 1.4, 1.2, 1.4, M.grey, 0, 5, 0);
    const d = add(g, new THREE.SphereGeometry(7, 32, 10, 0, Math.PI * 2, 0, 0.75), M.white, 0, 7.2, 0.8, -2.1, 0, 0);
    d.material = M.white;
    rod(g, [0, 6, 1], [0, 9.6, -3.2], 0.08, M.metal);
    cyl(g, 0.35, 0.35, 0.8, M.dark, 0, 9.8, -3.4, 10);
    box(g, 3, 2.4, 3, M.grey, 8, 1.2, 4);
    box(g, 0.06, 0.4, 1.6, M.amber, 6.48, 1.8, 4);
  },
  roverwreck(g) {
    box(g, 2, 0.25, 3, M.metal, 0, 0.75, 0);
    for (const [x, z] of [[-1.15, -1.1], [1.15, -1.1], [-1.15, 1.1], [1.15, 1.1]]) {
      add(g, new THREE.CylinderGeometry(0.45, 0.45, 0.3, 14), M.dark, x, 0.45, z, 0, 0, Math.PI / 2);
    }
    box(g, 0.8, 0.5, 0.6, M.gold, -0.4, 1.1, -0.8);
    box(g, 0.1, 0.6, 0.1, M.metal, 0.6, 1.2, 1.1);
    add(g, new THREE.SphereGeometry(0.4, 12, 6, 0, Math.PI * 2, 0, 1.0), M.white, 0.6, 1.65, 1.1, Math.PI / 2.4, 0, 0);
    box(g, 1.6, 0.06, 0.9, M.solar, 0.3, 1.0, 0.2);
  },
  miner(g) {
    box(g, 5, 3.2, 9, M.orange, 0, 2.4, 0);
    box(g, 4.6, 1.2, 4, M.grey, 0, 4.4, -2);
    for (const x of [-2.9, 2.9]) {
      box(g, 1.2, 1.4, 9.6, M.dark, x, 0.7, 0);
      for (let k = 0; k < 8; k++) box(g, 1.25, 0.15, 0.3, M.grey, x, 1.45, -4.2 + k * 1.2);
    }
    add(g, new THREE.CylinderGeometry(2.6, 2.6, 1.2, 16), M.grey, 0, 2.8, 6.5, 0, 0, Math.PI / 2);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      box(g, 1.3, 0.6, 0.7, M.dark, 0, 2.8 + Math.sin(a) * 2.6, 6.5 + Math.cos(a) * 2.6);
    }
    box(g, 4.8, 0.08, 3.6, M.solar, 0, 5.05, -2);
    box(g, 0.06, 0.3, 1.2, M.amber, 2.52, 3.2, 3);
  },
  reflector(g) {
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 3; j++) {
        add(g, new THREE.BoxGeometry(1.1, 0.06, 1.1), M.metal, -2.8 + i * 1.4, 0.55, -1.4 + j * 1.4, -0.5, 0, 0);
        cyl(g, 0.04, 0.04, 0.5, M.grey, -2.8 + i * 1.4, 0.25, -1.4 + j * 1.4, 6);
      }
    }
    box(g, 0.8, 0.5, 0.6, M.gold, 4.2, 0.25, 0);
  },
  habmound(g) {
    add(g, new THREE.SphereGeometry(7.5, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.regolith, 0, -3.8, 0, 0, 0, 0).scale.set(1, 1.0, 1);
    add(g, new THREE.CylinderGeometry(1.4, 1.4, 4, 16), M.white, 0, 1.4, 6.5, Math.PI / 2, 0, 0);
    box(g, 2.6, 2.6, 0.3, M.grey, 0, 1.3, 8.6);
    box(g, 1.2, 1.8, 0.1, M.dark, 0, 1.1, 8.76);
    box(g, 1, 0.12, 0.06, M.white_l, 0, 2.3, 8.8);
    cyl(g, 0.1, 0.1, 3.5, M.metal, -3, 3.2, -1, 6);
    cyl(g, 0.2, 0.2, 0.25, M.red, -3, 5, -1, 8);
  },

  // --- Верданта ---
  hut(g) {
    for (const [x, z] of [[-2.2, -1.7], [2.2, -1.7], [-2.2, 1.7], [2.2, 1.7]]) cyl(g, 0.15, 0.15, 2, M.wood, x, 1, z, 8);
    box(g, 5, 0.25, 4, M.wood, 0, 2.05, 0);
    box(g, 4.6, 2.4, 3.6, M.white, 0, 3.4, 0);
    add(g, new THREE.CylinderGeometry(0.01, 3.4, 1.4, 4, 1), M.green, 0, 5.3, 0, 0, Math.PI / 4);
    box(g, 0.9, 1.7, 0.08, M.dark, 1.2, 3.1, 1.82);
    box(g, 1.2, 0.6, 0.08, M.white_l, -1.1, 3.8, 1.82);
    for (let k = 0; k < 4; k++) box(g, 1, 0.08, 0.3, M.wood, 1.2, 1.7 - k * 0.45, 2.3 + k * 0.4);
    box(g, 1.6, 0.06, 1.1, M.solar, -1.2, 5.3, -1, 0.3);
    cyl(g, 0.03, 0.03, 3, M.metal, 2, 6, -1.5, 6);
  },
  weather(g) {
    lattice(g, 2.4, 0.8, 18, M.white, 0, 0, 3);
    cyl(g, 0.05, 0.05, 2, M.metal, 0, 19, 0, 6);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      rod(g, [0, 19.8, 0], [Math.cos(a) * 0.6, 19.8, Math.sin(a) * 0.6], 0.02, M.metal);
      add(g, new THREE.SphereGeometry(0.14, 8, 6, 0, Math.PI), M.white, Math.cos(a) * 0.6, 19.8, Math.sin(a) * 0.6);
    }
    box(g, 1.2, 0.8, 0.8, M.grey, 0, 12, 0.9);
    cyl(g, 0.2, 0.2, 0.25, M.red, 0, 20.1, 0, 8);
    // A tethered balloon riding high over the mast.
    add(g, new THREE.SphereGeometry(2.4, 18, 14), M.white, 6, 42, 4);
    rod(g, [6, 39.6, 4], [0, 18, 0], 0.015, M.metal);
    box(g, 1.2, 0.8, 1, M.grey, -1.8, 0.4, 2);
  },
  pod(g) {
    add(g, new THREE.ConeGeometry(2.3, 3.4, 18), M.white, 0, 1.2, 0, 0.35, 0, 0.2);
    add(g, new THREE.CylinderGeometry(2.35, 2.35, 0.4, 18), M.rust, 0.05, -0.3, 0.15, 0.35, 0, 0.2);
    // The chute lying spread out across the grass behind it.
    const chute = add(g, new THREE.CircleGeometry(5.5, 20), M.cloth, -1, 0.06, -8, -Math.PI / 2);
    chute.scale.set(1, 0.7, 1);
    for (let k = 0; k < 5; k++) rod(g, [0, 0.4, -1.5], [-3.5 + k * 1.6, 0.05, -4.5], 0.012, M.white);
    box(g, 0.08, 0.3, 0.08, M.amber, 0.4, 2.7, 0.6);
  },
  arch(g) {
    // Rough boulders stacked into two legs and a lintel.
    let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (const side of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const m = add(g, new THREE.DodecahedronGeometry(2.4 - k * 0.12, 0), M.stone, side * (6.5 - k * 0.15) + (r() - 0.5), 1.4 + k * 2.1, (r() - 0.5) * 0.8, r() * 3, r() * 3, r() * 3);
        m.scale.set(1.1, 0.8, 1.2);
      }
    }
    for (let k = 0; k < 7; k++) {
      const x = -6 + k * 2;
      const m = add(g, new THREE.DodecahedronGeometry(1.9, 0), M.stone, x, 13.4 + Math.sin((k / 6) * Math.PI) * 1.2, (r() - 0.5) * 0.6, r() * 3, r() * 3, r() * 3);
      m.scale.set(1.3, 0.8, 1.1);
    }
  },
  orangery(g) {
    add(g, new THREE.IcosahedronGeometry(10, 2), M.glass, 0, 0, 0);
    add(g, new THREE.IcosahedronGeometry(10.05, 2), new THREE.MeshStandardMaterial({ color: 0xd8d8d0, metalness: 0.6, roughness: 0.4, wireframe: true }), 0, 0, 0);
    cyl(g, 10.2, 10.4, 0.8, M.dark, 0, 0.4, 0, 32);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const rr = 3 + (k % 3) * 2;
      cyl(g, 0.15, 0.25, 3 + (k % 4), M.wood, Math.cos(a) * rr, 1.5, Math.sin(a) * rr, 6);
      add(g, new THREE.IcosahedronGeometry(1.4 + (k % 3) * 0.4, 0), M.green, Math.cos(a) * rr, 3.4 + (k % 4), Math.sin(a) * rr);
    }
    box(g, 2.6, 3, 3, M.white, 0, 1.5, 10.6);
  },
  beacon(g) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      rod(g, [0, 3.6, 0], [Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4], 0.07, M.metal);
    }
    cyl(g, 0.45, 0.45, 0.6, M.white, 0, 3.8, 0, 12);
    cyl(g, 0.3, 0.3, 0.4, M.green_l, 0, 4.3, 0, 10);
    box(g, 0.8, 0.5, 0.06, M.solar, 0.7, 2.6, 0, 0);
  },
};

// «Обрій», the town (see settlementLayout): everything in its own frame, merged with
// the rest of the landmark meshes, so the whole town is a handful of draw calls.
function buildSettlement(g) {
  const L = settlementLayout();
  // The streets and plaza are no surface of their own: terrain.js tints the ground
  // there as packed dirt (townWear). Only the lamps and the buildings stand on it.

  // Homes.
  for (const h of L.homes) {
    const ry = h.face === 1 ? Math.PI / 2 : h.face === -1 ? -Math.PI / 2 : h.face === 2 ? 0 : Math.PI;
    const home = new THREE.Group();
    home.position.set(h.x, 0, h.z);
    home.rotation.y = ry; // local +z faces the street
    if (h.kind === 'hab') {
      dome(home, 4.6, M.white, 0, 0, 0);
      cyl(home, 4.7, 4.7, 0.4, M.dark, 0, 0.2, 0, 24);
      box(home, 1.8, 2.4, 2, M.hab2, 0, 1.2, 4.4);
      box(home, 1, 1.8, 0.08, M.dark, 0, 1, 5.42);
      box(home, 1.2, 0.35, 0.06, nextWin(), 0, 3, 3.9);
    } else if (h.kind === 'module') {
      box(home, 7, 3.6, 5.4, M.hab2, 0, 1.8, 0);
      box(home, 7.2, 0.2, 5.6, M.dark, 0, 3.7, 0);
      add(home, new THREE.BoxGeometry(6, 0.06, 2.4), M.solar, 0, 4.1, -0.6, -0.35, 0, 0);
      box(home, 1.1, 2, 0.08, M.dark, 1.8, 1, 2.72);
      for (const x of [-2, -0.6]) box(home, 0.9, 0.7, 0.06, nextWin(), x, 2.2, 2.72);
    } else {
      box(home, 6, 3.2, 6, M.hab3, 0, 1.6, 0);
      box(home, 5.4, 3.2, 5.4, M.white, 0, 4.8, -0.2);
      box(home, 3, 0.15, 1.4, M.dark, 0, 3.3, 3.6);
      box(home, 1.1, 2, 0.08, M.dark, -1.6, 1, 3.02);
      for (const y of [2, 5]) box(home, 1.2, 0.7, 0.06, nextWin(), 1.4, y, y > 3 ? 2.52 : 3.02);
      cyl(home, 0.04, 0.04, 2, M.metal, 2, 7.4, -2, 6);
    }
    g.add(home);
  }

  // The hall: a broad low dome with an entrance tunnel toward the plaza.
  const hall = add(g, new THREE.SphereGeometry(L.hall.r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.white, L.hall.x, 0, L.hall.z);
  hall.scale.set(1, 10 / L.hall.r, 1);
  cyl(g, L.hall.r + 0.2, L.hall.r + 0.2, 0.6, M.dark, L.hall.x, 0.3, L.hall.z, 40);
  add(g, new THREE.CylinderGeometry(2.4, 2.4, 9, 14), M.hab2, L.hall.x - 12, 2, L.hall.z - 9, Math.PI / 2, -0.65, 0);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    box(g, 1.6, 0.4, 0.06, M.amber, L.hall.x + Math.cos(a) * 11.4, 4.2, L.hall.z + Math.sin(a) * 11.4, -a + Math.PI / 2);
  }

  // Greenhouses.
  for (const gh of L.greenhouses) {
    add(g, new THREE.IcosahedronGeometry(gh.r, 1), M.glass, gh.x, 0, gh.z);
    add(g, new THREE.IcosahedronGeometry(gh.r + 0.05, 1), new THREE.MeshStandardMaterial({ color: 0xc8c8c0, metalness: 0.6, roughness: 0.4, wireframe: true }), gh.x, 0, gh.z);
    cyl(g, gh.r + 0.2, gh.r + 0.4, 0.8, M.dark, gh.x, 0.4, gh.z, 30);
    for (const dx of [-4, 0, 4]) {
      box(g, 2.2, 0.6, gh.r * 1.1, M.dark, gh.x + dx, 0.7, gh.z);
      box(g, 2, 0.9, gh.r * 1.05, M.green, gh.x + dx, 1.4, gh.z);
    }
  }

  // Garage, open toward the cross street, with two rovers parked inside.
  const G = L.garage;
  box(g, G.w, G.h, 0.4, M.grey, G.x, G.h / 2, G.z - G.d / 2);
  for (const s of [-1, 1]) box(g, 0.4, G.h, G.d, M.grey, G.x + s * G.w / 2, G.h / 2, G.z);
  box(g, G.w + 0.6, 0.4, G.d + 0.6, M.dark, G.x, G.h + 0.2, G.z);
  box(g, G.w - 1, 0.3, 0.1, M.amber, G.x, G.h - 0.4, G.z + G.d / 2);
  for (const dx of [-3.8, 3.8]) {
    box(g, 2.6, 1.2, 4.6, dx < 0 ? M.orange : M.blue, G.x + dx, 1.5, G.z);
    for (const [wx, wz] of [[-1.4, -1.5], [1.4, -1.5], [-1.4, 1.5], [1.4, 1.5]]) {
      add(g, new THREE.CylinderGeometry(0.55, 0.55, 0.45, 12), M.dark, G.x + dx + wx, 0.55, G.z + wz, 0, 0, Math.PI / 2);
    }
  }

  // Water tanks.
  for (const t of L.tanks) {
    cyl(g, t.r, t.r, t.h, M.white, t.x, t.h / 2, t.z, 20);
    cyl(g, t.r + 0.08, t.r + 0.08, 0.3, M.dark, t.x, t.h * 0.7, t.z, 20);
    add(g, new THREE.SphereGeometry(t.r, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.white, t.x, t.h, t.z);
  }
  rod(g, [L.tanks[0].x, 1, L.tanks[0].z], [-20, 1, 6], 0.25, M.metal);

  // Landing pad with a parked shuttle.
  add(g, new THREE.CylinderGeometry(L.pad.r, L.pad.r, 0.25, 36), M.dark, L.pad.x, 0.12, L.pad.z);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    box(g, 0.8, 0.06, 3, M.amber, L.pad.x + Math.cos(a) * (L.pad.r - 2), 0.27, L.pad.z + Math.sin(a) * (L.pad.r - 2), -a);
  }
  add(g, new THREE.ConeGeometry(3, 7, 16), M.white, L.pad.x, 4.6, L.pad.z);
  cyl(g, 3, 3.4, 1.2, M.dark, L.pad.x, 1.1, L.pad.z, 16);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    rod(g, [L.pad.x + Math.cos(a) * 2.6, 1.2, L.pad.z + Math.sin(a) * 2.6], [L.pad.x + Math.cos(a) * 4.2, 0.2, L.pad.z + Math.sin(a) * 4.2], 0.12, M.metal);
  }

  // Plaza mast with the town beacon.
  cyl(g, 0.3, 0.5, L.mast.h, M.white, L.mast.x, L.mast.h / 2, L.mast.z, 10);
  cyl(g, 0.45, 0.45, 0.5, M.green_l, L.mast.x, L.mast.h + 0.3, L.mast.z, 12);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    box(g, 2.4, 1.2, 0.04, k % 2 ? M.orange : M.blue, L.mast.x + Math.cos(a) * 1.3, L.mast.h - 2, L.mast.z + Math.sin(a) * 1.3, -a);
  }

  // Solar farm.
  for (const p of L.solar) {
    cyl(g, 0.12, 0.12, 2.2, M.metal, p.x, 1.1, p.z, 6);
    add(g, new THREE.BoxGeometry(7.5, 0.08, 5), M.solar, p.x, 2.3, p.z, -0.45, 0, 0);
  }

  // Street lamps.
  for (const l of L.lamps) {
    cyl(g, 0.1, 0.14, 5, M.dark, l.x, 2.5, l.z, 6);
    box(g, 0.6, 0.18, 0.6, M.dark, l.x, 5.05, l.z);
    box(g, 0.45, 0.06, 0.45, STREET, l.x, 4.93, l.z);
  }
}

// A steel span across the canyon (terrain.js plans it and owns its physics). Built
// in world space along the deck: segments that follow the camber, two box girders
// under it, orange rails on posts, piers down to the canyon floor, and a concrete
// block at each end.
function buildBridge(g, b) {
  const yaw = Math.atan2(b.ux, b.uz);
  const N = Math.max(8, Math.round(b.len / 6));
  const at = (t) => {
    const x = b.ax + (b.bx - b.ax) * t;
    const z = b.az + (b.bz - b.az) * t;
    const ramp = Math.min(1, (t * b.len) / 5, ((1 - t) * b.len) / 5);
    return { x, z, y: b.ay + (b.by - b.ay) * t + Math.sin(Math.PI * t) * Math.min(3, b.len * 0.02) + 0.35 * ramp };
  };
  const piece = (w, h, d, mat, p, pitch, side = 0, dy = 0) => {
    const holder = new THREE.Group();
    holder.position.set(p.x + b.uz * side, p.y + dy, p.z - b.ux * side);
    holder.rotation.order = 'YXZ';
    holder.rotation.y = yaw;
    holder.rotation.x = -pitch;
    holder.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
    g.add(holder);
  };
  for (let i = 0; i < N; i++) {
    const p0 = at(i / N);
    const p1 = at((i + 1) / N);
    const seg = Math.hypot(b.len / N, p1.y - p0.y);
    const pitch = Math.atan2(p1.y - p0.y, b.len / N);
    const mid = { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2, y: (p0.y + p1.y) / 2 };
    piece(b.w, 0.5, seg + 0.04, M.grey, mid, pitch, 0, -0.25); // deck plate
    for (const sd of [-1, 1]) {
      piece(0.7, 1.8, seg + 0.04, M.dark, mid, pitch, sd * (b.w / 2 - 1.2), -1.4); // girders
      piece(0.12, 0.12, seg + 0.04, M.orange, mid, pitch, sd * (b.w / 2 + 0.2), 1.15); // top rail
      piece(0.08, 0.08, seg + 0.04, M.orange, mid, pitch, sd * (b.w / 2 + 0.2), 0.6); // mid rail
      piece(0.35, 0.3, seg + 0.04, M.metal, mid, pitch, sd * (b.w / 2 + 0.05), 0.05); // kerb
    }
  }
  // Posts, with a small amber lamp every few.
  for (let i = 0; i <= N; i++) {
    const p = at(i / N);
    for (const sd of [-1, 1]) {
      piece(0.14, 1.2, 0.14, M.metal, p, 0, sd * (b.w / 2 + 0.2), 0.6);
      if (i % 3 === 0) piece(0.22, 0.12, 0.22, M.amber, p, 0, sd * (b.w / 2 + 0.2), 1.27);
    }
  }
  // Piers down to the canyon floor, with a cross-beam under the girders.
  for (const pr of b.piers || []) {
    const t = ((pr.x - b.ax) * b.ux + (pr.z - b.az) * b.uz) / b.len;
    const top = at(t).y - 2.3;
    const foot = groundHeight(pr.x, pr.z) - 1;
    const h = top - foot;
    for (const sd of [-1, 1]) piece(1.3, h, 1.6, M.grey, { x: pr.x, z: pr.z, y: foot + h / 2 }, 0, sd * (b.w / 2 - 1.2));
    piece(b.w, 1.0, 1.8, M.dark, { x: pr.x, z: pr.z, y: top - 0.2 }, 0);
    // X-bracing between the two legs.
    const holder = new THREE.Group();
    holder.position.set(pr.x, foot + h / 2, pr.z);
    holder.rotation.y = yaw;
    for (const sg of [-1, 1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.3, Math.hypot(h, b.w - 2.4), 0.3), M.metal);
      brace.rotation.z = sg * Math.atan2(b.w - 2.4, h);
      holder.add(brace);
    }
    g.add(holder);
  }
  // Abutments: concrete blocks the deck sits on at each rim.
  for (const t of [0, 1]) {
    const p = at(t);
    piece(b.w + 1.6, 3, 4, M.grey, { x: p.x, z: p.z, y: p.y - 1.9 }, 0);
  }
}

// Merge a built group into one mesh per material, world-placed. base.js bakes its
// bases the same way, with its own set of materials that cast no shadow.
export function bake(src, noShadow = NO_SHADOW) {
  src.updateMatrixWorld(true);
  const byMat = new Map();
  src.traverse((o) => {
    if (!o.isMesh) return;
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    const keep = new THREE.BufferGeometry();
    keep.setAttribute('position', geo.getAttribute('position'));
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    keep.setAttribute('normal', geo.getAttribute('normal'));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(keep);
  });
  const out = new THREE.Group();
  for (const [mat, list] of byMat) {
    const m = new THREE.Mesh(mergeGeometries(list, false), mat);
    m.castShadow = !noShadow.has(mat) && !mat.wireframe;
    m.receiveShadow = true;
    out.add(m);
  }
  return out;
}

const _warm = lamp(0xffb45a, 2.6);
const _street = lamp(0xfff0d0, 3.2);

// Soft warm circles on the ground under the street lamps, additive so they only ever
// brighten; faded in by update() as night falls.
const POOL_MAT = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#fff');
  gr.addColorStop(0.35, '#777');
  gr.addColorStop(1, '#000');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  return new THREE.MeshBasicMaterial({ color: POOL_COL, alphaMap: new THREE.CanvasTexture(c), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
})();
function lightPools(lm) {
  const L = settlementLayout();
  const geo = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2);
  const m = new THREE.InstancedMesh(geo, POOL_MAT, L.lamps.length);
  const c = Math.cos(lm.yaw);
  const s = Math.sin(lm.yaw);
  const mtx = new THREE.Matrix4();
  L.lamps.forEach((l, i) => {
    const wx = lm.x + l.x * c + l.z * s;
    const wz = lm.z - l.x * s + l.z * c;
    mtx.makeTranslation(wx, groundHeight(wx, wz) + 0.12, wz);
    m.setMatrixAt(i, mtx);
  });
  m.frustumCulled = false;
  m.renderOrder = 1;
  return m;
}

const SHOW_DIST = 1500;
const SHOW_DIST_TOWN = 2200;

export function createLandmarks() {
  const group = new THREE.Group();
  const list = getLandmarks().map((lm) => {
    const g = new THREE.Group();
    g.position.set(lm.x, lm.y, lm.z);
    g.rotation.y = lm.yaw;
    let pools = null;
    if (lm.type.id === 'settlement') {
      buildSettlement(g);
      pools = lightPools(lm);
    } else {
      const build = BUILD[lm.type.id];
      if (build) build(g);
      // A low skirt so a building on a slight slope never shows daylight under it.
      add(g, new THREE.CylinderGeometry(lm.r * 0.55, lm.r * 0.6, 1.2, 20), M.dark, 0, -0.62, 0);
    }
    const baked = bake(g);
    if (pools) baked.add(pools);
    baked.visible = false;
    group.add(baked);
    return { lm, mesh: baked };
  });
  for (const b of BRIDGES) {
    const g = new THREE.Group();
    buildBridge(g, b);
    const baked = bake(g);
    baked.visible = false;
    group.add(baked);
    list.push({ lm: { x: (b.ax + b.bx) / 2, z: (b.az + b.bz) / 2, type: { id: 'bridge' } }, mesh: baked });
  }

  return {
    group,
    list,
    update(x, z, daylight = 1) {
      // Dusk: windows come on as the sun sinks, then go out group by group late at
      // night; street lamps and their pools of light follow the dark.
      const dark = THREE.MathUtils.smoothstep(1 - daylight, 0.25, 0.75);
      for (let k = 0; k < 3; k++) {
        const on = dark * (k === 0 ? 1 : k === 1 ? 0.85 : 0.6);
        WIN[k].color.setRGB(0.13, 0.19, 0.22).lerp(_warm, on);
      }
      STREET.color.setRGB(0.54, 0.54, 0.5).lerp(_street, dark);
      POOL_MAT.opacity = 0.32 * dark;
      for (const it of list) it.mesh.visible = Math.hypot(it.lm.x - x, it.lm.z - z) < (it.lm.type.id === 'settlement' ? SHOW_DIST_TOWN : SHOW_DIST);
    },
  };
}
