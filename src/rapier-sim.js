import * as THREE from 'three';
import { VehicleSim, GRAVITY, motorFor } from './physics.js';
import { groundHeight, deckHeight, landmarkWall, setDeckRef, waterDepthAt } from './terrain.js';
import { CHASSIS, chassisKit } from './chassis.js';

// The rover driven by Rapier (a real rigid-body engine, WASM) instead of physics.js's
// hand-written solver. Experimental and opt-in: Меню → Фізика, or ?physics=rapier.
//
// It is a drop-in VehicleSim: the input handling (throttle smoothing, steering rate,
// parking), the motor curve (driveForce) and every field main.js reads (pos, quat,
// vel, speed, wheels[i].contact/L/cx/cz …) are inherited or filled in the same way.
// Only `step` is replaced: each substep hands the wheel forces to Rapier's ray-cast
// vehicle controller and lets the engine integrate the body.
//
// The ground is streamed in as small triangle-mesh tiles around the rover, built one
// per substep batch so no single frame pays for many height samples. Building walls
// are not Rapier colliders yet; they push the hull out the same way physics.js does.
//
// Any chassis can be driven, not only the game's (the garage drives each vehicle it
// shows), and on any ground: pass `ground` and the sim stands on that instead of the
// planet — no tiles, walls or water (see createRapierSim).

// Every number the Rapier rover is built from, for one chassis. The game's own
// chassis is the default; the garage asks for whichever vehicle it is showing.
function rapierKit(id) {
  const { SPEC, WHEEL_DEFS, AXLE_PAIRS, steerAngle } = chassisKit(id);
  const SUSP = SPEC.susp;
  const MASS = SPEC.mass;
  const NW = WHEEL_DEFS.length;
  const WEIGHT = MASS * GRAVITY;
  const CORNER = WEIGHT / NW;
  const BOX = SPEC.box;
  const S_STATIC = SUSP.Lfree - SUSP.Lstatic;
  // Suspension rates as physics.js has them, per unit of chassis mass (that is how
  // Rapier scales its suspension force): linear spring holding the static sag, a
  // progressive term past it, bump/rebound damping, and a bump-stop zone that stiffens
  // smoothly over the last BUMP_ZONE of travel instead of hitting the end of the ray.
  const K_LIN = GRAVITY / (NW * S_STATIC);
  // Dampers as a fraction of critical for whatever the spring is doing right now, so a
  // soft long-travel chassis is still settled rather than left pogoing. SPEC.damp
  // softens them for the chassis meant to be lively, but never below a floor.
  const ZETA_BUMP = 0.3 * (0.6 + 0.4 * SPEC.damp.bump);
  const ZETA_REBOUND = 0.5 * (0.6 + 0.4 * SPEC.damp.rebound);
  return {
    id: SPEC.id,
    SPEC, WHEEL_DEFS, AXLE_PAIRS, steerAngle, SUSP,
    MASS, NW, WEIGHT, CORNER, BOX, S_STATIC, K_LIN, ZETA_BUMP, ZETA_REBOUND,
    R0: 0.855 * SPEC.wheelScale,
    COM: new THREE.Vector3(0, SPEC.comY, 0),
    BRAKE_FORCE: 3.2 * CORNER,
    K_PROG: K_LIN / SPEC.progLen,
    C_BUMP: ZETA_BUMP * 2 * Math.sqrt(K_LIN),
    C_REBOUND: ZETA_REBOUND * 2 * Math.sqrt(K_LIN),
    // Anti-roll bar per axle (physics.js has the same): the more one side of an axle is
    // compressed than the other, the harder it is held up and the other side pulled down.
    K_ARB: 26000 * (MASS / 2500),
    DRAG_V2: 22 * (SPEC.drag ?? 1),
    DOWNFORCE: SPEC.downforce ?? 0,
    SKID: !!SPEC.skidSteer,
    N_FRONT: WHEEL_DEFS.filter((w) => w.front).length,
    INERTIA: {
      x: (MASS / 12) * (BOX.h ** 2 + BOX.l ** 2) * 0.6,
      y: (MASS / 12) * (BOX.w ** 2 + BOX.l ** 2) * 0.62,
      z: (MASS / 12) * (BOX.w ** 2 + BOX.h ** 2) * 0.6,
    },
    motor: motorFor(SPEC),
  };
}

