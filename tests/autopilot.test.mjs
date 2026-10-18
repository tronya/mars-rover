import test from 'node:test';
import assert from 'node:assert/strict';
import { apSpeed, AP_CRUISE } from '../src/autopilot.js';

const flat = () => 0;
const base = { ground: flat, x: 0, z: 0, heading: 0, turnErr: 0, dist: 500, last: false };

test('flat ground, straight: full cruise', () => assert.equal(apSpeed(base), AP_CRUISE));
test('a sharp turn slows it', () => assert.ok(apSpeed({ ...base, turnErr: 1.5 }) < 0.5 * AP_CRUISE));
test('a steep descent slows it', () => {
  const v = apSpeed({ ...base, ground: (x, z) => -0.4 * z });
  assert.ok(v < 0.6 * AP_CRUISE, `${v}`);
});
test('a side slope slows it', () => {
  const v = apSpeed({ ...base, ground: (x) => 0.4 * x });
  assert.ok(v < 0.6 * AP_CRUISE, `${v}`);
});
test('it slows for the final waypoint but not for a mid-route one', () => {
  assert.ok(apSpeed({ ...base, last: true, dist: 15 }) < 8);
  assert.equal(apSpeed({ ...base, last: false, dist: 15 }), AP_CRUISE);
  assert.ok(apSpeed({ ...base, last: true, dist: 0 }) >= 1.5);
});
test('leaning hard slows it', () => assert.ok(apSpeed({ ...base, upY: 0.6 }) < 0.5 * AP_CRUISE));
test('a boulder ahead caps the speed so it can stop', () => {
  assert.ok(apSpeed({ ...base, obstacle: 30 }) < 10);
  assert.ok(apSpeed({ ...base, obstacle: 7 }) < 3.5);
  assert.equal(apSpeed({ ...base, obstacle: 200 }), AP_CRUISE);
});
