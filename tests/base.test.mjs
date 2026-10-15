// The bases (base-layout.js, drawn by base.js, made solid by terrain.js): both are
// built, their buildings are solid, and everything the game sends you to at a base —
// the road in, the spawn spot, the pads, the cargo crates, Верданта's lab — is clear.
//   TEST_PLANET=moon node --test tests/base.test.mjs
import './env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const T = await import('../src/terrain.js');
const { buildBase } = await import('../src/base.js');
const { PLANET } = await import('../src/planet.js');
const { BASES, basePoint, landmarkWall, groundHeight, roadSpawn, ROUTE_PTS, LAB } = T;

const n = { x: 0, z: 0 };
// Wall depth at hull height (the rover's hull points ride about 0.5–1.5 m up).
const wallAt = (x, z) => Math.max(...[0.5, 1, 1.5].map((h) => landmarkWall(x, groundHeight(x, z) + h, z, n)));
// Deepest wall anywhere along a straight drive from a to b, across a rover's width.
function deepestAlong(a, b, halfW = 1.6) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  let worst = 0;
  for (let d = 0; d <= len; d += 0.5) {
    for (const s of [-halfW, 0, halfW]) worst = Math.max(worst, wallAt(a.x + ux * d - uz * s, a.z + uz * d + ux * s));
  }
  return worst;
}

for (const b of BASES) {
  const L = b.layout;
  const W = (p) => basePoint(b, p.x, p.z);

  test(`${b.name}: the base is built`, () => {
    const built = buildBase(b);
    let meshes = 0;
    let tris = 0;
    const mats = new Set();
    built.group.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      mats.add(o.material);
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    console.log(`  ${b.name}: ${meshes} meshes, ${Math.round(tris)} triangles, ${L.domes.length} domes, ${L.tubes.length + L.spokes.length} tubes${L.ring ? ' + ring' : ''}, ${L.solar.length} solar fields, ${L.pads.length} pads`);
    // Baked per material: a whole base is a couple of dozen draw calls at most.
    assert.ok(meshes >= 10 && meshes <= 24, `unexpected mesh count ${meshes}`);
    assert.ok(tris > 8000, 'suspiciously few triangles — did the domes get built?');
    assert.equal([...mats].filter((m) => m.transparent && !m.blending).length <= 1, true, 'more than one see-through glass material');
    assert.ok(L.domes.some((d) => d.kind === 'glass') && L.domes.some((d) => d.kind === 'green'), 'needs clear and greenhouse domes');
    assert.ok(L.solar.length >= 1 && L.pads.length >= 2);
  });

  test(`${b.name}: domes, corridors and solar fields are solid`, () => {
    for (const d of L.domes) {
      const p = W(d);
      assert.ok(wallAt(p.x, p.z) > d.r * 0.8, `dome at ${d.x},${d.z} is not solid in the middle`);
    }
    for (const [i, j] of L.tubes) {
      const p = W({ x: (L.domes[i].x + L.domes[j].x) / 2, z: (L.domes[i].z + L.domes[j].z) / 2 });
      assert.ok(wallAt(p.x, p.z) > 0, 'a corridor is drive-through');
    }
    if (L.ring) {
      const p = W({ x: L.ring.x + L.ring.r * Math.cos(0.4), z: L.ring.z + L.ring.r * Math.sin(0.4) });
      assert.ok(wallAt(p.x, p.z) > 0, 'the ring corridor is drive-through');
    }
    for (const f of L.solar) {
      const p = W(f);
      assert.ok(wallAt(p.x, p.z) > 0, 'a solar field is drive-through');
    }
  });

  test(`${b.name}: road, spawn, pads and cargo are clear`, () => {
    const atEnd = b === BASES[1];
    const sp = roadSpawn(atEnd);
    const pad = W(L.pads[0]);
    const cargo = W(L.pads[1]);
    assert.equal(deepestAlong({ x: sp.x - 2, z: sp.z - 2 }, { x: sp.x + 2, z: sp.z + 2 }, 2.5), 0, 'the spawn spot is inside a building');
    assert.equal(deepestAlong(sp, pad), 0, 'the straight drive from the spawn to the main pad hits something');
    assert.equal(deepestAlong(pad, cargo), 0, 'the drive from the main pad to the cargo pad hits something');
    // The road itself, wherever it runs within the base.
    for (const p of ROUTE_PTS) {
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < 75) assert.equal(wallAt(p.x, p.z), 0, `the road is blocked ${d.toFixed(0)} m from the base`);
    }
    // The crates jobs.js leaves for pick-up (cargo pad, and 5,-4 m off it).
    assert.equal(wallAt(b.cargo.x, b.cargo.z) + wallAt(b.cargo.x + 5, b.cargo.z - 4), 0, 'the cargo crates sit in a building');
    // Every pad all round its rim, and each reachable from the centre of the main pad.
    for (const p of L.pads) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const q = W({ x: p.x + Math.cos(a) * p.r, z: p.z + Math.sin(a) * p.r });
        assert.equal(wallAt(q.x, q.z), 0, `pad at ${p.x},${p.z} overlaps a building`);
      }
    }
  });
}

test('Верданта: the seed lab beside АЛЬФА stays clear of the base', { skip: PLANET !== 'verdanta' }, () => {
  // Drive from the main pad to the lab's delivery circle (30 m, seeds.js).
  const b = BASES[0];
  const pad = basePoint(b, b.layout.pads[0].x, b.layout.pads[0].z);
  const len = Math.hypot(LAB.x - pad.x, LAB.z - pad.z);
  const end = { x: pad.x + ((LAB.x - pad.x) / len) * (len - 24), z: pad.z + ((LAB.z - pad.z) / len) * (len - 24) };
  assert.equal(deepestAlong(pad, end), 0, 'the base is in the way of the lab');
});
