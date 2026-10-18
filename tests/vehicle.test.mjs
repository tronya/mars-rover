// Every vehicle can be built from one page (the garage needs that), and comes out
// exactly as it did before vehicle.js became a factory: same meshes, vertex counts
// and extent as the fingerprints recorded from the original code.
//   node --test tests/vehicle.test.mjs
import './env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { vehicleKit } = await import('../src/vehicle.js');
const { fingerprint } = await import('./vehicle-fingerprint.mjs');
const expected = JSON.parse(readFileSync(new URL('./vehicle-fingerprints.json', import.meta.url)));

for (const id of Object.keys(expected)) {
  test(`builds ${id} identically from any page`, () => {
    assert.deepEqual(fingerprint(vehicleKit(id).buildVehicle()), expected[id]);
  });
}

test('the pilot leans into a hard stop and turns the head into a corner', () => {
  const v = vehicleKit('truck').buildVehicle();
  const pilots = [];
  v.root.traverse((o) => { if (o.userData.live) pilots.push(o.userData.live); });
  assert.ok(pilots.length >= 1, 'no live pilot found');
  for (let i = 0; i < 80; i++) v.setPilot(-8, 3, 0.8);
  const { lean, head } = pilots[0];
  assert.ok(lean.rotation.x > 0.15, 'no lean forward when braking');
  assert.ok(head.rotation.y < -0.4, 'head did not turn into the corner');
  for (let i = 0; i < 200; i++) v.setPilot(0, 0, 0);
  assert.ok(Math.abs(lean.rotation.x) < 0.01 && Math.abs(head.rotation.y) < 0.01, 'did not settle');
});
