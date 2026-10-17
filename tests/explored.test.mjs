// The explored map: marking within a radius, counting, saving and loading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplored } from '../src/explored.js';

const make = () => createExplored(101, 101, -2500, -2500, 50); // a 5 km map, 50 m cells

test('driving marks a disc, and only new cells are reported', () => {
  const e = make();
  const first = e.mark(0, 0, 200);
  assert.ok(first.length > 40 && first.length < 80, `a 200 m disc is about 50 cells, got ${first.length}`);
  assert.equal(e.mark(0, 0, 200).length, 0, 'marking the same place again adds nothing');
  assert.ok(e.mark(100, 0, 200).length > 0, 'moving on reveals more');
  assert.ok(e.fraction() > 0 && e.fraction() < 0.05);
});

test('the edge of the map is safe', () => {
  const e = make();
  assert.doesNotThrow(() => { e.mark(-9999, -9999, 300); e.mark(2500, 2500, 100); });
  e.mark(0, 0, 5000);
  assert.equal(e.fraction(), 1, 'a huge disc covers everything');
});

test('encode and decode round-trip, and refuse a map of another shape', () => {
  const a = make();
  a.mark(0, 0, 600); a.mark(1200, -800, 300);
  const text = a.encode();
  assert.ok(text.length < a.size, 'the packing is shorter than the grid');
  const b = make();
  const set = b.decode(text);
  assert.equal(b.fraction(), a.fraction());
  assert.equal(set.length, Math.round(a.fraction() * a.size));
  for (let k = 0; k < a.size; k++) assert.equal(b.has(k), a.has(k));
  assert.equal(createExplored(50, 50, 0, 0, 50).decode(text), null, 'another shape must be refused');
  assert.equal(b.decode('junk'), null);
});
