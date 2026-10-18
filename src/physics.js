import * as THREE from 'three';
import { groundHeight, dustDepth, landmarkWall, landmarkPoles, setDeckRef, waterDepthAt, waterLevelAt } from './terrain.js';
import { WHEEL_R, SUSP } from './vehicle.js';
import { SPEC, WHEEL_DEFS, AXLE_PAIRS, steerAngle } from './chassis.js';
import { PLANET } from './planet.js';

export { PLANET };

// Rigid-body vehicle in SI units. The body has mass, inertia and a high centre of
// mass; every wheel has a spring/damper, tyre friction limited by the load on it,
// and the hull collides with the ground, so the truck can slide and roll over.

// GRAVITY feeds several other module-level constants below (WEIGHT, K_SPRING,
// K_PROG) computed once at load — a live in-game planet swap would need those
// re-derived every frame instead, which is why the menu reloads the page.
export const GRAVITY = PLANET === 'moon' ? 1.62 : PLANET === 'verdanta' ? 9.5 : 3.71;
// Mass, wheel layout and suspension rates come from the chosen chassis (see
// chassis.js): the four-wheel scout or the six-wheel crawler. Everything below is
// derived from those numbers, never from a hard-coded wheel count.
const MASS = SPEC.mass;
const NW = WHEEL_DEFS.length;
const WEIGHT = MASS * GRAVITY;
const CORNER = WEIGHT / NW; // static load on one wheel
// Low and central: the battery pack sits in the floor, which is what keeps a
// tall-wheeled rover from tipping when it lands off a dune.
const COM = new THREE.Vector3(0, SPEC.comY, 0); // relative to the suspension mount plane
const BOX = SPEC.box;
const INERTIA = {
  // Lower than the true box value (like yaw below) so the same accel/brake/corner
  // torque — already computed correctly from where those forces land relative to
  // COM — produces a squat/dive/lean that's actually visible, not just physically
  // present. Steady-state tilt is set by the (still stiff, still quick-settling)
  // suspension springs; this only makes the body swing into and out of it readily.
  x: (MASS / 12) * (BOX.h ** 2 + BOX.l ** 2) * 0.6, // pitch
  y: (MASS / 12) * (BOX.w ** 2 + BOX.l ** 2) * 0.62, // yaw (lower = turns in more eagerly)
  z: (MASS / 12) * (BOX.w ** 2 + BOX.h ** 2) * 0.6, // roll
};

// Above the ~1.26 g rollover threshold (1.39 m centre of mass, 1.75 m half-track)
// the tyres can hold harder than the rover can resist tipping — a hard enough
// cornering mistake can flip it (wanted, see physics.js history). Stock grip stays
// modest on purpose: the workshop's КОЛЕСА upgrade (sim.gripMul) is what lets a
// maxed 540 kW motor actually put its power down instead of just lighting up the
// tyres off the line.
const MU = SPEC.mu; // tyre grip on dust, stock — see gripMul
// Stiff and well damped: on Mars gravity a soft spring wallows for seconds after
// every bump. ~1.4 Hz with 40/65 % of critical damping settles the body at once.
// That linear rate governs everyday ride (it's exactly what holds the static sag
// below), same as before. A real coil spring firms up as it compresses, though —
// K_PROG adds a quadratic term that only wakes up past the static sag, so a bigger
// hit meets progressively more resistance instead of the same rate all the way to
// the bump stop, with zero effect on ride height or the tuned near-static feel.
const S_STATIC = SUSP.Lfree - SUSP.Lstatic;
const K_SPRING = (MASS * GRAVITY) / NW / S_STATIC;
const K_PROG = K_SPRING / SPEC.progLen;
const C_BUMP = 4600 * (MASS / 2500) * SPEC.damp.bump;
const C_REBOUND = 7200 * (MASS / 2500) * SPEC.damp.rebound;
const LDOT_MAX = 6; // damper blow-off, m/s — keeps a kerb strike from spiking the damper
const K_ARB = 26000 * (MASS / 2500); // anti-roll bar, per axle