const BUMP_ZONE = 0.16;
// Tipped past ~60° the wheels can't be what holds the rover up: their rays would hit
// the ground sideways and shove it into a barrel roll. Suspension, drive and grip
// fade out between these (physics.js does the same).
const UP_MIN = 0.5;
const UP_FADE = 0.8;
// Angular drag, negligible while driving but bleeding off a tumble in a couple of
// seconds, and a hard cap on spin — as physics.js.
const W_DRAG_LIN = 0.08;
const W_DRAG_SQ = 0.35;
const W_LIMIT = 6;
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Rapier's tyres hold sideways harder than physics.js's soft-kneed friction circle;
// a little less side grip lets a hard turn slide before it rolls the body over.
const SIDE_GRIP = 1;
const ROLLING_RES = 0.17;
const MECH_STEER = 0.56;
const SKID_GAIN = 2.0; // tuned so a pivot turn matches physics.js (tests/physics.test.mjs)
const AWD_UP = 40 / 3.6;
const AWD_DOWN = 36 / 3.6;

// Ground tiles: TILE metres square, one height sample per CELL, kept within RING
// tiles of the rover in every direction.
const TILE = 24;
const CELL = 1;
const RING = 3;

// The hull's extent, from the same point grids physics.js collides with the ground.
function hullBounds(SPEC, BOX) {
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const g of SPEC.hullGrids) {
    for (const x of g.xs) for (const y of g.ys) for (const z of g.zs) {
      lo.min(new THREE.Vector3(x, y, z));
      hi.max(new THREE.Vector3(x, y, z));
    }
  }
  // The grids are points on the shell; give the box the body's real height above them.
  hi.y = Math.max(hi.y, lo.y + BOX.h * 0.6);
  return { lo, hi };
}

let RAPIER = null;
export async function loadRapier() {
  if (RAPIER) return RAPIER;
  const mod = await import('@dimforge/rapier3d-compat');
  RAPIER = mod.default || mod;
  await RAPIER.init();
  return RAPIER;
}

// opts.chassis: which vehicle (default: the game's).
// opts.ground: stand on this instead of the planet — { height(x, z), build(world, R) }:
//   `build` adds its static colliders to the new world once, `height` is where reset()
//   puts the wheels down. With no ground the planet's terrain is streamed in as tiles.
export async function createRapierSim(opts) {
  return new RapierVehicleSim(await loadRapier(), opts);
}

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const fwd = new THREE.Vector3();
const up = new THREE.Vector3();
const wallN = { x: 0, z: 0 };

export class RapierVehicleSim extends VehicleSim {
  constructor(R, { chassis = CHASSIS, ground = null } = {}) {
    const k = rapierKit(chassis);
    super(k.WHEEL_DEFS); // runs reset() before the world exists; reset() copes
    this.k = k;
    this.ground = ground;
    // The chassis' own input handling and motor in place of the game's (physics.js).
    this.motor = k.motor;
    this.skidSteer = k.SKID;
    this.steerLockTime = k.SPEC.steerTime;
    const { SPEC, WHEEL_DEFS, SUSP, MASS, COM, CORNER, INERTIA, BOX } = k;
    this.R = R;
    this.engine = 'rapier';
    const world = (this.world = new R.World({ x: 0, y: -GRAVITY, z: 0 }));
    world.integrationParameters.numSolverIterations = 8;
    // Softer contacts than the default 30 Hz: a hull striking the ground gives a
    // little, like physics.js caps its hull impulses, instead of a rigid jolt.
    world.integrationParameters.contact_natural_frequency = 8;

    const body = (this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(this.pos.x, this.pos.y, this.pos.z)
        .setRotation(this.quat)
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setAdditionalMassProperties(MASS, { x: 0, y: 0, z: 0 }, INERTIA, { x: 0, y: 0, z: 0, w: 1 })
    ));
    // Hull: a box around the shell, in body (centre-of-mass) coordinates. Massless —
    // the mass and inertia above are the tuned ones from physics.js.
    const { lo, hi } = hullBounds(SPEC, BOX);
    const c = lo.clone().add(hi).multiplyScalar(0.5).sub(COM);
    world.createCollider(
      R.ColliderDesc.cuboid((hi.x - lo.x) / 2, (hi.y - lo.y) / 2, (hi.z - lo.z) / 2)
        .setTranslation(c.x, c.y, c.z)
        .setDensity(0)
        .setFriction(0.35), // a beached hull slides off a rock instead of sticking
      body
    );

