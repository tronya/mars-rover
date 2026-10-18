// Drives the rover through the same scenarios on both physics engines — the
// hand-written one (physics.js) and Rapier (rapier-sim.js) — and checks the Rapier
// one behaves like a rover: sits on its wheels, accelerates forward, brakes, turns,
// survives rough ground. Old-sim numbers are the reference.
//   node --test tests/
import './env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { VehicleSim } = await import('../src/physics.js');
const { createRapierSim } = await import('../src/rapier-sim.js');
const { groundHeight, roadSpawn } = await import('../src/terrain.js');
// Tests start where the road is graded: the map's middle (0, 0) is steep rock on real Gale.
const START = roadSpawn(false); // heading: along the road, so a test that drives straight stays clear of the base

const DT = 1 / 60;
function run(sim, seconds, input) {
  for (let t = 0; t < seconds; t += DT) sim.update(DT, typeof input === 'function' ? input(t) : input);
}
const IDLE = { throttle: 0, steer: 0, brake: 0 };
async function both(x = START.x, z = START.z, heading = START.yaw) {
  const a = new VehicleSim();
  a.reset(x, z, heading);
  const b = await createRapierSim();
  b.reset(x, z, heading);
  return [a, b];
}
const clearance = (s) => s.pos.y - groundHeight(s.pos.x, s.pos.z);
const fmt = (n) => n.toFixed(2);

test('settles on its wheels at rest', async () => {
  const [a, b] = await both();
  run(a, 3, IDLE);
  run(b, 3, IDLE);
  console.log(`  rest: old clearance ${fmt(clearance(a))}  rapier ${fmt(clearance(b))}  rapier |v| ${fmt(b.vel.length())}`);
  assert.ok(b.vel.length() < 0.3, 'still moving at rest');
  assert.ok(b.upY > 0.95, 'not upright');
  assert.ok(b.wheels.every((w) => w.contact), 'a wheel is off the ground');
  assert.ok(Math.abs(clearance(b) - clearance(a)) < 0.35, 'ride height differs from the old sim');
});

test('accelerates forward', async () => {
  const [a, b] = await both();
  run(a, 1, IDLE); run(b, 1, IDLE);
  const a0 = a.pos.clone(), b0 = b.pos.clone();
  run(a, 5, { throttle: 1, steer: 0, brake: 0 });
  run(b, 5, { throttle: 1, steer: 0, brake: 0 });
  const da = a.pos.distanceTo(a0), db = b.pos.distanceTo(b0);
  console.log(`  5 s full throttle: old ${fmt(da)} m at ${fmt(a.speed)} m/s, rapier ${fmt(db)} m at ${fmt(b.speed)} m/s`);
  assert.ok(b.speed > 0, 'went backwards');
  assert.ok(db > da * 0.6 && db < da * 1.5, 'distance far from the old sim');
});

test('brakes to a stop', async () => {
  const [a, b] = await both();
  for (const s of [a, b]) run(s, 6, { throttle: 1, steer: 0, brake: 0 });
  const stopTime = (s) => {
    let t = 0;
    while (Math.abs(s.speed) > 0.3 && t < 20) { s.update(DT, { throttle: 0, steer: 0, brake: 1 }); t += DT; }
    return t;
  };
  const va = a.speed, vb = b.speed;
  const ta = stopTime(a), tb = stopTime(b);
  console.log(`  brake: old ${fmt(va)} m/s → 0 in ${fmt(ta)} s, rapier ${fmt(vb)} m/s → 0 in ${fmt(tb)} s`);
  assert.ok(tb < 20, 'never stopped');
  assert.ok(tb < ta * 2.5 + 0.5, 'brakes much weaker than the old sim');
});

test('turns the way it is steered', async () => {
  const [a, b] = await both();
  for (const s of [a, b]) run(s, 1, IDLE);
  const ya = a.yaw(), yb = b.yaw();
  for (const s of [a, b]) run(s, 4, { throttle: 0.6, steer: 1, brake: 0 });
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  const ta = wrap(a.yaw() - ya), tb = wrap(b.yaw() - yb);
  console.log(`  steer left 4 s: old turned ${fmt(ta)} rad, rapier ${fmt(tb)} rad`);
  assert.equal(Math.sign(tb), Math.sign(ta), 'turns the wrong way');
  assert.ok(Math.abs(tb) > 0.3, 'barely turns');
});

test('survives 40 s of rough driving', async () => {
  const [, b] = await both();
  let minClear = Infinity, flips = 0;
  run(b, 40, (t) => {
    minClear = Math.min(minClear, clearance(b));
    if (b.upY < 0) flips++;
    return { throttle: t % 10 < 8 ? 1 : -1, steer: Math.sin(t * 0.7), brake: 0, boost: t % 20 > 15 };
  });
  const fin = Number.isFinite(b.pos.x + b.pos.y + b.pos.z);
  console.log(`  40 s rough drive: travelled to (${fmt(b.pos.x)}, ${fmt(b.pos.z)}), lowest clearance ${fmt(minClear)} m, frames upside down ${flips}`);
  assert.ok(fin, 'position became NaN');
  assert.ok(minClear > -0.3, 'fell through the ground');
});