// Bump stop. Past full compression it acts as a one-way velocity limit rather than a
// spring: it can cancel inward motion and ease the wheel out of a ledge at walking
// pace, but never pushes a chassis that is already separating. A spring here stores
// the whole height of the obstacle and fires the truck into orbit.
const PEN_MAX = 0.12;
const BUMP_STOP_MAX = 3.6 * CORNER;
const BUMP_EXIT_V = 1.2; // m/s, the fastest the bump stop alone will push a wheel out
const C_STOP = 10 * CORNER;
// A tyre cannot teleport onto an obstacle; the contact point may only rise this
// fast (m/s per m/s of travel, plus a floor), which bounds the energy a step injects.
const CLIMB_RATE = 1.6;
const CLIMB_FLOOR = 2.5;
// Below this the suspension axis is too horizontal to reach the ground at all.
const UP_MIN = 0.5;
const UP_FADE = 0.8;
// Stock motor. The workshop's ДВИГУН upgrade scales this via sim.powerMul — 180,
// 360 or 540 kW (see upgrades.js) — instead of this file hard-coding a fixed value.
// A function of the chassis, so rapier-sim.js can give the garage's vehicle its own.
export function motorFor(spec) {
  return {
    fDrive: 26000 * (spec.power ?? 1), // total, all wheels, at the stock 180 kW
    power: 180000 * (spec.power ?? 1), // the light chassis get a hotter motor
    vMax: spec.vMax, // ~43 km/h cruising, AWD mode only
    vMaxBoost: spec.vMaxBoost, // Shift only, and it drinks the battery — stays above vMaxRwd
    vMaxRwd: spec.vMaxRwd ?? 100 / 3.6, // ~28 m/s — the whole point of dropping the front axle
    lowGear: spec.lowGear,
  };
}
const MOTOR = motorFor(SPEC);
const N_FRONT = WHEEL_DEFS.filter((w) => w.front).length;
const V_MAX_BOOST = MOTOR.vMaxBoost;
const V_MAX_REVERSE = 6;
// Below AWD_UP the front axle stays engaged for traction over rough ground; past it
// the front hubs disengage and only the rear wheels drive — less drivetrain to spin
// up, so it clears a bit more top speed, and main.js reads `sim.awd` to cut the
// battery draw to match. Separate up/down thresholds (hysteresis) so cruising right
// at the switch point doesn't clatter the front axle in and out every second.
const AWD_UP = 40 / 3.6;
const AWD_DOWN = 36 / 3.6;
// Steering behaves like a wheel, not a spring: the angle stays where it is left.
const MECH_STEER = 0.56; // mechanical lock at the knuckle
// How much of the lock the front tyres can actually use at a given speed. Past the angle
// where the cornering force reaches what the grip allows, more lock only makes the nose
// plough straight on; on Mars (g = 3.71) that angle is tiny at 80 km/h. So the wheel's
// travel shrinks with speed: full lock below a walking-fast pace, a degree or two flat
// out. Without it the rover cannot be steered at all in a valley sprint and spins out.
const WHEELBASE = Math.abs(SPEC.axleZ[0] - SPEC.axleZ[SPEC.axleZ.length - 1]) || 3;
const GRIP_ANGLE_K = 1.25; // a little past the grip limit: the tail may step out, not the whole car
// The other limit is the roll-over one: sideways acceleration at which the inside wheels
// lift is about g × half-track ÷ centre-of-mass height. On Mars that is under 1.5 m/s² for a
// tall truck, lower than what the tyres hold, so it is the roll-over that decides.
const ROLL_LIMIT = 0.65 * GRAVITY * (SPEC.wheelX || 1.7) / (Math.abs(SPEC.comY) + 0.9);
export function steerAuthority(speed, gripMul = 1) {
  const v = Math.max(Math.abs(speed), 0.5);
  const aLat = Math.min(GRIP_ANGLE_K * MU * gripMul * GRAVITY, ROLL_LIMIT);
  const limit = Math.atan((aLat * WHEELBASE) / (v * v));
  return Math.min(1, Math.max(0.06, limit / MECH_STEER));
}
const SKID = !!SPEC.skidSteer; // tank-style: steer by driving the two sides apart
// Time to wind the wheel from centre to full lock. Scaling the rate to the current
// lock keeps that time the same at any speed; a fixed rad/s hit the (small) lock at
// speed in a fifth of a second, so a tap was full opposite lock.
const STEER_LOCK_TIME = SPEC.steerTime;
const BRAKE_FORCE = 3.2 * CORNER; // per wheel
// Regolith is soft: a rover that stops pulling slows down noticeably. The linear
// term is rolling resistance, the quadratic one stands in for churning through dust.
const ROLLING_RES = 0.17;
const TRACTION_SHARE = 0.7; // how much of a tyre's grip the motor may use to accelerate
const DRAG_V2 = 22 * (SPEC.drag ?? 1); // N per (m/s)^2 — less for a low, light body
const DOWNFORCE = SPEC.downforce ?? 0; // N per (m/s)^2
const DOWNFORCE_MAX = 1.6 * MASS * GRAVITY;
const SUBSTEP = 1 / 240;
// The corridor ridges are the map boundary now; this is just a last-ditch backstop.
const MAX_RADIUS = 20000;

// Hull points that can touch the ground, matching the body shell: skid plate, flanks,
// deck and roof. These must track the visual hull or the truck collides with nothing.
const BODY_POINTS = [];
for (const grid of SPEC.hullGrids) {
  for (const x of grid.xs) for (const y of grid.ys) for (const z of grid.zs) {
    BODY_POINTS.push(new THREE.Vector3(x, y, z));
  }
}
// The outer faces of the tyres. Lying on its side the rover rests on them, and they
// stand well proud of the flank, so that base is wide enough to hold the low centre of
// mass — without it a truck on its flank tipped straight back onto its wheels or its
// roof instead of lying there. The points stay above the tread even at full bump, so
// they never touch the ground while driving.
// A chassis with bigger rear tyres gives one face per axle, and those points follow the
// taller rear hub (w.my) and radius (w.rs) the same way the wheel does.
for (const w of WHEEL_DEFS) {
  const face = Array.isArray(SPEC.tyreFaceX) ? SPEC.tyreFaceX[w.axle] : SPEC.tyreFaceX;
  for (const dy of [-0.55, 0, 0.55]) BODY_POINTS.push(new THREE.Vector3(w.s * face, w.my - SUSP.Lstatic + dy * w.rs, w.z));
}
const F_SUSP_MAX = 9 * CORNER; // a wheel can never push harder than ~9x its static load
const F_HULL_MAX = 4 * WEIGHT;
const HULL_ITER = 6;
const HULL_EXIT_V = 1.0;
const MU_HULL = 0.7;
const V_LIMIT = 40;
const W_LIMIT = 6;
// Angular drag is quadratic: negligible while driving (< 1 rad/s), but it bleeds off
// a tumble in a couple of seconds instead of letting the truck spin like a top.
const W_DRAG_LIN = 0.08;
const W_DRAG_SQ = 0.35;

const FOOTPRINT = [-0.8, -0.4, 0, 0.4, 0.8];
const FOOT_DROP = FOOTPRINT.map((d) => WHEEL_R - Math.sqrt(WHEEL_R * WHEEL_R - d * d));
// A tyre can mount a step about half its radius. Anything taller is a wall you stop
// against, not a ramp: without this the suspension "climbs" boulders vertically and
// throws the truck into the air.
const CLIMB_MAX = SPEC.climb * WHEEL_R;
const K_BLOCK = 8 * WEIGHT;
const C_BLOCK = 0.6 * WEIGHT;
const F_BLOCK_MAX = 1.7 * WEIGHT;

