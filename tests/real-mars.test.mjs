// The Jezero DTM is the ground on Mars: heights follow the data, and the road across
// it stays drivable.
import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

if (process.env.TEST_PLANET && process.env.TEST_PLANET !== 'mars') process.exit(0);
if (process.env.TEST_REGION === 'classic') process.exit(0); // nothing real to test there
const { REAL } = await import('../src/real-mars.js');
const { terrainHeight, ROUTE_PTS, ROUTE_LEN, BASES, roadDist } = await import('../src/terrain.js');

test('the real map loaded', () => {
  assert.ok(REAL, 'REAL is null: textures/mars/jezero-height.bin missing?');
  assert.ok(REAL.meta.mppX === 20 || REAL.meta.mppX === 30);
});

test('far from the road the ground is the measured one', () => {
  let checked = 0;
  for (let x = -9000; x <= 9000 && checked < 12; x += 1500) for (const z of [-8000, 0, 8000]) {
    if (roadDist(x, z) < 400) continue;
    const want = REAL.height(x, z) - REAL.ref;
    assert.ok(Math.abs(terrainHeight(x, z) - want) < 1.5, `at ${x},${z}: ${terrainHeight(x, z)} vs ${want}`);
    checked++;
  }
  assert.ok(checked >= 6);
});

test('the road is graded: gentle slope along its whole length', () => {
  let worst = 0;
  for (let i = 1; i < ROUTE_PTS.length; i++) {
    const a = ROUTE_PTS[i - 1], b = ROUTE_PTS[i];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d < 5) continue;
    worst = Math.max(worst, Math.abs(terrainHeight(b.x, b.z) - terrainHeight(a.x, a.z)) / d);
  }
  console.log(`  road ${(ROUTE_LEN / 1000).toFixed(1)} km, steepest ${(worst * 100).toFixed(1)} %`);
  assert.ok(worst < 0.15, `road slope ${worst}`);
  assert.ok(ROUTE_LEN > 5000 && ROUTE_LEN < 14000);
});

test('bases sit level on their pads', () => {
  for (const b of BASES) {
    const h0 = terrainHeight(b.x, b.z);
    for (const [dx, dz] of [[40, 0], [-40, 0], [0, 40], [0, -40]]) {
      assert.ok(Math.abs(terrainHeight(b.x + dx, b.z + dz) - h0) < 1.2, `${b.name} not level`);
    }
  }
});

test('soft dust: none on the road, some off it, always 0..1', async () => {
  const { dustDepth } = await import('../src/terrain.js');
  assert.equal(dustDepth(ROUTE_PTS[10].x, ROUTE_PTS[10].z), 0);
  let max = 0;
  for (let x = -9000; x <= 9000; x += 600) for (let z = -9000; z <= 9000; z += 600) {
    const d = dustDepth(x, z);
    assert.ok(d >= 0 && d <= 1);
    max = Math.max(max, d);
  }
  assert.ok(max > 0.3, `no soft ground anywhere (max ${max})`);
});

test('soft dust slows the rover: same drive, bright ground vs clear ground', { skip: REAL.region !== 'jezero' && 'patches are picked on the Jezero map' }, async () => {
  const { VehicleSim } = await import('../src/physics.js');
  // two near-flat patches well off the road, found with tools-side scans: dust 1.0 vs 0
  const drive = (x, z, heading) => {
    const s = new VehicleSim();
    s.reset(x, z, heading);
    for (let i = 0; i < 60; i++) s.update(1 / 60, { throttle: 0, steer: 0, brake: 0 });
    const p0 = s.pos.clone();
    for (let i = 0; i < 60 * 12; i++) s.update(1 / 60, { throttle: 1, steer: 0, brake: 0 });
    return s.pos.distanceTo(p0);
  };
  const { dustDepth } = await import('../src/terrain.js');
  assert.ok(dustDepth(-5000, -1600) > 0.9 && dustDepth(-5400, -3000) < 0.05, 'test patches moved: rescan');
  let dust = 0, clear = 0;
  for (const h of [0, 1.5, 3]) { dust += drive(-5000, -1600, h); clear += drive(-5400, -3000, h); }
  console.log(`  12 s full throttle, 3 headings: dust ${(dust / 3).toFixed(1)} m, clear ${(clear / 3).toFixed(1)} m`);
  assert.ok(dust < clear * 0.99, 'dust did not slow the rover');
});

test('steep ground is broken up, flat ground and the road are not', () => {
  const rms = (pick) => {
    let sum = 0, n = 0;
    for (let x = -REAL.halfW + 2200; x < REAL.halfW - 2200 && n < 400; x += 211) for (let z = -REAL.halfH + 2200; z < REAL.halfH - 2200 && n < 400; z += 197) {
      if (roadDist(x, z) < 400 || !pick(REAL.slope(x, z))) continue;
      // deviation of the game ground from the smooth DTM, minus the small-noise layers' own size
      const d = terrainHeight(x, z) - (REAL.height(x, z) - REAL.ref);
      sum += d * d; n++;
    }
    return { rms: Math.sqrt(sum / Math.max(n, 1)), n };
  };
  const steep = rms((s) => s > 0.25), flat = rms((s) => s < 0.08);
  console.log(`  deviation from the DTM: steep ${steep.rms.toFixed(2)} m (${steep.n} pts), flat ${flat.rms.toFixed(2)} m (${flat.n} pts)`);
  assert.ok(steep.n >= 10 && flat.n >= 10, 'not enough sample points');
  assert.ok(steep.rms > flat.rms + 0.5, 'steep ground is not rougher than flat ground');
  assert.ok(flat.rms < 0.9, 'flat ground got noisy');
});

test('the road surface does not follow the crag noise', () => {
  for (const i of [5, 20, 40, Math.floor(ROUTE_PTS.length / 2)]) {
    const p = ROUTE_PTS[i];
    assert.ok(Math.abs(terrainHeight(p.x, p.z) - p.e) < 0.6, `road point ${i}: ${terrainHeight(p.x, p.z)} vs ${p.e}`);
  }
});
