import test from 'node:test';
import assert from 'node:assert/strict';
import { planStops, legLength, createExpedition } from '../src/expedition.js';

const places = [
  { x: 3000, z: 0, name: 'Б', letter: 'Б', blurb: 'b' },
  { x: 1000, z: 0, name: 'А', letter: 'А', blurb: 'a' },
  { x: 6000, z: 500, name: 'В', letter: 'В', blurb: 'c' },
  { x: 8000, z: 0, name: 'Г', letter: 'Г', blurb: 'd' },
];
const bases = [{ x: 0, z: 0, name: 'АЛЬФА' }, { x: 9000, z: 0, name: 'БЕТА' }];

test('stops go to the nearest place first and end at a base', () => {
  const s = planStops({ x: 0, z: 0 }, places, bases);
  assert.deepEqual(s.slice(0, 3).map((p) => p.name), ['А', 'Б', 'В']);
  assert.equal(s.at(-1).base, true);
  assert.equal(s.at(-1).name, 'база АЛЬФА'); // the base furthest from the last stop: a real way home
});
test('a place right under you is skipped', () => {
  const s = planStops({ x: 1000, z: 10 }, places, bases);
  assert.ok(!s.some((p) => p.name === 'А'));
});
test('driving through every stop pays, a quick run pays more', () => {
  const fast = (() => {
    const e = createExpedition({ places, bases });
    const st = e.start(0, 0);
    let out;
    for (const s of st.stops) out = e.update(60, s.x, s.z);
    return out;
  })();
  const slow = (() => {
    const e = createExpedition({ places, bases });
    const st = e.start(0, 0);
    let out;
    for (const s of st.stops) out = e.update(6000, s.x, s.z);
    return out;
  })();
  assert.equal(fast.type, 'done');
  assert.ok(fast.pay > slow.pay, `${fast.pay} vs ${slow.pay}`);
  assert.ok(slow.pay >= 8);
});
test('cancel stops it, nothing to start with no places', () => {
  const e = createExpedition({ places, bases });
  e.start(0, 0);
  assert.equal(e.cancel().type, 'cancel');
  assert.equal(e.active, false);
  assert.equal(createExpedition({ places: [], bases: [bases[0]] }).start(0, 0), null);
  assert.ok(legLength({ x: 0, z: 0 }, [{ x: 3, z: 4 }]) === 5);
});