// Highest ground under the tyre footprint, so a wheel rolls over a stone instead of
// sinking into it. `blocked` is how far that reading exceeds what the tyre can climb.
// `side` says which way along the heading the obstacle lies (+1 ahead, -1 behind).
const contact = { g: 0, blocked: 0, side: 0 };
function contactHeight(x, z, fx, fz) {
  const base = groundHeight(x, z);
  let best = base;
  let side = 0;
  for (let i = 0; i < FOOTPRINT.length; i++) {
    const d = FOOTPRINT[i];
    if (d === 0) continue;
    const v = groundHeight(x + fx * d, z + fz * d) - FOOT_DROP[i];
    if (v > best) { best = v; side = Math.sign(d); }
  }
  contact.side = side;
  const cap = base + CLIMB_MAX;
  contact.blocked = Math.max(0, best - cap);
  contact.g = Math.min(best, cap);
  return contact.g;
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const SLOPE_CAP = 1.5;
function groundGradient(x, z, out) {
  const e = 0.35;
  out.x = clamp((groundHeight(x + e, z) - groundHeight(x - e, z)) / (2 * e), -SLOPE_CAP, SLOPE_CAP);
  out.z = clamp((groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e), -SLOPE_CAP, SLOPE_CAP);
  return out;
}

// scratch objects
const V3 = () => new THREE.Vector3();
const up = V3(), fwd = V3(), fh = V3(), worldUp = new THREE.Vector3(0, 1, 0);
const rel = V3(), mount = V3(), vm = V3(), vp = V3(), tmpA = V3(), tmpB = V3();
const force = V3(), torque = V3(), grad = { x: 0, z: 0 };
const nrm = V3(), dir = V3(), fw = V3(), lw = V3(), f0 = V3();
const wb = V3(), tb = V3(), iw = V3(), gyro = V3(), blk = V3();
const rxn = V3(), tmpI = V3();
// Per hull point: where it was last sampled (x, z, y) and its clearance then.
// Clearance starts negative, so every point is sampled on the first step.
const hullSeen = new Float32Array(BODY_POINTS.length * 4).fill(-1);
const HULL_SKIP = 0.5; // m of clearance that always gets re-checked
const HULL_SLOPE = 8; // steepest ground rise per metre moved (a boulder's edge)
// Room for every hull point against the ground and against a wall, plus poles.
const hullContacts = Array.from({ length: BODY_POINTS.length * 2 + 16 }, () => ({ rel: V3(), n: V3(), pen: 0, jn: 0, cap: 0 }));
// A building wall is rigid: it may stop the whole rover at speed within a few
// substeps, where a ground contact is capped low so landings stay soft.
const F_WALL_MAX = 80 * WEIGHT;
const wallN = { x: 0, z: 0 };
const poles = [];
const poleLocal = V3();
// World-space inverse inertia applied to a vector: out = R diag(1/I) R^T v.
function invInertia(v, out, q) {
  out.copy(v).applyQuaternion(qInvScratch.copy(q).invert());
  out.set(out.x / INERTIA.x, out.y / INERTIA.y, out.z / INERTIA.z);
  return out.applyQuaternion(q);
}
const qInv = new THREE.Quaternion(), dq = new THREE.Quaternion(), qInvScratch = new THREE.Quaternion();

export class VehicleSim {
  // `wheelDefs` is for rapier-sim.js driving another chassis than the game's (the
  // garage); physics.js's own solver only ever runs the game's.
  constructor(wheelDefs = WHEEL_DEFS) {
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.cmd = { throttle: 0, brake: 0, steer: 0, parked: false, boost: false };
    this.acc = 0;
    this.speed = 0; // forward speed, m/s
    this.upY = 1; // 1 = upright, <0 = upside down
    this.maxSteer = MECH_STEER;
    this.awd = true; // true = all four driven, false = rear only (see AWD_UP/DOWN)
    this.powerMul = 1; // set by the workshop motor upgrade — not touched by reset()
    this.suspMul = 1; // set by the workshop suspension upgrade — how hard a hit it absorbs
    this.gripMul = 1; // set by the workshop wheels upgrade — tyre grip on top of MU
    this.rollMul = 1; // set per frame by main.js: off-road rolling resistance for this chassis
    this.dragMul = 1; // and churn through loose regolith
    // What the input handling and motor below need of the chassis; rapier-sim.js
    // replaces them when it drives another one.
    this.motor = MOTOR;
    this.skidSteer = SKID;
    this.steerLockTime = STEER_LOCK_TIME;
    this.wheels = wheelDefs.map((w) => ({
      ...w, L: SUSP.Lstatic, Lprev: SUSP.Lstatic, wasContact: false, contact: false, Fs: 0, comp: 0,
      cx: 0, cz: 0, g: 0, gPrev: 0, blocked: 0, blockSide: 0, vx: 0, vy: 0, spinRate: 0, dir: V3(), n: V3(), rel: V3(),
    }));
    this.reset(0, 0, 0.6);
  }

  // Put the truck upright on the ground at (x, z).
  reset(x, z, heading) {
    this.quat.setFromAxisAngle(worldUp, heading);
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    let highest = -Infinity;
    for (const w of this.wheels) {
      w.cx = x + w.x * cos + w.z * sin;
      w.cz = z - w.x * sin + w.z * cos;
      w.g = contactHeight(w.cx, w.cz, sin, cos);
      w.gPrev = w.g;
      w.wasContact = false;
      w.blocked = 0;
      w.blockSide = 0;
      w.L = SUSP.Lstatic;
      w.Lprev = SUSP.Lstatic;
      w.contact = false;
      w.Fs = 0;
      w.spinRate = 0;
      highest = Math.max(highest, w.g);
    }
    const origin = new THREE.Vector3(x, highest + WHEEL_R + SUSP.Lstatic + 0.05, z);
    this.pos.copy(origin).add(COM.clone().applyQuaternion(this.quat));
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.cmd.throttle = 0;
    this.cmd.steer = 0;
    this.refresh();
  }

  // Body origin (mount-plane centre) in world space, for placing the visual model.
  origin(out) {
    return out.copy(COM).applyQuaternion(this.quat).multiplyScalar(-1).add(this.pos);
  }

  yaw() {
    fwd.set(0, 0, 1).applyQuaternion(this.quat);
    return Math.atan2(fwd.x, fwd.z);
  }

  refresh() {
    up.set(0, 1, 0).applyQuaternion(this.quat);
    fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.upY = up.y;
    this.speed = this.vel.dot(fwd);
  }

  // input: { throttle: -1..1, steer: -1..1 (left +), brake: 0..1, boost: bool }
  // Dust depth under the rover, eased over ~0.7 s: a pocket of dust at 40 m/s is
  // metres long, and the raw value turned it into a wall of drag from one step to the next.
  softness(h) {
    const raw = dustDepth(this.pos.x, this.pos.z);
    if (this.dustS === undefined || h > 0.3) this.dustS = raw;
    else this.dustS += (raw - this.dustS) * (1 - Math.exp(-h / 0.7));
    return this.dustS;
  }

  update(dt, input) {
    const v = this.speed;
    let throttle = 0;
    let brake = input.brake || 0;
    if (input.throttle > 0) {
      if (v < -0.8) brake = 1;
      else throttle = input.throttle;
    } else if (input.throttle < 0) {
      if (v > 0.8) brake = 1;
      else throttle = input.throttle;
    }
    const c = this.cmd;
    c.throttle = damp(c.throttle, throttle, 12, dt);
    if (Math.abs(c.throttle) < 0.01 && throttle === 0) c.throttle = 0;
    c.brake = brake;
    c.boost = !!input.boost;
    c.parked = throttle === 0 && brake === 0 && this.vel.length() < 1.2 && this.upY > 0.7;
    // The lock available shrinks with speed (steerAuthority): beyond what the tyres can
    // deliver the extra angle only scrubs speed and sends the rover into a slide. A tank-
    // steered chassis turns by driving its sides apart, so it keeps its full range.
    const maxSteer = SKID ? MECH_STEER : MECH_STEER * steerAuthority(this.speed, this.gripMul);
    this.maxSteer = maxSteer;
    // A skid-steered rover turns on the spot: holding the wheel is not parking.
    if (this.skidSteer && Math.abs(input.steer || input.steerTo || 0) > 0.02) c.parked = false;
    if (input.steerTo !== undefined) {
      c.steer = damp(c.steer, clamp(input.steerTo, -1, 1) * maxSteer, 5, dt);
    } else {
      const inp = clamp(input.steer, -1, 1);
      // The wheel turns at this rate whichever way it moves, whether that is a key
      // winding it toward lock or the wheel unwinding back to centre once released.
      const step = (maxSteer * dt) / this.steerLockTime;
      if (inp !== 0) c.steer += inp * step;
      else if (c.steer > step) c.steer -= step;
      else if (c.steer < -step) c.steer += step;
      else c.steer = 0;
    }
    c.steer = clamp(c.steer, -maxSteer, maxSteer);

    this.acc = Math.min(this.acc + dt, SUBSTEP * 12);
    while (this.acc >= SUBSTEP) {
      this.step(SUBSTEP);
      this.acc -= SUBSTEP;
    }
    this.refresh();
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z)) this.reset(0, 0, 0);
  }

  driveForce(thr, speed) {
    const boost = this.cmd.boost;
    const m = this.motor;
    let vmax = thr > 0 ? (boost ? m.vMaxBoost : this.awd ? m.vMax : m.vMaxRwd) : V_MAX_REVERSE;
    const fmax = (boost ? m.fDrive * 1.4 : m.fDrive) * m.lowGear * this.powerMul;
    let f = Math.min(fmax, ((boost ? m.power * 1.4 : m.power) * this.powerMul) / Math.max(Math.abs(speed), 2));
    if (thr * speed >= 0) f *= 1 - smoothstep(0.8 * vmax, vmax, Math.abs(speed));
    return f * thr;
  }

  applyAt(f, r) {
    force.add(f);
    torque.add(tmpA.crossVectors(r, f));
  }

  pointVelocity(r, out) {
    return out.crossVectors(this.angVel, r).add(this.vel);
  }

  // Hull vs ground: lets the truck scrape, roll onto its side or lie on its roof.
  // Solved as impulses on the velocities, a few passes over all touching points. The
  // ground pushes hardest where the truck's weight actually is, so a truck that lands
  // flat on its side stays there. Independent spring-like forces at every point did
  // not distribute like that: with the centre of mass low, equal forces at points all
  // above it kicked the body over, and it bounced and rolled onto its roof.
  solveHull(h) {
    const { quat: q, pos, vel, angVel } = this;
    let n = 0;
    const wallCap = F_WALL_MAX * h;
    for (let i = 0; i < BODY_POINTS.length; i++) {
      rel.copy(BODY_POINTS[i]).sub(COM).applyQuaternion(q);
      tmpB.copy(pos).add(rel);
      const wd = landmarkWall(tmpB.x, tmpB.y, tmpB.z, wallN);
      if (wd > 0) {
        const c = hullContacts[n++];
        c.rel.copy(rel);
        c.n.set(wallN.x, 0, wallN.z);
        c.pen = Math.min(wd, 0.8);
        c.jn = 0;
        c.cap = wallCap;
      }
      // Most hull points ride a metre or two clear of the ground, and in 1/240 s the
      // ground under them cannot rise that far. A point last seen well clear is not
      // re-sampled until it has moved enough — sideways, or down — that ground as
      // steep as a boulder's flank (HULL_SLOPE) could have caught up with it.
      const k = i * 4;
      const moved = Math.hypot(tmpB.x - hullSeen[k], tmpB.z - hullSeen[k + 1]) + Math.max(0, hullSeen[k + 2] - tmpB.y);
      if (hullSeen[k + 3] > HULL_SKIP + HULL_SLOPE * moved) continue;
      const gh = groundHeight(tmpB.x, tmpB.z);
      hullSeen[k] = tmpB.x;
      hullSeen[k + 1] = tmpB.z;
      hullSeen[k + 2] = tmpB.y;
      hullSeen[k + 3] = tmpB.y - gh;
      const pen = Math.min(gh - tmpB.y, 0.8);
      if (pen <= 0) continue;
      groundGradient(tmpB.x, tmpB.z, grad);
      const c = hullContacts[n++];
      c.rel.copy(rel);
      c.n.set(-grad.x, 1, -grad.z).normalize();
      c.pen = pen;
      c.jn = 0;
      c.cap = F_HULL_MAX * h; // most impulse one point may add in a step
    }
    qInv.copy(q).invert();
    // Poles against the rover's box, in its own frame: push out across whichever
    // side the pole is nearest to.
    landmarkPoles(pos.x, pos.z, poles);
    for (const p of poles) {
      if (n >= hullContacts.length) break;
      if (pos.y + BOX.h < p.y0 || pos.y - BOX.h > p.y1) continue;
      poleLocal.set(p.x - pos.x, 0, p.z - pos.z).applyQuaternion(qInv).add(COM);
      const ex = BOX.w / 2 + p.r - Math.abs(poleLocal.x);
      const ez = BOX.l / 2 + p.r - Math.abs(poleLocal.z);
      if (ex <= 0 || ez <= 0) continue;
      const c = hullContacts[n++];
      if (ex < ez) {
        const sx = Math.sign(poleLocal.x) || 1;
        c.rel.set(sx * BOX.w / 2, COM.y, poleLocal.z).sub(COM).applyQuaternion(q);
        c.n.set(-sx, 0, 0).applyQuaternion(q);
        c.pen = Math.min(ex, 0.8);
      } else {
        const sz = Math.sign(poleLocal.z) || 1;
        c.rel.set(poleLocal.x, COM.y, sz * BOX.l / 2).sub(COM).applyQuaternion(q);
        c.n.set(0, 0, -sz).applyQuaternion(q);
        c.pen = Math.min(ez, 0.8);
      }
      c.n.y = 0;
      c.n.normalize();
      c.jn = 0;
      c.cap = wallCap;
    }
    if (!n) return;
    for (let it = 0; it < HULL_ITER; it++) {
      for (let i = 0; i < n; i++) {
        const c = hullContacts[i];
        this.pointVelocity(c.rel, vp);
        const vn = vp.dot(c.n);
        const vWant = Math.min(c.pen * 10, HULL_EXIT_V);
        let j = 0;
        if (vn < vWant && c.jn < c.cap) {
          rxn.crossVectors(c.rel, c.n);
          invInertia(rxn, tmpI, q);
          j = Math.min((vWant - vn) / (1 / MASS + rxn.dot(tmpI)), c.cap - c.jn);
          c.jn += j;
          vel.addScaledVector(c.n, j / MASS);
          rxn.multiplyScalar(j);
          invInertia(rxn, tmpI, q);
          angVel.add(tmpI);
        }
        // Coulomb friction against the sliding of this point, limited by how hard it
        // is being pressed into the ground.
        if (j <= 0) continue;
        this.pointVelocity(c.rel, vp);
        vp.addScaledVector(c.n, -vp.dot(c.n));
        const vt = vp.length();
        if (vt < 1e-4) continue;
        vp.multiplyScalar(1 / vt);
        rxn.crossVectors(c.rel, vp);
        invInertia(rxn, tmpI, q);
        const jt = Math.min(MU_HULL * j, vt / (1 / MASS + rxn.dot(tmpI)));
        vel.addScaledVector(vp, -jt / MASS);
        rxn.multiplyScalar(-jt);
        invInertia(rxn, tmpI, q);
        angVel.add(tmpI);
      }
    }
  }

  step(h) {
    setDeckRef(this.pos.y); // a bridge deck is ground only to something up at its level
    const { quat: q, pos, vel, angVel, cmd, wheels } = this;
    up.set(0, 1, 0).applyQuaternion(q);
    fwd.set(0, 0, 1).applyQuaternion(q);
    force.set(0, -MASS * GRAVITY, 0);
    torque.set(0, 0, 0);
    const speed = vel.dot(fwd);
    // Aero downforce (the speedster only): grows with the square of speed and presses
    // along the body's own down, so the tyres get more load — and so more grip — the
    // faster it goes, the way a racing car's wings pin it to the track. Off once it is
    // rolled past its side, so a flipped car is not glued onto its roof.
    if (DOWNFORCE && up.y > 0.3) {
      force.addScaledVector(up, -Math.min(DOWNFORCE * speed * speed, DOWNFORCE_MAX));
    }
    // Only forward speed disengages the front axle — reversing or crawling over
    // rough ground always keeps all four driven for traction.
    if (SPEC.awdSplit) {
      if (this.awd && speed > AWD_UP) this.awd = false;
      else if (!this.awd && speed < AWD_DOWN) this.awd = true;
    }
    let driven = this.awd ? NW : NW - N_FRONT;

    // Pass 1: where is the ground under each wheel, how compressed is each spring.
    fh.set(fwd.x, 0, fwd.z);
    if (fh.lengthSq() < 1e-6) fh.set(0, 0, 1);
    fh.normalize();

    for (const w of wheels) {
      w.contact = false;
      w.Fs = 0;
      rel.set(w.x, w.my, w.z).sub(COM).applyQuaternion(q);
      mount.copy(pos).add(rel);
      this.pointVelocity(rel, vm);

      // Sample under the wheel centre, which hangs below the mount at the current
      // (always physical) length. Keeping L bounded keeps this sample on the wheel.
      const cx = mount.x - up.x * w.L;
      const cz = mount.z - up.z * w.L;
      let g = contactHeight(cx, cz, fh.x, fh.z);
      w.blocked = contact.blocked;
      w.blockSide = contact.side;
      const climb = CLIMB_FLOOR + CLIMB_RATE * Math.hypot(vm.x, vm.z);
      g = Math.min(g, w.gPrev + climb * h);
      w.gPrev = g;
      w.cx = cx;
      w.cz = cz;
      w.g = g;

      // Tilted past ~72 deg the suspension axis is too flat to reach the ground.
      if (up.y <= UP_MIN) {
        w.L = SUSP.Lmax;
        w.Lprev = w.L;
        w.wasContact = false;
        continue;
      }
      const Lreq = (mount.y - (g + w.R)) / up.y;
      w.L = clamp(Lreq, SUSP.Lmin - PEN_MAX * this.suspMul, SUSP.Lmax);
      if (Lreq >= SUSP.Lmax) {
        w.Lprev = w.L;
        w.wasContact = false;
        continue;
      }

      // Damper velocity is measured from the length itself. Estimating it from the
      // terrain gradient gets the sign wrong on slopes, which pumps energy in.
      // On the first substep back in contact the length jumps from full droop to
      // wherever the ground is; reading that as damper velocity punches the rover
      // into the air, which is what made a roll-over impossible to recover from.
      const Ldot = w.wasContact ? clamp((w.L - w.Lprev) / h, -LDOT_MAX, LDOT_MAX) : 0;
      w.Lprev = w.L;
      w.wasContact = true;
      groundGradient(cx, cz, grad);
      const Lspring = clamp(Lreq, SUSP.Lmin, SUSP.Lmax);
      const s = SUSP.Lfree - Lspring; // + compressed, - extended past free length
      const dynComp = Math.max(0, s - S_STATIC); // compression beyond the static sag
      let Fs = K_SPRING * s + K_PROG * dynComp * dynComp - (Ldot < 0 ? C_BUMP : C_REBOUND) * Ldot;

      // Past full compression: push only until the wheel is easing out at vWant.
      // The workshop suspension upgrade raises both the travel it tolerates before
      // this engages (PEN_MAX) and how hard it's allowed to push (BUMP_STOP_MAX/
      // C_STOP) — a bigger hit gets absorbed instead of slamming into a hard stop.
      const pen = clamp(SUSP.Lmin - Lreq, 0, PEN_MAX * this.suspMul);
      if (pen > 0) {
        const vWant = Math.min(pen * 10, BUMP_EXIT_V);
        if (Ldot < vWant) Fs += Math.min(BUMP_STOP_MAX * this.suspMul, C_STOP * this.suspMul * (vWant - Ldot));
      }

      w.contact = true;
      w.Fs = Fs * smoothstep(UP_MIN, UP_FADE, up.y);
      w.comp = SUSP.Lfree - Lspring;
      w.n.set(-grad.x, 1, -grad.z).normalize();
    }

    // Anti-roll bars couple the left and right wheel of each axle.
    for (let k = 0; k < AXLE_PAIRS.length; k++) {
      const [a, b] = AXLE_PAIRS[k];
      const l = wheels[a];
      const r = wheels[b];
      if ((!l.contact && !r.contact) || !SPEC.arb[k]) continue;
      const arb = SPEC.arb[k] * K_ARB * (clamp(l.comp, -0.2, 0.5) - clamp(r.comp, -0.2, 0.5));
      if (l.contact) l.Fs += arb;
      if (r.contact) r.Fs -= arb;
    }

    // Locked diffs: the torque only goes to driven wheels that can use it.
    if (SPEC.lockers) {
      let n = 0;
      for (const w of wheels) if (w.contact && (this.awd || !w.front)) n++;
      driven = Math.max(1, n);
    }

    // Pass 2: suspension + tyre forces at each contact patch.
    const dust = this.softness(h); // soft ground: more rolling drag, less grip
    for (const w of wheels) {
      if (!w.contact) {
        // Nothing to grip in the air, so the tyre isn't held to road speed like it
        // is on the ground. Off throttle it just freewheels (only bearing drag);
        // under throttle it spins up fast with no resistance holding it back — the
        // classic off-road look. It was snapping toward a stop every jump before,
        // which read as an unwanted ABS/traction-control mid-air.
        if (cmd.throttle !== 0) {
          const freeMax = (V_MAX_BOOST * 1.5) / w.R;
          w.spinRate = clamp(w.spinRate + Math.sign(cmd.throttle) * freeMax * 5 * h, -freeMax, freeMax);
        } else {
          w.spinRate *= 0.9995;
        }
        continue;
      }
      // Rock too tall to mount: resist the wheel's horizontal motion. Purely
      // dissipative (it always opposes velocity), so it can never add energy.
      // Gated on contact, so flying over a boulder does not brake the truck.
      if (w.blocked > 1e-3) {
        blk.set(w.cx, w.g, w.cz).sub(pos);
        this.pointVelocity(blk, vp);
        vp.y = 0;
        const vh = vp.length();
        // Only the approach is resisted. Backing away from the rock used to be braked
        // just as hard, so a rover nosed into a boulder crept out in reverse at 0.1 m/s.
        const leaving = w.blockSide !== 0 && w.blockSide * vp.dot(fh) < 0;
        if (vh > 0.05 && !leaving) {
          const Fb = Math.min(F_BLOCK_MAX, K_BLOCK * w.blocked + C_BLOCK * vh);
          tmpB.copy(vp).multiplyScalar(-Fb / vh);
          this.applyAt(tmpB, blk);
        }
      }
      const Fs = clamp(w.Fs, 0, F_SUSP_MAX * this.suspMul);
      nrm.copy(w.n);
      dir.copy(up).multiplyScalar(0.6).addScaledVector(nrm, 0.2).addScaledVector(worldUp, 0.2).normalize();
      w.rel.set(w.cx, w.g, w.cz).sub(pos);
      tmpB.copy(dir).multiplyScalar(Fs);
      this.applyAt(tmpB, w.rel);

      this.pointVelocity(w.rel, vp);
      const angle = steerAngle(w, cmd.steer, speed);
      f0.copy(fwd).applyAxisAngle(up, angle);
      fw.copy(f0).addScaledVector(nrm, -f0.dot(nrm)).normalize();
      lw.crossVectors(nrm, fw);
      const vx = vp.dot(fw);
      const vy = vp.dot(lw);
      w.vx = vx;
      w.vy = vy;

      const N = Fs;
      const grip = MU * w.mu * this.gripMul * N * (1 - 0.12 * dust);
      let Fx;
      if (cmd.parked) Fx = -grip * Math.tanh(vx / 0.05);
      else {
        const resist = cmd.brake * BRAKE_FORCE + ROLLING_RES * this.rollMul * (1 + 0.8 * dust) * N + (DRAG_V2 * this.dragMul * vx * vx) / NW;
        const isDriven = this.awd || !w.front;
        // Skid steer (tank-style): no wheel turns; one side is driven harder, or the
        // other way, than the other. Steering left slows or reverses the left side.
        let thr = cmd.throttle;
        let skidBrake = 0;
        if (SKID) {
          const st = cmd.steer / MECH_STEER; // + is a left turn
          if (Math.abs(cmd.throttle) < 0.05) {
            thr = -w.s * st * 0.32; // on the spot: the two sides drive opposite ways
          } else if (w.s * st > 0) {
            // On the move the inside track lets off, then drags: that is the turn.
            const a = Math.abs(st);
            thr = cmd.throttle * (1 - 0.75 * a);
            skidBrake = a * 0.3 * BRAKE_FORCE * Math.min(1, Math.abs(speed) / 2);
          }
        }
        // A tyre cannot push harder than it grips (and the motor must leave some for
        // steering): past that the pull only tips the nose up. Capped at a share of the grip.
        const driveWant = isDriven ? this.driveForce(thr, speed) / driven : 0;
        const driveCap = TRACTION_SHARE * grip;
        const drive = Math.max(-driveCap, Math.min(driveCap, driveWant));
        Fx = drive - (resist + skidBrake) * Math.tanh(vx / 0.4);
      }
      let Fy = -grip * Math.tanh(vy / (cmd.parked ? 0.05 : 0.15));
      // Turning a skid-steer means scrubbing every tyre sideways; the tread lets go
      // a little so the hull can swing at all.
      if (SKID) Fy *= 1 - 0.4 * Math.min(1, Math.abs(cmd.steer / MECH_STEER) * 1.5);
      const mag = Math.hypot(Fx, Fy);
      // Soft-knee onto the friction circle instead of a hard clip: comfortably under
      // the limit this changes almost nothing, but the approach to it is a squeeze,
      // not a wall, so breaking traction reads as a slide starting rather than a
      // switch flipping.
      if (mag > 0) {
        const scale = (grip * Math.tanh(mag / grip)) / mag;
        Fx *= scale;
        Fy *= scale;
      }
      tmpB.copy(fw).multiplyScalar(Fx).addScaledVector(lw, Fy);
      this.applyAt(tmpB, w.rel);
      w.spinRate = vx / w.R;
    }

    // Soft wall at the edge of the map.
    const r = Math.hypot(pos.x, pos.z);
    if (r > MAX_RADIUS) {
      const over = r - MAX_RADIUS;
      force.x += (-pos.x / r) * over * MASS * 1.0 - vel.x * MASS * 0.5;
      force.z += (-pos.z / r) * over * MASS * 1.0 - vel.z * MASS * 0.5;
    }

    // Integrate velocities. Angular part is solved in body axes (gyroscopic term included).
    vel.addScaledVector(force, h / MASS);

    qInv.copy(q).invert();
    wb.copy(angVel).applyQuaternion(qInv);
    tb.copy(torque).applyQuaternion(qInv);
    iw.set(INERTIA.x * wb.x, INERTIA.y * wb.y, INERTIA.z * wb.z);
    gyro.crossVectors(wb, iw);
    wb.x += ((tb.x - gyro.x) / INERTIA.x) * h;
    wb.y += ((tb.y - gyro.y) / INERTIA.y) * h;
    wb.z += ((tb.z - gyro.z) / INERTIA.z) * h;
    angVel.copy(wb).applyQuaternion(q);
    const spin = angVel.length();
    angVel.multiplyScalar(1 - Math.min(0.5, (W_DRAG_LIN + W_DRAG_SQ * spin) * h));
    if (spin > W_LIMIT) angVel.setLength(W_LIMIT);

    this.solveHull(h);
    if (vel.length() > V_LIMIT) vel.setLength(V_LIMIT);

    pos.addScaledVector(vel, h);
    dq.set(angVel.x * h * 0.5, angVel.y * h * 0.5, angVel.z * h * 0.5, 0).multiply(q);
    q.set(q.x + dq.x, q.y + dq.y, q.z + dq.z, q.w + dq.w).normalize();
  }
}

