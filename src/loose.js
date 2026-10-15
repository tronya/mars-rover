import * as THREE from 'three';
import { surfaceHeight, groundColorAtXZ } from './terrain.js';
import { PLANET } from './planet.js';
import { SPEC } from './chassis.js';

// Loose stones the rover can shove, roll and send tumbling — the first piece of the
// game run by a real physics engine (Rapier, WASM). The rover itself is still driven
// by physics.js; here it is a kinematic box that follows the hull every frame and
// pushes dynamic stones aside, one way (the stones don't push back). The ground is a
// small triangle mesh of the terrain under the rover, rebuilt as it drives on, and
// the stones are a pool recycled from behind to ahead, like sand.js.
//
// Rapier is loaded lazily after the game starts, so it never delays the first frame;
// if it fails to load, this module simply stays empty.

const GRAVITY = { moon: 1.62, verdanta: 9.5 }[PLANET] || 3.71;
const COUNT = 60;
const RADIUS = 55; // stones live within this of the rover
const PATCH = 96; // metres of ground mesh under the rover
const CELL = 2;
const REBUILD = 24; // rebuild the ground patch once the rover is this far from its centre

export function createLoose() {
  const geo = (() => {
    const g = new THREE.DodecahedronGeometry(1, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const h = Math.sin(p.getX(i) * 12.9 + p.getY(i) * 78.2 + p.getZ(i) * 37.7) * 43758.5;
      const k = 0.75 + 0.35 * (h - Math.floor(h));
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  })();
  const hullPts = Float32Array.from(geo.attributes.position.array);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), COUNT);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  let R = null; // the RAPIER namespace once loaded
  let world = null;
  let hull = null;
  let ground = null;
  let gx = Infinity, gz = Infinity;
  const stones = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();
  let failed = false;

  async function init() {
    try {
      const mod = await import('@dimforge/rapier3d-compat');
      R = mod.default || mod;
      await R.init();
    } catch (e) {
      failed = true;
      console.warn('Rapier failed to load; loose stones disabled', e);
      return;
    }
    world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
    const b = SPEC.box;
    hull = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    // The hull's footprint (the box physics.js uses), but pointed at both ends like a
    // plough and nearly frictionless, so a stone it meets is shoved off to the side
    // and rolls away, instead of riding the bumper for the rest of the drive. It
    // reaches a little below the box so pebbles can't slip under the belly.
    const W = b.w / 2, L = b.l / 2, N = Math.min(W * 1.2, L * 0.6);
    const pts = [];
    for (const y of [-b.h / 2 - 0.12, b.h / 2]) {
      for (const [x, z] of [[0, L], [W, L - N], [W, -L + N], [0, -L], [-W, -L + N], [-W, L - N]]) pts.push(x, y, z);
    }
    world.createCollider(
      R.ColliderDesc.convexHull(new Float32Array(pts)).setFriction(0.05).setFrictionCombineRule(R.CoefficientCombineRule.Min),
      hull
    );
  }

  function buildGround(cx, cz) {
    const old = ground; // removed only once the new patch is in, so nothing resting on it wakes and drops
    const n = PATCH / CELL + 1;
    const verts = new Float32Array(n * n * 3);
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = cx - PATCH / 2 + i * CELL, z = cz - PATCH / 2 + j * CELL;
        const o = (j * n + i) * 3;
        verts[o] = x;
        verts[o + 1] = surfaceHeight(x, z);
        verts[o + 2] = z;
      }
    }
    let k = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    ground = world.createCollider(R.ColliderDesc.trimesh(verts, idx).setFriction(0.9));
    if (old) world.removeCollider(old, false);
    gx = cx;
    gz = cz;
  }

  // Put stone `st` somewhere on the ground within RADIUS of (x, z), resting. Only on
  // gentle ground (a stone left on a slope just rolls off on its own, which reads as
  // stones pouring out of nowhere), flat side down, settled a little into the soil.
  const slope = (px, pz) => Math.hypot(surfaceHeight(px + 1, pz) - surfaceHeight(px - 1, pz), surfaceHeight(px, pz + 1) - surfaceHeight(px, pz - 1)) / 2;
  function place(st, x, z, ahead) {
    let px = x, pz = z, best = Infinity;
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = ahead ? RADIUS * (0.7 + 0.3 * Math.random()) : 8 + (RADIUS - 8) * Math.sqrt(Math.random());
      const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      const g = slope(cx, cz);
      if (g < best) { best = g; px = cx; pz = cz; }
      if (g < 0.1) break;
    }
    st.size = 0.18 + Math.pow(Math.random(), 2.2) * 0.55;
    if (st.body) world.removeRigidBody(st.body);
    st.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(px, surfaceHeight(px, pz) + st.size * 0.55, pz)
        .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.random() * 6, 0)))
        .setLinearDamping(0.5)
        .setAngularDamping(1.5)
        .setCanSleep(true)
    );
    // The stone's own lumpy shape, not a ball: flat faces don't roll on a slope.
    const hull = new Float32Array(hullPts.length);
    for (let i = 0; i < hull.length; i++) hull[i] = hullPts[i] * st.size;
    world.createCollider(R.ColliderDesc.convexHull(hull).setDensity(2600).setFriction(0.9).setRestitution(0.1), st.body);
    // Not forced to sleep: it settles onto the ground first (a frozen stone hung in
    // the air, its shadow off to one side), then Rapier puts it to sleep itself.
    groundColorAtXZ(px, pz, col).multiplyScalar(0.75 + Math.random() * 0.3);
    mesh.setColorAt(st.i, col);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  let started = false;
  // ctx: { x, z, pos: Vector3, quat: Quaternion }
  function update(dt, ctx) {
    if (!started) { started = true; init(); }
    if (!world) return;
    if (Math.hypot(ctx.x - gx, ctx.z - gz) > REBUILD) {
      buildGround(Math.round(ctx.x / CELL) * CELL, Math.round(ctx.z / CELL) * CELL);
      // Any stone the new patch no longer covers goes ahead of the rover.
      for (const st of stones) {
        const t = st.body.translation();
        if (Math.abs(t.x - gx) > PATCH / 2 - 4 || Math.abs(t.z - gz) > PATCH / 2 - 4) place(st, ctx.x, ctx.z, true);
      }
    }
    if (!stones.length) {
      for (let i = 0; i < COUNT; i++) {
        const st = { i, body: null, size: 0.3 };
        place(st, ctx.x, ctx.z, false);
        stones.push(st);
      }
      mesh.count = COUNT;
    }
    hull.setNextKinematicTranslation(ctx.pos);
    hull.setNextKinematicRotation(ctx.quat);
    world.timestep = Math.min(1 / 30, Math.max(1 / 240, dt));
    world.step();
    for (const st of stones) {
      const t = st.body.translation();
      // Fell through or left the disc: respawn it ahead.
      if (t.y < surfaceHeight(t.x, t.z) - 2 || Math.hypot(t.x - ctx.x, t.z - ctx.z) > RADIUS + 10) {
        place(st, ctx.x, ctx.z, true);
      }
      const p = st.body.translation();
      const r = st.body.rotation();
      m4.compose(v.set(p.x, p.y, p.z), q.set(r.x, r.y, r.z, r.w), s.setScalar(st.size));
      mesh.setMatrixAt(st.i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    mesh,
    update,
    get ready() { return !!world; },
    get failed() { return failed; },
    get stones() { return stones; }, // debugging
    get awake() { return stones.filter((st) => !st.body.isSleeping()).length; },
  };
}
