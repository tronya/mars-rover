// How long real Mars takes to come up, per stage, for each region, plus how fast the ground
// answers once it is up (physics asks for terrainHeight constantly).
//   node tools/bench-load.mjs
import { spawnSync } from 'node:child_process';

const region = process.argv[2];
if (!region) {
  for (const r of ['jezero', 'gale']) {
    const out = spawnSync(process.execPath, [new URL(import.meta.url).pathname, r], { encoding: 'utf8' });
    process.stdout.write(out.stdout + (out.status ? out.stderr : ''));
  }
  process.exit(0);
}
process.env.TEST_REGION = region;
await import('../tests/env.mjs');
const ms = (t0) => `${(performance.now() - t0).toFixed(0)} ms`;
let t = performance.now();
const { REAL, REAL_ROUTE, REAL_PLACES } = await import('../src/real-mars.js');
const tReal = ms(t);
t = performance.now();
const T = await import('../src/terrain.js');
const tTerrain = ms(t);
const N = 200000;
t = performance.now();
let sink = 0; // keeps the loops from being optimised away
for (let i = 0; i < N; i++) sink += T.terrainHeight((i % 500) * 17 - 4000, Math.floor(i / 500) * 13 - 2000);
const per = ((performance.now() - t) / N * 1000).toFixed(2);
t = performance.now();
for (let i = 0; i < N / 4; i++) sink += T.groundHeight((i % 500) * 17 - 4000, Math.floor(i / 500) * 13 - 2000);
const perG = ((performance.now() - t) / (N / 4) * 1000).toFixed(2);
if (!Number.isFinite(sink)) throw new Error('terrain returned a non-number');
console.log(`${region.padEnd(7)} data+route+places ${tReal.padStart(7)} · terrain.js (field, bases, landmarks) ${tTerrain.padStart(7)} · terrainHeight ${per} µs/call · groundHeight ${perG} µs/call  [${REAL_ROUTE.length} route pts, ${REAL_PLACES.length} places]`);