// ---------- the hover glider ----------
// No wheels at all: a body held up on lift fans at a chosen height over whatever is
// underneath — ground, rocks, a bridge deck or water — and pushed along by its rear
// turbines. Shift climbs, Ctrl sinks (to 15 m at most); W/S and A/D as usual. It
// cannot roll over: it banks into turns and pitches with the throttle, for the look.
// Same public shape as VehicleSim, so the rest of the game drives it unchanged.
const HV = {
  altMin: 0.7, // lowest hover: belly a hand's breadth over the ground
  altMax: 15,
  climb: 4.5, // m/s the target height moves while Shift/Ctrl is held
  belly: 0.75, // origin above the lowest point of the hull
  k: 7, // height spring, 1/s²
  c: 4.5, // and its damping, 1/s
  acc: 9, // m/s² of push at full throttle
  turn: 1.15, // rad/s of yaw at full lock
  sink: 3, // m/s: how fast it lets itself down when the ground falls away
};
const _hvOut = { x: 0, z: 0 };
const _hvE = new THREE.Euler(0, 0, 0, 'YXZ');
export class HoverSim {
  constructor() {
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.cmd = { throttle: 0, brake: 0, steer: 0, parked: false, boost: false };
    this.speed = 0;
    this.upY = 1;
    this.maxSteer = 1;
    this.awd = true;
    this.powerMul = 1;
    this.suspMul = 1;
    this.gripMul = 1;
    this.rollMul = 1;
    this.dragMul = 1;
    this.wheels = [];
    this.alt = HV.altMin; // target height of the belly over the ground
    this.heading = 0;
    this.yawRate = 0;
    this.pitch = 0;
    this.bank = 0;
    this.reset(0, 0, 0.6);
  }

