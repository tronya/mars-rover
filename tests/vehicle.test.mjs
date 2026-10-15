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
