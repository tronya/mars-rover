import * as THREE from 'three';

// The garage's drive: a strip of rolling Martian ground with stones on it, that the
// vehicle shown drives along under Rapier (rapier-sim.js) — its own suspension
// taking the bumps. Kept apart from garage.js, which draws it, so the Node tests
// drive every chassis over exactly this ground (tests/garage-physics.test.mjs).
//
// The ground repeats every LOOP metres along +Z, the way it is driven. A vehicle
// past the end is moved back one LOOP (wrapGarage): the same ground, the same
// stones, so neither the body nor the view sees a seam — and the world stays one
// short strip instead of growing with every minute the garage is open.

export const GARAGE_SPEED = 2.6; // m/s, walking pace
// A whole number of the ground photo's repeats (36 m / 5) and of the drawn mesh's
// cells (36 m / 96), so the picture does not jump when the vehicle is moved back.
export const LOOP = 108;
const HALF_W = 8; // the strip's half-width; the autopilot keeps within a metre of the middle
const MARGIN = 24; // ground before 0 and past LOOP, for the body's length and the wrap
const CELL = 0.5;
const STONES = 140;
const START_CLEAR = 8;
const TAU = Math.PI * 2;
// Along Z only whole waves per LOOP, so the ground meets itself at the wrap.
const kz = (n) => (TAU * n) / LOOP;

// Rolling ground with a few sharper bumps.
export function garageHeight(x, z) {
  return (
    0.34 * Math.sin(z * kz(4) + 1.3 * Math.sin(x * 0.13)) +
    0.2 * Math.sin(z * kz(8) + x * 0.31) +
    0.11 * Math.sin(x * 0.6 - z * kz(6)) +
    0.05 * Math.sin(z * kz(29) + x * 1.1)
  );
}

// A lumpy stone: a dodecahedron with each corner pushed in or out, squashed to 0.7 of
// its width. The same shape is drawn and collided with.
export function stoneGeometry() {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const h = Math.sin(p.getX(i) * 12.9 + p.getY(i) * 78.2 + p.getZ(i) * 37.7) * 43758.5;
    const k = 0.7 + 0.45 * (h - Math.floor(h));
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

// Seeded, so the garage and the tests see the same stones every time.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A third of the stones lie in the wheel tracks — small enough to roll over — the
// rest beside the route, any size, but clear of the galatea's far-splayed wheels: a
// boulder against the outside of a tyre is a wall, not a bump. `y` is where the centre sits: a quarter of the
// size above the ground, the rest buried. The tracks are left clear for a few metres
// either side of 0, where every vehicle starts: one put down on a stone may jam a
// tyre against it before it ever rolls.
export function garageStones(seed = 7) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < STONES; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const inTrack = r() < 0.35;
    const x = side * (inTrack ? 0.8 + r() * 3.2 : 6.5 + r() * 11);
    const z = inTrack ? START_CLEAR + r() * (LOOP - 2 * START_CLEAR) : r() * LOOP;
    const s = inTrack ? 0.14 + r() * 0.22 : 0.12 + Math.pow(r(), 2.4) * 0.7;
    out.push({ x, z, s, r: r() * 6, y: garageHeight(x, z) + s * 0.25 });
  }
  return out;
}

// The ground for createRapierSim({ ground }): the strip as one triangle mesh and every
// stone on it as a convex hull of its drawn shape — each stone near either end of the
// strip also once more a LOOP away, so it is there on both sides of the wrap.
export function garageGround(stones = garageStones()) {
  const shape = stoneGeometry().attributes.position.array;
  return {
    // Where reset() puts the wheels down: the ground, or the top of a stone under it.
    height(x, z) {
      let g = garageHeight(x, z);
      for (const st of stones) {
        const dz = z - st.z - Math.round((z - st.z) / LOOP) * LOOP;
        if (Math.hypot(x - st.x, dz) < st.s) g = Math.max(g, st.y + st.s * 0.7);
      }
      return g;
    },
    build(world, R) {
      const nx = Math.round((2 * HALF_W) / CELL) + 1;
      const nz = Math.round((LOOP + 2 * MARGIN) / CELL) + 1;
      const verts = new Float32Array(nx * nz * 3);
      for (let b = 0; b < nz; b++) {
        for (let a = 0; a < nx; a++) {
          const x = -HALF_W + a * CELL, z = -MARGIN + b * CELL;
          const o = (b * nx + a) * 3;
          verts[o] = x;
          verts[o + 1] = garageHeight(x, z);
          verts[o + 2] = z;
        }
      }
      const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
      let k = 0;
      for (let b = 0; b < nz - 1; b++) {
        for (let a = 0; a < nx - 1; a++) {
          const p = b * nx + a, q = p + 1, r = p + nx, s = r + 1;
          idx[k++] = p; idx[k++] = r; idx[k++] = q;
          idx[k++] = q; idx[k++] = r; idx[k++] = s;
        }
      }
      world.createCollider(R.ColliderDesc.trimesh(verts, idx).setFriction(0.9));
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      for (const st of stones) {
        if (Math.abs(st.x) > HALF_W + st.s) continue; // beside the strip: only drawn
        const pts = shape.map((v) => v * st.s);
        q.setFromAxisAngle(up, st.r);
        for (const shift of [-LOOP, 0, LOOP]) {
          const z = st.z + shift;
          if (z < -MARGIN || z > LOOP + MARGIN) continue;
          const desc = R.ColliderDesc.convexHull(pts);
          if (!desc) continue;
          world.createCollider(desc.setTranslation(st.x, st.y, z).setRotation(q).setFriction(0.9));
        }
      }
    },
  };
}

// The autopilot: walking pace, straight down the middle of the strip, steering back
// gently whenever the bumps push the vehicle off line.
export function garageInput(sim) {
  const yaw = sim.yaw(); // 0 = along +Z; + = turned toward +X, its left
  // A skid-steer (the galatea) turns by driving its sides apart, which at walking
  // pace and part throttle takes much more of the wheel for the same swing.
  const gain = sim.skidSteer ? 2.5 : 1;
  const lock = sim.skidSteer ? 1 : 0.7;
  const steerTo = Math.max(-lock, Math.min(lock, -gain * (1.4 * yaw + 0.22 * sim.pos.x)));
  const err = GARAGE_SPEED - sim.speed;
  return {
    throttle: Math.max(0, Math.min(1, 0.25 + 1.2 * err)),
    brake: err < -0.8 ? Math.min(1, -0.8 - err) : 0,
    steerTo,
    steer: 0,
  };
}

// Past the end of the strip: back one LOOP, same speed, same pose. Returns how far it
// moved along Z (0 or ±LOOP) so the garage can move what it has drawn along. Rolling
// back off the start is let go a little further first, so a vehicle settling at 0
// is not thrown to and fro across the seam.
export function wrapGarage(sim) {
  const shift = sim.pos.z > LOOP ? -LOOP : sim.pos.z < -MARGIN / 2 ? LOOP : 0;
  if (!shift) return 0;
  sim.pos.z += shift;
  for (const w of sim.wheels) w.cz += shift;
  sim.body.setTranslation(sim.pos, true);
  return shift;
}