  reset(x, z, heading) {
    this.heading = heading;
    this.alt = HV.altMin;
    this.gRef = this.floor(x, z);
    this.pos.set(x, this.gRef + HV.altMin + HV.belly, z);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.yawRate = 0;
    this.pitch = 0;
    this.bank = 0;
    this.cmd.throttle = 0;
    this.cmd.steer = 0;
    this.refresh();
  }

  // What it hovers over: ground (with rocks and bridge decks) or the water surface.
  floor(x, z) {
    setDeckRef(this.pos.y);
    const g = groundHeight(x, z);
    return waterDepthAt(x, z) > 0 ? Math.max(g, waterLevelAt(x, z)) : g;
  }

  origin(out) {
    return out.copy(this.pos);
  }

  yaw() {
    return this.heading;
  }

  refresh() {
    this.quat.setFromEuler(_hvE.set(this.pitch, this.heading, this.bank));
    this.upY = Math.cos(this.pitch) * Math.cos(this.bank);
    this.speed = this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading);
  }

  // input: throttle, steer (left +), brake, climb (-1..1: Ctrl..Shift), steerTo (autopilot)
  update(dt, input) {
    dt = Math.min(dt, 0.05);
    const c = this.cmd;
    c.throttle = damp(c.throttle, clamp(input.throttle || 0, -1, 1), 6, dt);
    const want = input.steerTo !== undefined ? clamp(input.steerTo, -1, 1) : clamp(input.steer || 0, -1, 1);
    c.steer = damp(c.steer, want, 6, dt);
    c.brake = input.brake || 0;
    c.boost = false;
    c.parked = false;
    this.alt = clamp(this.alt + (input.climb || 0) * HV.climb * dt, HV.altMin, HV.altMax);

    // Hold the height over the ground here and a little ahead, so it rises over a
    // ridge before reaching it instead of ploughing into the face.
    const p = this.pos;
    const v = this.vel;
    const g0 = this.floor(p.x, p.z);
    const gA = this.floor(p.x + v.x * 0.7, p.z + v.z * 0.7);
    const gB = this.floor(p.x + v.x * 1.4, p.z + v.z * 1.4);
    const ground = Math.max(g0, gA - 0.5, gB - 1.5);
    // Rising ground is followed at once; ground that drops away (a cliff edge, a
    // canyon) is followed down gently, so it glides out over the drop instead of
    // falling into it.
    this.gRef = ground > this.gRef ? ground : Math.max(ground, this.gRef - HV.sink * dt);
    const target = this.gRef + this.alt + HV.belly;
    v.y += (HV.k * (target - p.y) - HV.c * v.y) * dt;

    // Push along the heading; drag sets the top speed; sideways drift dies away.
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    // The motor upgrade buys a little more top speed and a lot more shove.
    const vMax = SPEC.vMax * (1 + 0.15 * (this.powerMul - 1));
    const acc = HV.acc * (1 + 0.4 * (this.powerMul - 1));
    let vf = v.x * fx + v.z * fz;
    let vs = v.x * fz - v.z * fx;
    vf += c.throttle * acc * dt;
    vf -= vf * (acc / vMax) * dt * (c.throttle * vf > 0 ? 1 : 0.6);
    if (c.brake) vf *= Math.exp(-2.5 * dt);
    vs *= Math.exp(-2.2 * dt);
    v.x = fx * vf + fz * vs;
    v.z = fz * vf - fx * vs;

    // Turning: yaw rate eases toward the stick; a little less at full speed.
    const turnWant = c.steer * HV.turn * (1 - 0.3 * Math.min(1, Math.abs(vf) / vMax));
    this.yawRate = damp(this.yawRate, turnWant, 4, dt);
    this.heading += this.yawRate * dt;

    p.addScaledVector(v, dt);

    // Never through the ground: a hard floor under the belly.
    const gNow = this.floor(p.x, p.z);
    if (p.y < gNow + 0.35) {
      p.y = gNow + 0.35;
      if (v.y < 0) v.y = 0;
    }
    // Buildings and other solids push it out sideways, losing the speed into them.
    const depth = landmarkWall(p.x, p.y - HV.belly + 0.3, p.z, _hvOut);
    if (depth > 0) {
      p.x += _hvOut.x * depth;
      p.z += _hvOut.z * depth;
      const into = v.x * _hvOut.x + v.z * _hvOut.z;
      if (into < 0) {
        v.x -= _hvOut.x * into * 1.3;
        v.z -= _hvOut.z * into * 1.3;
      }
    }

    // Lean for the look: nose dips under thrust, it banks into a turn.
    this.pitch = damp(this.pitch, clamp(-c.throttle * 0.08 + v.y * 0.015, -0.2, 0.2), 3, dt);
    this.bank = damp(this.bank, clamp(-this.yawRate * vf * 0.03, -0.35, 0.35), 3, dt);
    this.angVel.set(0, this.yawRate, 0);
    this.refresh();
  }

  // How high the belly is over what's below (for the HUD and the shadow).
  height() {
    return this.pos.y - HV.belly - this.floor(this.pos.x, this.pos.z);
  }
}
