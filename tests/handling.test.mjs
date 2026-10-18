// How the rover behaves with a maxed build (3x motor, 1.45x grip): it must not stand on its
// tail when launched, and it must stay on its wheels when the wheel is held over at speed.
// Both physics engines; the chassis comes from TEST_CHASSIS (truck by default).
import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const { VehicleSim, steerAuthority } = await import('../src/physics.js');
const { createRapierSim } = await import('../src/rapier-sim.js');
const { roadSpawn } = await import('../src/terrain.js');
const { SPEC } = await import('../src/chassis.js');
const spawn = roadSpawn(false);
const CRUISE = Math.min(21, 0.6 * (SPEC.vMaxBoost || SPEC.vMax || 25)); // m/s: ~75 km/h on boost, or as fast as a slow chassis goes

async function make(engine) {
  const s = engine === 'rapier' ? await createRapierSim() : new VehicleSim();
  s.reset(spawn.x, spawn.z, spawn.yaw);
  s.powerMul = 3; s.gripMul = 1.45;
  for (let i = 0; i < 90; i++) s.update(1 / 60, { throttle: 0, steer: 0, brake: 0 });
  return s;
}
const pitchDeg = (s) => Math.asin(new THREE.Vector3(0, 0, 1).applyQuaternion(s.quat).y) * 180 / Math.PI;

test('steering travel shrinks with speed, never to nothing', () => {
  let last = 2;
  for (let v = 0; v <= 35; v += 1) {
    const a = steerAuthority(v, 1.45);
    assert.ok(a <= last + 1e-9, `grows at ${v} m/s`);
    assert.ok(a >= 0.06 && a <= 1, `out of range at ${v}`);
    last = a;
  }
  assert.equal(steerAuthority(2), 1, 'full lock when crawling');
  assert.ok(steerAuthority(22, 1.45) < 0.25, 'a couple of degrees at 80 km/h');
});

for (const engine of ['classic', 'rapier']) {
  test(`${engine}: a full-throttle start does not tip the nose up`, async () => {
    const s = await make(engine);
    let max = -99, min = 99;
    for (let i = 0; i < 60 * 6; i++) {
      s.update(1 / 60, { throttle: 1, steer: 0, brake: 0 });
      const p = pitchDeg(s);
      max = Math.max(max, p); min = Math.min(min, p);
    }
    console.log(`  ${engine}: pitch ${min.toFixed(1)}..${max.toFixed(1)} deg over a 6 s launch, ${(s.speed * 3.6).toFixed(0)} km/h`);
    const limit = SPEC.skidSteer ? 12 : 8; // a legged walker rocks more than a wheeled car
    assert.ok(max < limit && min > -limit, `wheelie or dive: ${min.toFixed(1)}..${max.toFixed(1)}`);
    assert.ok(s.speed > 8, 'the rover did not get going');
  });

  test(`${engine}: holding the wheel over at speed does not roll it`, { skip: SPEC.skidSteer && 'tank steering has its own limits' }, async () => {
    const s = await make(engine);
    for (let i = 0; i < 60 * 25; i++) s.update(1 / 60, { throttle: Math.min(1, (CRUISE - s.speed) * 0.5), steer: 0, brake: 0, boost: true });
    const v0 = s.speed * 3.6;
    let minUp = 1, side = 0;
    for (let i = 0; i < 60 * 4; i++) {
      s.update(1 / 60, { throttle: Math.min(1, (CRUISE - s.speed) * 0.5), steer: 1, brake: 0, boost: true });
      minUp = Math.min(minUp, s.upY);
      const y = s.yaw();
      side = Math.max(side, Math.abs(s.vel.x * Math.cos(y) - s.vel.z * Math.sin(y)));
    }
    console.log(`  ${engine}: from ${v0.toFixed(0)} km/h, wheel held over 4 s: min upY ${minUp.toFixed(2)}, sideways ${side.toFixed(1)} m/s`);
    assert.ok(v0 > 0.6 * CRUISE * 3.6, `did not reach speed (${v0.toFixed(0)} km/h)`);
    assert.ok(minUp > 0.5, `it rolled (upY ${minUp.toFixed(2)})`);
    assert.ok(side < 4, `it slid sideways at ${side.toFixed(1)} m/s`);
  });
}
