// The Jezero DTM is the ground on Mars: heights follow the data, and the road across
// it stays drivable.
import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

if (process.env.TEST_PLANET && process.env.TEST_PLANET !== 'mars') process.exit(0);
if (process.env.TEST_REGION === 'classic') process.exit(0); // nothing real to test there
const { REAL, REAL_PLACES } = await import('../src/real-mars.js');
const { terrainHeight, groundHeight, smallCraters, sandRipples, dustDepth, ROUTE_PTS, ROUTE_LEN, BASES, roadDist } = await import('../src/terrain.js');

test('the real map loaded', () => {
  assert.ok(REAL, 'REAL is null: textures/mars/jezero-height.bin missing?');
  assert.ok(REAL.meta.mppX === 20 || REAL.meta.mppX === 30);
});

test('far from the road the ground is the measured one', () => {
  let checked = 0;
  for (let x = -9000; x <= 9000 && checked < 12; x += 1500) for (const z of [-8000, 0, 8000]) {
    if (roadDist(x, z) < 400) continue;
    const want = REAL.height(x, z) - REAL.ref;
    assert.ok(Math.abs(terrainHeight(x, z) - want) < 1.5, `at ${x},${z}: ${terrainHeight(x, z)} vs ${want}`);
    checked++;
  }
  assert.ok(checked >= 6);
});

test('the road is graded: gentle slope along its whole length', () => {
  let worst = 0;
  for (let i = 1; i < ROUTE_PTS.length; i++) {
    const a = ROUTE_PTS[i - 1], b = ROUTE_PTS[i];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d < 5) continue;
    worst = Math.max(worst, Math.abs(terrainHeight(b.x, b.z) - terrainHeight(a.x, a.z)) / d);
  }
  console.log(`  road ${(ROUTE_LEN / 1000).toFixed(1)} km, steepest ${(worst * 100).toFixed(1)} %`);
  assert.ok(worst < 0.15, `road slope ${worst}`);
  assert.ok(ROUTE_LEN > 5000 && ROUTE_LEN < 14000);
});

test('bases sit level on their pads', () => {
  for (const b of BASES) {
    const h0 = terrainHeight(b.x, b.z);
    for (const [dx, dz] of [[40, 0], [-40, 0], [0, 40], [0, -40]]) {
      assert.ok(Math.abs(terrainHeight(b.x + dx, b.z + dz) - h0) < 1.2, `${b.name} not level`);
    }
  }
});

test('soft dust: none on the road, some off it, always 0..1', async () => {
  const { dustDepth } = await import('../src/terrain.js');
  assert.equal(dustDepth(ROUTE_PTS[10].x, ROUTE_PTS[10].z), 0);
  let max = 0;
  for (let x = -9000; x <= 9000; x += 600) for (let z = -9000; z <= 9000; z += 600) {
    const d = dustDepth(x, z);
    assert.ok(d >= 0 && d <= 1);
    max = Math.max(max, d);
  }
  assert.ok(max > 0.3, `no soft ground anywhere (max ${max})`);
});

test('soft dust slows the rover: same drive, bright ground vs clear ground', { skip: REAL.region !== 'jezero' && 'patches are picked on the Jezero map' }, async () => {
  const { VehicleSim } = await import('../src/physics.js');
  // two near-flat patches well off the road, found with tools-side scans: dust 1.0 vs 0
  const drive = (x, z, heading) => {
    const s = new VehicleSim();
    s.reset(x, z, heading);
    for (let i = 0; i < 60; i++) s.update(1 / 60, { throttle: 0, steer: 0, brake: 0 });
    const p0 = s.pos.clone();
    for (let i = 0; i < 60 * 12; i++) s.update(1 / 60, { throttle: 1, steer: 0, brake: 0 });
    return s.pos.distanceTo(p0);
  };
  const { dustDepth } = await import('../src/terrain.js');
  assert.ok(dustDepth(-5000, -1600) > 0.9 && dustDepth(-5400, -3000) < 0.05, 'test patches moved: rescan');
  let dust = 0, clear = 0;
  for (const h of [0, 1.5, 3]) { dust += drive(-5000, -1600, h); clear += drive(-5400, -3000, h); }
  console.log(`  12 s full throttle, 3 headings: dust ${(dust / 3).toFixed(1)} m, clear ${(clear / 3).toFixed(1)} m`);
  assert.ok(dust < clear * 0.99, 'dust did not slow the rover');
});