    // The outer faces of the tyres, as physics.js has them: standing well proud of
    // the flank, they are what a rover lying on its side rests on, wide enough to
    // hold the low centre of mass there instead of rocking it back over onto its
    // wheels and through to the other side. Kept within ±0.55 of the radius around
    // the hub, so they never reach the ground while driving.
    for (const w of WHEEL_DEFS) {
      const face = Array.isArray(SPEC.tyreFaceX) ? SPEC.tyreFaceX[w.axle] : SPEC.tyreFaceX;
      const hy = w.my - SUSP.Lstatic - COM.y;
      world.createCollider(
        R.ColliderDesc.cuboid(0.12, 0.55 * w.R, 0.55 * w.R)
          .setTranslation(w.s * face, hy, w.z - COM.z)
          .setDensity(0)
          .setFriction(0.6),
        body
      );
    }

    // Wheels. Rapier's suspension force is per unit of chassis mass, so the stiffness
    // that holds the static sag is g / (wheels × sag); dampers at 40 % / 65 % of
    // critical like physics.js.
    const ctl = (this.ctl = world.createVehicleController(body));
    ctl.indexUpAxis = 1;
    ctl.setIndexForwardAxis = 2;
    WHEEL_DEFS.forEach((w, i) => {
      ctl.addWheel(
        { x: w.x, y: w.my - COM.y, z: w.z - COM.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        // The ray reaches down to full droop (Lmax), past the spring's free length,
        // so a wheel over a dip still finds the ground; the spring itself is set per
        // step (see step) to push only while compressed past Lfree.
        SUSP.Lmax,
        w.R
      );
      ctl.setWheelSuspensionStiffness(i, k.K_LIN);
      ctl.setWheelSuspensionCompression(i, k.C_BUMP);
      ctl.setWheelSuspensionRelaxation(i, k.C_REBOUND);
      ctl.setWheelMaxSuspensionTravel(i, SUSP.Lmax - SUSP.Lmin);
      ctl.setWheelMaxSuspensionForce(i, 9 * CORNER);
      ctl.setWheelFrictionSlip(i, SPEC.mu * (w.mu ?? 1));
      ctl.setWheelSideFrictionStiffness(i, SIDE_GRIP);
    });

    this.tiles = new Map(); // "i,j" → collider
    if (ground) {
      ground.build(world, R);
      this.reset(0, 0, 0.6);
    } else {
      this.ensureTiles(true);
      this.syncFromSim();
    }
  }

  // Free the WASM world (the garage builds one per vehicle shown).
  dispose() {
    this.world.free();
    this.world = null;
  }

  // Body origin (mount-plane centre) in world space, for placing the visual model.
  origin(out) {
    return out.copy(this.k.COM).applyQuaternion(this.quat).multiplyScalar(-1).add(this.pos);
  }

  // Put the Rapier body where the inherited state says the rover is.
  syncFromSim() {
    if (!this.body) return;
    this.body.setTranslation(this.pos, true);
    this.body.setRotation(this.quat, true);
    this.body.setLinvel(this.vel, true);
    this.body.setAngvel(this.angVel, true);
  }

  reset(x, z, heading) {
    // On the planet the game's own chassis is placed by physics.js, as it always has
    // been; any other chassis or ground is placed here the same way.
    if (!this.k || (this.k.id === CHASSIS && !this.ground)) super.reset(x, z, heading);
    else this.place(x, z, heading);
    if (this.world) {
      if (!this.ground) this.ensureTiles(true);
      this.syncFromSim();
    }
  }

  // Upright, wheels just above the highest ground under any of them, at rest.
  place(x, z, heading) {
    const { COM, SUSP, R0 } = this.k;
    this.quat.setFromAxisAngle(up.set(0, 1, 0), heading);
    const cos = Math.cos(heading), sin = Math.sin(heading);
    let highest = -Infinity;
    for (const w of this.wheels) {
      w.cx = x + w.x * cos + w.z * sin;
      w.cz = z - w.x * sin + w.z * cos;
      // Under the whole tyre, not only its centre, so it never starts inside a stone.
      for (const d of [-0.8, 0, 0.8]) highest = Math.max(highest, this.heightAt(w.cx + sin * d * w.R, w.cz + cos * d * w.R));
      Object.assign(w, { wasContact: false, contact: false, L: SUSP.Lstatic, Lprev: SUSP.Lstatic, Fs: 0, spinRate: 0, rot: undefined });
    }
    this.pos.set(x, highest + R0 + SUSP.Lstatic + 0.05, z).add(tmpV.copy(COM).applyQuaternion(this.quat));
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.cmd.throttle = 0;
    this.cmd.steer = 0;
    this.refresh();
  }