test('reset puts it back upright on the ground', async () => {
  const [, b] = await both();
  // On the graded road, where no boulder can land under the hull whatever the rock map.
  const { roadSpawn } = await import('../src/terrain.js');
  const at = roadSpawn(false);
  run(b, 3, { throttle: 1, steer: 1, brake: 0 });
  b.reset(at.x, at.z, 1);
  run(b, 2, IDLE);
  console.log(`  after reset: upY ${fmt(b.upY)}, clearance ${fmt(clearance(b))}`);
  assert.ok(b.upY > 0.95 && Math.abs(b.pos.x - at.x) < 2 && Math.abs(b.pos.z - at.z) < 2);
});

test('stops at a building wall instead of driving through', async () => {
  const { getLandmarks, landmarkWall } = await import('../src/terrain.js');
  // A box building in the settlement, found by probing for the wall itself so the
  // test doesn't depend on how a site's local frame is rotated.
  const site = getLandmarks().find((l) => l.type.id === 'settlement');
  const n = { x: 0, z: 0 };
  let target = null;
  for (const c of site.type.colliders.filter((c) => c.k === 'box' && c.w >= 6)) {
    for (const [cs, sn] of [[site.cos, site.sin], [site.cos, -site.sin]]) {
      const x = site.x + c.x * cs - c.z * sn, z = site.z + c.x * sn + c.z * cs;
      if (landmarkWall(x, groundHeight(x, z) + 1, z, n) > 0) { target = { x, z }; break; }
    }
    if (target) break;
  }
  assert.ok(target, 'no building found to drive at');
  const deepest = [], closest = [];
  for (const s of await both()) {
    const heading = 0.3;
    s.reset(target.x - Math.sin(heading) * 25, target.z - Math.cos(heading) * 25, heading);
    let deep = 0, near = Infinity;
    run(s, 9, () => {
      deep = Math.max(deep, landmarkWall(s.pos.x, s.pos.y, s.pos.z, n));
      near = Math.min(near, Math.hypot(s.pos.x - target.x, s.pos.z - target.z));
      return { throttle: 1, steer: 0, brake: 0 };
    });
    deepest.push(deep);
    closest.push(near);
  }
  console.log(`  into a wall: closest to the building centre — old ${fmt(closest[0])} m, rapier ${fmt(closest[1])} m; deepest inside — old ${fmt(deepest[0])}, rapier ${fmt(deepest[1])}`);
  assert.ok(closest[1] < 10, 'rapier rover never reached the building (test drove past it)');
  assert.ok(deepest[1] < 0.5, 'rapier rover drove into the building');
  assert.ok(closest[1] > 2, 'rapier rover reached the middle of the building');
});

test('stops at the base domes instead of driving into them', async () => {
  const { BASES, basePoint, landmarkWall } = await import('../src/terrain.js');
  const { SPEC } = await import('../src/chassis.js');
  // The body centre stops about half a hull length (plus wheels) short of the skin.
  const reach = SPEC.box.l / 2 + 3;
  const n = { x: 0, z: 0 };
  // АЛЬФА's shell dome on the left, БЕТА's front ring module, each driven at
  // head-on from 25 m out along the base's own -z (in from the road side).
  const targets = [[BASES[0], BASES[0].layout.domes[3]], [BASES[1], BASES[1].layout.domes[4]]];
  for (const [b, d] of targets) {
    const c = basePoint(b, d.x, d.z);
    const from = basePoint(b, d.x, d.z + d.r + 25);
    const heading = b.yaw + Math.PI;
    const res = [];
    for (const s of await both()) {
      s.reset(from.x, from.z, heading);
      let deep = 0, near = Infinity;
      run(s, 9, () => {
        deep = Math.max(deep, landmarkWall(s.pos.x, s.pos.y, s.pos.z, n));
        near = Math.min(near, Math.hypot(s.pos.x - c.x, s.pos.z - c.z));
        return { throttle: 1, steer: 0, brake: 0 };
      });
      res.push({ deep, near });
    }
    console.log(`  into ${b.name}'s dome (r ${d.r}): closest to its centre — old ${fmt(res[0].near)} m, rapier ${fmt(res[1].near)} m; deepest inside — old ${fmt(res[0].deep)}, rapier ${fmt(res[1].deep)}`);
    for (const [i, r] of res.entries()) {
      const who = i ? 'rapier' : 'old';
      assert.ok(r.near < d.r + reach, `${who} rover never reached ${b.name}'s dome`);
      assert.ok(r.near > d.r, `${who} rover got inside ${b.name}'s dome`);
      assert.ok(r.deep < 0.5, `${who} rover drove into ${b.name}'s dome`);
    }
  }
});

