// The best-time ghost: recording, replay, and where you stand against it.
import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { createRecorder, ghostAt, ghostTimeAt, saveGhost, loadGhost } = await import('../src/ghost.js');

// a leg of 100 s along +x at 10 m/s
function leg() {
  const r = createRecorder();
  for (let t = 0; t <= 100; t += 1 / 60) r.sample(t, t * 10, 0, 0);
  return r.finish(100, 1000, 0, 0);
}

test('the recorder keeps about four samples a second', () => {
  const track = leg();
  assert.ok(track.length > 360 && track.length < 420, `got ${track.length}`);
  assert.deepEqual(track[track.length - 1], [100, 1000, 0, 0]);
});

test('replay interpolates in time and stops at the end', () => {
  const track = leg();
  const mid = ghostAt(track, 50);
  assert.ok(Math.abs(mid.x - 500) < 3 && mid.z === 0, `mid ${mid.x}`);
  assert.equal(ghostAt(track, 0).x, 0);
  const end = ghostAt(track, 500);
  assert.ok(end.done && end.x === 1000);
  assert.equal(ghostAt([], 5), null);
});

test('yaw turns the short way round', () => {
  const track = [[0, 0, 0, 3.0], [1, 1, 0, -3.0]];
  const g = ghostAt(track, 0.5);
  assert.ok(Math.abs(Math.abs(g.yaw) - Math.PI) < 0.2, 'went the long way through zero');
});

test('standing against the ghost: ahead or behind in seconds', () => {
  const track = leg();
  const here = ghostTimeAt(track, 400, 0, 0);
  assert.ok(Math.abs(here.time - 40) < 0.5, `ghost passed x=400 at ${here.time}`);
  // you reach x=400 at 35 s: 5 s ahead
  assert.ok(Math.abs((here.time - 35) - 5) < 0.5);
  // searching forward from a hint never goes back
  const later = ghostTimeAt(track, 400, 0, here.index);
  assert.equal(later.index, here.index);
});

test('saved and loaded per region, chassis and direction', () => {
  const c = { region: 'jezero', chassis: 'truck', from: 'АЛЬФА', to: 'БЕТА' };
  assert.equal(loadGhost(c), null);
  saveGhost(c, leg());
  assert.equal(loadGhost(c).length, leg().length);
  assert.equal(loadGhost({ ...c, chassis: 'buggy' }), null);
});
