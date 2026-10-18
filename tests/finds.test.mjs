import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { placeFinds } = await import('../src/finds.js');

const line = Array.from({ length: 101 }, (_, i) => ({ x: i * 40, z: 0 }));
let s = 7;
const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

test('finds lie 45-120 m off the road, spread along it, on both sides', () => {
  const f = placeFinds(line, rand, 6);
  assert.equal(f.length, 6);
  for (const p of f) assert.ok(Math.abs(p.z) >= 45 && Math.abs(p.z) <= 120, `off ${p.z}`);
  const xs = f.map((p) => p.x);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], 'not in order along the road');
  assert.ok(f.some((p) => p.z > 0) && f.some((p) => p.z < 0));
});
test('too short a route gives none', () => assert.deepEqual(placeFinds([{ x: 0, z: 0 }], rand), []));
