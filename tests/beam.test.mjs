// The headlight beam mask for night-time dust and sand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { beamLit } from '../src/beam.js';

// lamps at the origin, 1 m up, heading +z
const lit = (x, y, z) => beamLit(x, y, z, 0, 1, 0, 0, 1);

test('dead ahead is lit, behind and far to the side is not', () => {
  assert.ok(lit(0, 0.8, 10) > 0.4, 'dead ahead should be bright');
  assert.equal(lit(0, 0.8, -10), 0, 'behind the lamps');
  assert.equal(lit(30, 0.8, 10), 0, 'far off the beam');
  assert.equal(lit(0, 0.8, 0.3), 0, 'inside the lamp housing');
});

test('the beam fades with distance and ends at its range', () => {
  assert.ok(lit(0, 1, 8) > lit(0, 1, 40) && lit(0, 1, 40) > 0);
  assert.equal(lit(0, 1, 80), 0);
});

test('the beam widens with distance', () => {
  assert.equal(lit(4, 1, 5), 0, '4 m off at 5 m out is outside the cone');
  assert.ok(lit(8, 1, 40) > 0, '8 m off at 40 m out is inside it');
});

test('high above the beam is dark, a point on the ground in it is lit', () => {
  assert.ok(lit(0, 0.1, 15) > 0);
  assert.equal(lit(0, 14, 15), 0);
});

test('always inside 0..1', () => {
  for (let x = -20; x <= 20; x += 2) for (let y = -2; y <= 8; y += 1) for (let z = -5; z <= 90; z += 3) {
    const v = lit(x, y, z);
    assert.ok(v >= 0 && v <= 1, `${x},${y},${z}: ${v}`);
  }
});