test('steep ground is broken up, flat ground and the road are not', () => {
  const rms = (pick) => {
    let sum = 0, n = 0;
    for (let x = -REAL.halfW + 2200; x < REAL.halfW - 2200 && n < 400; x += 211) for (let z = -REAL.halfH + 2200; z < REAL.halfH - 2200 && n < 400; z += 197) {
      if (roadDist(x, z) < 400 || !pick(REAL.slope(x, z))) continue;
      // deviation of the game ground from the smooth DTM, minus the small-noise layers' own size
      // flat ground also carries the small craters and sand ripples (exactly, off the road on a <8% slope): take them out
      const d = terrainHeight(x, z) - (REAL.height(x, z) - REAL.ref) - (REAL.slope(x, z) < 0.08 ? smallCraters(x, z) + sandRipples(x, z) : 0);
      sum += d * d; n++;
    }
    return { rms: Math.sqrt(sum / Math.max(n, 1)), n };
  };
  const steep = rms((s) => s > 0.25), flat = rms((s) => s < 0.08);
  console.log(`  deviation from the DTM: steep ${steep.rms.toFixed(2)} m (${steep.n} pts), flat ${flat.rms.toFixed(2)} m (${flat.n} pts)`);
  assert.ok(steep.n >= 10 && flat.n >= 10, 'not enough sample points');
  assert.ok(steep.rms > flat.rms + 0.5, 'steep ground is not rougher than flat ground');
  assert.ok(flat.rms < 0.9, 'flat ground got noisy');
});

test('the road surface does not follow the crag noise', () => {
  for (const i of [5, 20, 40, Math.floor(ROUTE_PTS.length / 2)]) {
    const p = ROUTE_PTS[i];
    assert.ok(Math.abs(terrainHeight(p.x, p.z) - p.e) < 0.6, `road point ${i}: ${terrainHeight(p.x, p.z)} vs ${p.e}`);
  }
});

test('no boulder stands on the road strip', () => {
  let tallest = 0, at = null;
  for (let i = 0; i < ROUTE_PTS.length - 1; i++) {
    const a = ROUTE_PTS[i], b = ROUTE_PTS[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1) continue;
    // skip the base pads: the bases clear their own ground
    if (BASES.some((base) => Math.hypot(a.x - base.x, a.z - base.z) < 120)) continue;
    for (let d = 0; d < len; d += 2) {
      const x = a.x + (b.x - a.x) * d / len, z = a.z + (b.z - a.z) * d / len;
      for (const o of [-8, -4, 0, 4, 8]) {
        const rise = groundHeight(x + o, z) - terrainHeight(x + o, z);
        if (rise > tallest) { tallest = rise; at = [Math.round(x + o), Math.round(z)]; }
      }
    }
  }
  console.log(`  tallest rock on the road strip: ${tallest.toFixed(2)} m at ${at}`);
  assert.ok(tallest < 0.7, `a ${tallest.toFixed(2)} m rock sits on the road at ${at}`);
});

test('rubble gathers on slopes, flats are clearer', () => {
  const count = (pick) => {
    let rocks = 0, n = 0;
    for (let x = -REAL.halfW + 2200; x < REAL.halfW - 2200 && n < 1500; x += 37) for (let z = -REAL.halfH + 2200; z < REAL.halfH - 2200 && n < 1500; z += 41) {
      if (roadDist(x, z) < 400 || !pick(REAL.slope(x, z))) continue;
      n++;
      if (groundHeight(x, z) - terrainHeight(x, z) > 0.15) rocks++;
    }
    return { share: rocks / Math.max(n, 1), n };
  };
  const steep = count((s) => s > 0.25), flat = count((s) => s < 0.1);
  console.log(`  ground covered by a rock: steep ${(steep.share * 100).toFixed(1)} % (${steep.n} pts), flat ${(flat.share * 100).toFixed(1)} % (${flat.n} pts)`);
  assert.ok(steep.n >= 200 && flat.n >= 200, 'not enough sample points');
  assert.ok(steep.share > flat.share, 'slopes are not stonier than flats');
});

