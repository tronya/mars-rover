// Crossing records: only real legs count, only improvements are kept, each region/chassis/
// direction has its own book.
import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { recordLeg, bestOf, fmtTime } = await import('../src/records.js');
const leg = { region: 'jezero', chassis: 'truck', from: 'АЛЬФА', to: 'БЕТА' };

test('a leg under a minute is not a record', () => {
  const r = recordLeg(leg, 20);
  assert.equal(r.counted, false);
  assert.equal(bestOf(leg), null);
});

test('the first real leg is a record; slower ones are not; faster ones are', () => {
  assert.deepEqual(recordLeg(leg, 700), { counted: true, isNew: true, best: 700, prev: null });
  const slower = recordLeg(leg, 800);
  assert.equal(slower.isNew, false);
  assert.equal(slower.best, 700);
  const faster = recordLeg(leg, 650.46);
  assert.equal(faster.isNew, true);
  assert.equal(bestOf(leg), 650.5);
  assert.equal(faster.prev, 700);
});

test('direction, chassis and region keep separate records', () => {
  assert.equal(bestOf({ ...leg, from: 'БЕТА', to: 'АЛЬФА' }), null);
  assert.equal(bestOf({ ...leg, chassis: 'speedster' }), null);
  assert.equal(bestOf({ ...leg, region: 'gale' }), null);
  assert.equal(recordLeg({ ...leg, region: 'gale' }, 900).isNew, true);
});

test('times read as m:ss, with hours when needed', () => {
  assert.equal(fmtTime(59.6), '1:00');
  assert.equal(fmtTime(125), '2:05');
  assert.equal(fmtTime(3725), '1:02:05');
});