test('wheels turn with the ground speed and stop when the rover stops', async () => {
  const [, b] = await both();
  run(b, 3, { throttle: 1, steer: 0, brake: 0 });
  const w = b.wheels[0];
  const rolling = b.speed / w.R;
  console.log(`  wheel spin while driving ${fmt(w.spinRate)} rad/s (speed/R ${fmt(rolling)})`);
  assert.ok(Math.abs(w.spinRate - rolling) < Math.abs(rolling) * 0.35, 'wheel spin does not match the speed');
  run(b, 6, { throttle: 0, steer: 0, brake: 1 });
  console.log(`  after stopping ${fmt(w.spinRate)} rad/s`);
  assert.ok(Math.abs(w.spinRate) < 0.05, 'wheels keep turning with the rover stopped');
});

test('rides rough ground at least as smoothly as the old sim, and stays on its wheels', async () => {
  const { ride, classic, rapier, RIDE_ROUTES } = await import('./ride.mjs');
  const { SPEC } = await import('../src/chassis.js');
  const routes = RIDE_ROUTES;
  const sum = async (make) => {
    const rs = [];
    for (const [h, x, z] of routes) rs.push(await ride(make, 25, h, x, z));
    const avg = (k) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
    return { rms: avg('rms'), jolts: avg('jolts'), rolled: rs.filter((r) => !r.upright).length };
  };
  const a = await sum(classic), b = await sum(rapier);
  console.log(`  ride: old RMS ${fmt(a.rms)} g, ${fmt(a.jolts)} jolts/s, rolled ${a.rolled} · rapier RMS ${fmt(b.rms)} g, ${fmt(b.jolts)} jolts/s, rolled ${b.rolled}`);
  // 1.3 g floor: at 90 km/h the route-following depends on the steering travel left at that speed,
  // and one clipped boulder moves a heavy chassis's average a lot
  assert.ok(b.rms < Math.max(a.rms * 1.3, 1.3), 'shakes much harder than the old sim');
  assert.ok(b.jolts < Math.max(a.jolts * 1.5, 30), 'jolts much more often than the old sim');
  // A road car (the speedster) is not expected to cope with open rough ground.
  if (SPEC.terrain.offDrag < 3) assert.ok(b.rolled <= a.rolled, 'rolls over where the old sim did not');
});

test('R puts a rover lying on its roof back on its wheels', async () => {
  const THREE = await import('three');
  const [, b] = await both();
  run(b, 1, IDLE);
  // Roll it onto its roof and let it settle there.
  b.body.setTranslation({ x: b.pos.x, y: b.pos.y + 2, z: b.pos.z }, true);
  b.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
  run(b, 3, IDLE);
  assert.ok(b.upY < -0.5, 'did not end up on its roof for the test');
  // What main.js's righting does each frame for 0.8 s: ease the pose upright, then
  // hand it to the sim (syncFromSim) — the step Rapier needs to see the change.
  const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw());
  for (let t = 0; t < 0.8; t += DT) {
    b.quat.slerp(want, 1 - Math.exp(-9 * DT));
    b.pos.y += (groundHeight(b.pos.x, b.pos.z) + 2.2 - b.pos.y) * 0.2;
    b.vel.multiplyScalar(0.8);
    b.angVel.multiplyScalar(0.8);
    b.refresh();
    b.syncFromSim();
    b.update(0.0001, { throttle: 0, steer: 0, brake: 1 });
  }
  run(b, 2, IDLE);
  console.log(`  after R: upY ${fmt(b.upY)}, wheels down ${b.wheels.filter((w) => w.contact).length}/${b.wheels.length}`);
  assert.ok(b.upY > 0.9, 'still not upright');
  assert.ok(b.wheels.every((w) => w.contact), 'not standing on all wheels');
});

test('a rover knocked onto its side stops rolling instead of barrel-rolling on', async () => {
  const [, b] = await both();
  run(b, 1, IDLE);
  // On its side, given a shove into a roll.
  b.body.setTranslation({ x: b.pos.x, y: b.pos.y + 1, z: b.pos.z }, true);
  b.body.setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }, true);
  b.body.setAngvel({ x: 0, y: 0, z: 3 }, true);
  run(b, 6, IDLE);
  const spin = b.angVel.length();
  console.log(`  rolled: spin after 6 s ${fmt(spin)} rad/s`);
  assert.ok(spin < 0.3, 'still rolling');
});

test('wheels spin up in the air under throttle and stop on the brake', async () => {
  const [, b] = await both();
  run(b, 1, IDLE);
  b.body.setTranslation({ x: b.pos.x, y: b.pos.y + 40, z: b.pos.z }, true);
  run(b, 0.5, { throttle: 1, steer: 0, brake: 0 });
  const up = b.wheels[0].spinRate;
  run(b, 0.4, { throttle: 0, steer: 0, brake: 1 });
  const braked = b.wheels[0].spinRate;
  console.log(`  in the air: throttle → ${fmt(up)} rad/s, brake → ${fmt(braked)} rad/s`);
  assert.ok(b.wheels.every((w) => !w.contact), 'not actually in the air');
  assert.ok(up > 5, 'wheels do not spin up in the air');
  assert.ok(Math.abs(braked) < Math.abs(up) * 0.1, 'brake does not stop them');
});
