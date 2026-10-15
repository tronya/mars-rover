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
const { groundHeight } = await import('../src/terrain.js');

const DT = 1 / 60;
function run(sim, seconds, input) {
  for (let t = 0; t < seconds; t += DT) sim.update(DT, typeof input === 'function' ? input(t) : input);
}
const IDLE = { throttle: 0, steer: 0, brake: 0 };
async function both(x = 0, z = 0, heading = 0) {
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
  run(b, 3, { throttle: 1, steer: 1, brake: 0 });
  b.reset(200, 150, 1);
  run(b, 2, IDLE);
  console.log(`  after reset: upY ${fmt(b.upY)}, clearance ${fmt(clearance(b))}`);
  assert.ok(b.upY > 0.95 && Math.abs(b.pos.x - 200) < 2 && Math.abs(b.pos.z - 150) < 2);
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
  assert.ok(closest[1] < 9, 'rapier rover never reached the building (test drove past it)');
  assert.ok(deepest[1] < 0.5, 'rapier rover drove into the building');
  assert.ok(closest[1] > 2, 'rapier rover reached the middle of the building');
});