  heightAt(x, z) {
    return this.ground ? this.ground.height(x, z) : Math.max(groundHeight(x, z), deckHeight(x, z));
  }

  // Ground tile (i, j) as a triangle mesh.
  buildTile(i, j) {
    const R = this.R;
    const n = TILE / CELL + 1;
    const x0 = i * TILE, z0 = j * TILE;
    const verts = new Float32Array(n * n * 3);
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const x = x0 + a * CELL, z = z0 + b * CELL;
        const o = (b * n + a) * 3;
        verts[o] = x;
        verts[o + 1] = Math.max(groundHeight(x, z), deckHeight(x, z));
        verts[o + 2] = z;
      }
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let b = 0; b < n - 1; b++) {
      for (let a = 0; a < n - 1; a++) {
        const p = b * n + a, q = p + 1, r = p + n, s = r + 1;
        idx[k++] = p; idx[k++] = r; idx[k++] = q;
        idx[k++] = q; idx[k++] = r; idx[k++] = s;
      }
    }
    return this.world.createCollider(R.ColliderDesc.trimesh(verts, idx).setFriction(0.9));
  }

  // Keep the tiles around the rover built: the one under it at once, the rest one at
  // a time (`all` builds every missing one now — at reset, or in tests).
  ensureTiles(all = false) {
    const ci = Math.floor(this.pos.x / TILE), cj = Math.floor(this.pos.z / TILE);
    let built = 0;
    const want = new Set();
    // Nearest first, so the ground under the wheels is never the one left for later.
    const order = [];
    for (let dj = -RING; dj <= RING; dj++) for (let di = -RING; di <= RING; di++) order.push([di, dj]);
    order.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    for (const [di, dj] of order) {
      const key = `${ci + di},${cj + dj}`;
      want.add(key);
      if (this.tiles.has(key)) continue;
      const near = Math.abs(di) <= 1 && Math.abs(dj) <= 1;
      if (!all && !near && built >= 1) continue;
      this.tiles.set(key, this.buildTile(ci + di, cj + dj));
      built++;
    }
    for (const [key, col] of this.tiles) {
      if (want.has(key)) continue;
      this.world.removeCollider(col, false);
      this.tiles.delete(key);
    }
  }

  update(dt, input) {
    super.update(dt, input);
    if (!this.ground) this.ensureTiles();
  }

  step(h) {
    const { body, ctl, cmd, k } = this;
    const { SPEC, WHEEL_DEFS, SUSP, NW, WEIGHT, CORNER, MASS, S_STATIC, K_LIN, K_PROG, BRAKE_FORCE, SKID, DOWNFORCE } = k;
    if (!this.ground) setDeckRef(this.pos.y);
    this.refresh();
    const speed = this.speed;
    // Front hubs disengage at speed (see physics.js).
    if (SPEC.awdSplit) {
      if (this.awd && speed > AWD_UP) this.awd = false;
      else if (!this.awd && speed < AWD_DOWN) this.awd = true;
    }
    const driven = this.awd ? NW : NW - k.N_FRONT;
    const upright = smooth01(UP_MIN, UP_FADE, this.upY);
    // Skid steer: the two sides pull differently. Rapier's tyres hold sideways far too
    // hard for that difference alone to swing the hull, so each wheel gets the mean
    // pull and the difference goes straight onto the body as a yaw torque.
    let skidTorque = 0, skidMean = 0;
    const forces = WHEEL_DEFS.map(() => 0);
    WHEEL_DEFS.forEach((w, i) => {
      let thr = cmd.throttle;
      let skidBrake = 0;
      if (SKID) {
        const st = cmd.steer / MECH_STEER;
        if (Math.abs(cmd.throttle) < 0.05) thr = -w.s * st * 0.32;
        else if (w.s * st > 0) {
          const a = Math.abs(st);
          thr = cmd.throttle * (1 - 0.75 * a);
          skidBrake = a * 0.3 * BRAKE_FORCE * Math.min(1, Math.abs(speed) / 2);
        }
      }
      const isDriven = this.awd || !w.front;
      forces[i] = upright * (isDriven ? this.driveForce(thr, speed) / driven : 0);
      if (SKID) {
        skidMean += forces[i] / NW;
        if (this.wheels[i].contact) skidTorque += -w.x * forces[i] * SKID_GAIN;
      } else ctl.setWheelEngineForce(i, forces[i]);
      ctl.setWheelSteering(i, k.steerAngle(w, cmd.steer, speed));
      // Rapier's brake is an impulse budget per step; parked means hold firm.
      const brakeF = cmd.parked ? BRAKE_FORCE * 2 : cmd.brake * BRAKE_FORCE + skidBrake;
      ctl.setWheelBrake(i, brakeF * h);
      ctl.setWheelFrictionSlip(i, upright * SPEC.mu * (w.mu ?? 1) * this.gripMul);
      // Spring and damper for where this corner is in its travel right now.
      const L = this.wheels[i].L;
      const comp = SUSP.Lfree - L;
      const dyn = Math.max(0, comp - S_STATIC);
      const near = Math.max(0, SUSP.Lmin + BUMP_ZONE - L) / BUMP_ZONE; // 0 → 1 into the bump stop
      const kEff = (K_LIN + (K_PROG * dyn * dyn) / Math.max(comp, 1e-3)) * (1 + 3 * near * near) * this.suspMul;
      const crit = 2 * Math.sqrt(kEff);
      // Rapier's spring pushes by stiffness × (rest − L) with rest = Lmax; scale it so
      // the push is the real spring's, kEff × (Lfree − L), and nothing once extended.
      ctl.setWheelSuspensionStiffness(i, upright * (comp > 0 ? (kEff * comp) / Math.max(0.02, SUSP.Lmax - L) : 0));
      ctl.setWheelMaxSuspensionForce(i, upright * 9 * CORNER);
      ctl.setWheelSuspensionCompression(i, crit * k.ZETA_BUMP * (1 + 1.5 * near));
      ctl.setWheelSuspensionRelaxation(i, crit * k.ZETA_REBOUND);
      // Turning a skid-steer means scrubbing every tyre sideways: the tread has to let
      // go sideways for the hull to swing at all (physics.js does the same, milder —
      // Rapier's side friction holds much harder).
      if (SKID) ctl.setWheelSideFrictionStiffness(i, SIDE_GRIP * (1 - 0.985 * Math.min(1, Math.abs(cmd.steer / MECH_STEER) * 1.5)));
    });

    if (SKID) for (let i = 0; i < NW; i++) ctl.setWheelEngineForce(i, skidMean);
    // Rolling resistance and churning through dust, plus downforce, as body forces.
    body.resetForces(true);
    body.resetTorques(true);
    if (SKID && skidTorque) {
      up.set(0, 1, 0).applyQuaternion(this.quat);
      body.addTorque({ x: up.x * skidTorque, y: up.y * skidTorque, z: up.z * skidTorque }, true);
    }
    const v = body.linvel();
    const vh = Math.hypot(v.x, v.z);
    const contacts = this.wheels.filter((w) => w.contact).length;
    if (vh > 0.01 && contacts) {
      const resist = (ROLLING_RES * this.rollMul * WEIGHT * contacts) / NW + k.DRAG_V2 * this.dragMul * vh * vh;
      const f = Math.min(resist, (MASS * vh) / h) / vh;
      body.addForce({ x: -v.x * f, y: 0, z: -v.z * f }, true);
    }
    if (DOWNFORCE && this.upY > 0.3) {
      up.set(0, 1, 0).applyQuaternion(this.quat);
      const d = Math.min(DOWNFORCE * speed * speed, 1.6 * WEIGHT);
      body.addForce({ x: -up.x * d, y: -up.y * d, z: -up.z * d }, true);
    }

    this.antiRoll();
    this.world.timestep = h;
    this.lastH = h;
    ctl.updateVehicle(h);
    this.world.step();
    const w = body.angvel();
    const spin = Math.hypot(w.x, w.y, w.z);
    if (spin > 1e-4) {
      const f = (1 - Math.min(0.5, (W_DRAG_LIN + W_DRAG_SQ * spin) * h)) * Math.min(1, W_LIMIT / spin);
      body.setAngvel({ x: w.x * f, y: w.y * f, z: w.z * f }, true);
    }
    if (!this.ground) this.pushOutOfWalls();
    this.readBack();
  }

  antiRoll() {
    const { body, ctl } = this;
    up.set(0, 1, 0).applyQuaternion(this.quat);
    for (const [a, b] of this.k.AXLE_PAIRS) {
      const wa = this.wheels[a], wb = this.wheels[b];
      if (!wa.contact || !wb.contact) continue;
      const f = this.k.K_ARB * (wb.L - wa.L) * this.suspMul; // + when a is the more compressed
      for (const [i, sign] of [[a, 1], [b, -1]]) {
        const hp = ctl.wheelHardPoint(i);
        if (!hp) continue;
        body.addForceAtPoint({ x: up.x * f * sign, y: up.y * f * sign, z: up.z * f * sign }, hp, true);
      }
    }
  }

  // Building walls: push the hull's corners back out along the wall normal and
  // cancel the velocity into it.
  pushOutOfWalls() {
    const { body } = this;
    const { BOX } = this.k;
    const t = body.translation();
    const r = body.rotation();
    tmpQ.set(r.x, r.y, r.z, r.w);
    let hit = false;
    for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) {
      tmpV.set((sx * BOX.w) / 2, 0, (sz * BOX.l) / 2).applyQuaternion(tmpQ).add(t);
      const d = landmarkWall(tmpV.x, tmpV.y, tmpV.z, wallN);
      if (d <= 0) continue;
      hit = true;
      const p = Math.min(d, 0.5);
      body.setTranslation({ x: t.x + wallN.x * p, y: t.y, z: t.z + wallN.z * p }, true);
      const v = body.linvel();
      const vn = v.x * wallN.x + v.z * wallN.z;
      if (vn < 0) body.setLinvel({ x: v.x - wallN.x * vn, y: v.y, z: v.z - wallN.z * vn }, true);
    }
    return hit;
  }

  // Copy the engine's state into the fields the rest of the game reads.
  readBack() {
    const { body, ctl } = this;
    const { SUSP, SPEC, NW } = this.k;
    const t = body.translation();
    const r = body.rotation();
    const v = body.linvel();
    const w = body.angvel();
    this.pos.set(t.x, t.y, t.z);
    this.quat.set(r.x, r.y, r.z, r.w);
    this.vel.set(v.x, v.y, v.z);
    this.angVel.set(w.x, w.y, w.z);
    // Water slows everything down a lot (physics.js does it per wheel; here, the body).
    const wd = this.ground ? 0 : waterDepthAt(t.x, t.z);
    if (wd > 0.2) body.setLinvel({ x: v.x * 0.995, y: v.y, z: v.z * 0.995 }, true);
    fwd.set(0, 0, 1).applyQuaternion(this.quat);
    for (let i = 0; i < NW; i++) {
      const wh = this.wheels[i];
      wh.wasContact = wh.contact;
      wh.contact = ctl.wheelIsInContact(i);
      wh.L = Math.min(SUSP.Lmax, ctl.wheelSuspensionLength(i) ?? SUSP.Lfree);
      wh.Fs = ctl.wheelSuspensionForce(i) ?? 0;
      const cp = ctl.wheelContactPoint(i);
      if (wh.contact && cp) {
        wh.cx = cp.x;
        wh.cz = cp.z;
      } else {
        const hp = ctl.wheelHardPoint(i);
        if (hp) {
          wh.cx = hp.x;
          wh.cz = hp.z;
        }
      }
      // Rapier reports the wheel's accumulated angle; the game wants a rate, so take
      // the change since the last step.
      const rot = ctl.wheelRotation(i) ?? 0;
      if (wh.contact) wh.spinRate = wh.rot === undefined ? 0 : (rot - wh.rot) / this.lastH;
      else {
        // In the air nothing holds the tyre to road speed: under throttle it spins
        // up freely, off throttle it freewheels, on the brake it stops (physics.js).
        const thr = this.cmd.throttle;
        const freeMax = (SPEC.vMaxBoost * 1.5) / wh.R;
        if (this.cmd.brake > 0) wh.spinRate *= 0.9;
        else if (thr !== 0) wh.spinRate = Math.min(freeMax, Math.max(-freeMax, wh.spinRate + Math.sign(thr) * freeMax * 5 * this.lastH));
        else wh.spinRate *= 0.9995;
      }
      wh.rot = rot;
    }
  }
}
