// Tyre tracks: the tread pattern has what it needs (position across and along the rut), the
// berm's outer edge dissolves, and the trail breaks when a wheel leaves the ground.
import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { createTracks } = await import('../src/tracks.js');
const T = await import('../src/terrain.js');

function drive(tracks, metres, contact = true) {
  const z = T.ROUTE_PTS[0].z, x0 = T.ROUTE_PTS[0].x;
  for (let m = 0; m <= metres; m += 0.5) tracks.update([{ x: x0 + m, z, contact }]);
}

test('a drive lays a rut with across/along coordinates for the tread', () => {
  const tracks = createTracks(1, 100, 1.05);
  drive(tracks, 60);
  const tuv = tracks.mesh.geometry.attributes.tuv.array;
  let maxAlong = 0, maxAcross = 0, filled = 0;
  for (let i = 0; i < tuv.length; i += 2) {
    if (tuv[i + 1] > 0) filled++;
    maxAlong = Math.max(maxAlong, tuv[i + 1]);
    maxAcross = Math.max(maxAcross, Math.abs(tuv[i]));
  }
  assert.ok(filled > 100, 'nothing laid');
  assert.ok(maxAlong > 50 && maxAlong < 70, `along ${maxAlong}`);
  assert.ok(maxAcross > 1 && maxAcross <= 1.05001, `across ${maxAcross}`);
});

test('the outer edge of the berm is transparent, the floor of the rut is not', () => {
  const tracks = createTracks(1, 100, 1.05);
  drive(tracks, 30);
  const col = tracks.mesh.geometry.attributes.color.array;
  const tuv = tracks.mesh.geometry.attributes.tuv.array;
  let edge = 0, floor = 0;
  for (let v = 0; v < tuv.length / 2; v++) {
    const a = col[v * 4 + 3];
    if (a === 0 && tuv[v * 2 + 1] === 0) continue; // never written
    if (Math.abs(tuv[v * 2]) > 1) edge = Math.max(edge, a);
    if (Math.abs(tuv[v * 2]) > 0.4 && Math.abs(tuv[v * 2]) < 0.45) floor = Math.max(floor, a);
  }
  assert.equal(edge, 0, 'the berm edge should fade to nothing');
  assert.ok(floor > 0.5, `the rut floor should be solid (${floor})`);
});

test('a wheel in the air breaks the trail instead of bridging the gap', () => {
  const tracks = createTracks(1, 100, 1.05);
  drive(tracks, 20);
  const tuv = tracks.mesh.geometry.attributes.tuv.array;
  const count = () => { let n = 0; for (let i = 1; i < tuv.length; i += 2) if (tuv[i] > 0) n++; return n; };
  const before = count();
  drive(tracks, 20, false);
  assert.equal(count(), before, 'airborne wheel laid track');
});
