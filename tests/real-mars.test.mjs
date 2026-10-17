// The Jezero DTM is the ground on Mars: heights follow the data, and the road across
// it stays drivable.
import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

if (process.env.TEST_PLANET && process.env.TEST_PLANET !== 'mars') process.exit(0);
const { REAL } = await import('../src/real-mars.js');
const { terrainHeight, ROUTE_PTS, ROUTE_LEN, BASES, roadDist } = await import('../src/terrain.js');

test('the real map loaded', () => {
  assert.ok(REAL, 'REAL is null: textures/mars/jezero-height.bin missing?');
  assert.equal(REAL.meta.mppX, 20);
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
