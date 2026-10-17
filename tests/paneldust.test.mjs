// Dust on the solar wings: settles while driving, more on soft ground and in storms, shakes
// off on unfolding, and costs charge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stepDust, shakeOff, chargeFactor, SHAKE_KEEP } from '../src/paneldust.js';

const run = (seconds, ctx, d = 0) => { for (let t = 0; t < seconds; t++) d = stepDust(d, 1, ctx); return d; };

test('a clean wing charges fully, a dusty one loses up to half', () => {
  assert.equal(chargeFactor(0), 1);
  assert.equal(chargeFactor(1), 0.5);
  assert.ok(chargeFactor(0.4) > chargeFactor(0.8));
  assert.equal(chargeFactor(5), 0.5, 'clamped');
});

test('driving settles dust: more on soft ground, more at speed', () => {
  const bare = run(600, { speed: 10, soft: 0 });
  const deep = run(600, { speed: 10, soft: 1 });
  const slow = run(600, { speed: 3, soft: 1 });
  assert.equal(bare, 0, 'on bare ground the breeze keeps up with the settling');
  assert.ok(deep > 0.2 && deep < 0.5, `deep ${deep}`);
  assert.ok(deep > slow + 0.15, 'speed matters');
});

test('parked with the wings folded, the breeze slowly cleans them', () => {
  const left = run(600, { speed: 0 }, 0.5);
  assert.ok(Math.abs(left - 0.2) < 0.01, `left ${left}`);
});

test('wings open: no breeze cleaning', () => {
  assert.equal(run(600, { speed: 0, open: true }, 0.5), 0.5);
});

test('a storm buries the wings in minutes', () => {
  assert.ok(run(240, { speed: 0, storm: 1 }) > 0.9);
});

test('unfolding shakes a good part off, and never below zero or above one', () => {
  assert.equal(shakeOff(1), SHAKE_KEEP);
  assert.equal(shakeOff(0), 0);
  assert.equal(stepDust(0.5, 1e6, { speed: 0 }), 0);
  assert.equal(stepDust(0.5, 1e6, { speed: 20, soft: 1, storm: 1 }), 1);
});