test('named places: on the map, clear of the bases, each with a name, a letter and a line of radio', () => {
  assert.ok(REAL_PLACES.length >= 4, 'few places');
  const letters = new Set();
  for (const p of REAL_PLACES) {
    assert.ok(p.name && p.letter && p.blurb, `${p.name}: incomplete`);
    assert.ok(Math.abs(p.x) < REAL.halfW - 1500 && Math.abs(p.z) < REAL.halfH - 1500, `${p.name} is at the edge of the map`);
    for (const b of BASES) assert.ok(Math.hypot(p.x - b.x, p.z - b.z) > 300, `${p.name} is inside ${b.name}`);
    assert.ok(!letters.has(p.letter), `letter ${p.letter} used twice`);
    letters.add(p.letter);
  }
  for (const b of BASES) assert.ok(!letters.has(b.name[0]), `a place uses the letter of ${b.name}`);
});

test('small craters: many, mostly small, none on the road or the base pads', () => {
  let n = 0, deep = 0, rimUp = 0, onRoad = 0, roadN = 0, minD = 0;
  for (let x = -9000; x < 9000; x += 9) for (let z = -3000; z < 3000; z += 9) {
    const c = smallCraters(x, z);
    n++;
    if (c < -0.3) deep++;
    if (c > 0.05) rimUp++;
    minD = Math.min(minD, c);
  }
  // (the last stretch into a base blends to the pad's own level, so skip the pads' skirts)
  for (const p of ROUTE_PTS) { if (BASES.some((b) => Math.hypot(p.x - b.x, p.z - b.z) < 170)) continue; roadN++; if (Math.abs(terrainHeight(p.x, p.z) - p.e) > 0.6) onRoad++; }
  assert.ok(roadN > 300);
  console.log(`  small craters: ${(100 * deep / n).toFixed(1)} % of ground is bowl deeper than 0.3 m, ${(100 * rimUp / n).toFixed(1)} % rim, deepest ${minD.toFixed(1)} m`);
  assert.ok(deep / n > 0.01 && deep / n < 0.3, 'crater coverage out of range');
  assert.ok(rimUp > 0, 'no rims');
  assert.ok(minD > -6, 'a crater is deeper than a small crater should be');
  assert.equal(onRoad, 0, 'the road follows crater bowls');
  for (const b of BASES) for (const [dx, dz] of [[20, 0], [-20, 0], [0, 20], [0, -20]]) {
    assert.ok(Math.abs(terrainHeight(b.x + dx, b.z + dz) - terrainHeight(b.x, b.z)) < 1.2, `${b.name} pad is cratered`);
  }
});

test('sand ripples: only on flat dust, decimetres high, none on the road', () => {
  let strongest = 0, dusty = 0, offDust = 0;
  for (let x = -REAL.halfW + 2200; x < REAL.halfW - 2200; x += 53) for (let z = -REAL.halfH + 2200; z < REAL.halfH - 2200; z += 59) {
    const r = Math.abs(sandRipples(x, z));
    if (dustDepth(x, z) > 0.8 && REAL.slope(x, z) < 0.04) { dusty++; strongest = Math.max(strongest, r); }
    if (dustDepth(x, z) < 0.02) offDust = Math.max(offDust, r);
  }
  console.log(`  ripples: strongest ${strongest.toFixed(2)} m over ${dusty} dusty flat points, ${offDust.toFixed(2)} m on bare ground`);
  assert.ok(dusty > 20, 'no dusty flats to test on');
  assert.ok(strongest > 0.15 && strongest < 0.5, 'ripple height out of range');
  assert.equal(offDust, 0, 'ripples on bare ground');
  for (const p of ROUTE_PTS) assert.equal(sandRipples(p.x, p.z), 0, 'ripples on the road');
});
