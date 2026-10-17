// A bot that plays instead of you: drives one chassis the whole road from АЛЬФА to БЕТА
// on the real physics and reports whether it got there, how fast, and what went wrong
// (flipped, stuck, off the road, wheels airborne). No browser needed.
//   node tools/playbot.mjs [chassis] [--rapier]        one chassis
//   node tools/playbot.mjs all [--rapier]              every chassis, one process each
// Exit code 1 if any run fails, so it can sit in CI or a nightly job.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith('--')) || 'truck';
const useRapier = args.includes('--rapier');
const CHASSIS = ['truck', 'crawler', 'hauler', 'buggy', 'speedster', 'galatea'];

if (which === 'all') {
  let bad = 0;
  for (const c of CHASSIS) {
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, c, ...(useRapier ? ['--rapier'] : [])], { stdio: 'inherit', env: process.env });
    if (r.status) bad++;
  }
  console.log(bad ? `\n${bad} chassis FAILED` : '\nall chassis reached БЕТА');
  process.exit(bad ? 1 : 0);
}

process.env.TEST_CHASSIS = which;
await import('../tests/env.mjs');
const THREE = await import('three');
const { VehicleSim } = await import('../src/physics.js');
const { createRapierSim } = await import('../src/rapier-sim.js');
const { ROUTE_PTS, ROUTE_LEN, BASES, roadDist, nearestRouteIndex } = await import('../src/terrain.js');
const { SPEC } = await import('../src/chassis.js');

const sim = useRapier ? await createRapierSim() : new VehicleSim();
const start = ROUTE_PTS[0];
const first = ROUTE_PTS[Math.min(6, ROUTE_PTS.length - 1)];
sim.reset(start.x, start.z, Math.atan2(first.x - start.x, first.z - start.z));

const DT = 1 / 60;
const LIMIT = 40 * 60; // sim seconds
const fwd = new THREE.Vector3();
const goal = BASES[1];
let t = 0, along = 0, maxOff = 0, minUp = 1, airTicks = 0, ticks = 0;
let stuckSince = null, lastProgress = 0, lastProgressT = 0, flipped = 0, fail = null, topSpeed = 0;
let idx = 0, recovering = 0, recoveries = 0, recoveryDir = 1, recent = [];

while (t < LIMIT) {
  fwd.set(0, 0, 1).applyQuaternion(sim.quat);
  const p = sim.pos;
  idx = Math.max(idx, nearestRouteIndex(p.x, p.z));
  // pure pursuit: aim at a point a speed-dependent distance down the road
  const look = 14 + Math.abs(sim.speed) * 1.6;
  let k = idx;
  while (k < ROUTE_PTS.length - 1 && ROUTE_PTS[k].s - ROUTE_PTS[idx].s < look) k++;
  const tx = ROUTE_PTS[k].x - p.x, tz = ROUTE_PTS[k].z - p.z;
  const err = Math.atan2(fwd.z * tx - fwd.x * tz, fwd.x * tx + fwd.z * tz); // + = target is to the left
  const steer = Math.max(-1, Math.min(1, (err * (SPEC.skidSteer ? 0.45 : 1.2)) / (1 + Math.abs(sim.speed) * 0.12)));
  // slow for corners and for the last stretch
  const toGo = ROUTE_LEN - ROUTE_PTS[idx].s;
  const target = Math.min(Number(process.env.BOT_VMAX) || 14, 4 + toGo / 12) * (1 - 0.6 * Math.min(1, Math.abs(err)));
  const throttle = Math.max(0, Math.min(1, (target - sim.speed) * 0.5));
  if (recovering > 0) {
    // wedged on a rock: back off turning one way, then try again
    recovering -= DT;
    sim.update(DT, { throttle: -0.8, steer: recoveryDir, brake: 0 });
  } else sim.update(DT, { throttle, steer, brake: sim.speed > target + 1.5 ? 0.4 : 0 });
  if (process.env.BOT_DEBUG && ticks % 120 === 0) console.log(t.toFixed(0), 'pos', p.x.toFixed(0), p.z.toFixed(0), 'err', err.toFixed(2), 'steer', steer.toFixed(2), 'spd', sim.speed.toFixed(1), 'idx', idx, 'tgt', k);
  t += DT; ticks++;
  topSpeed = Math.max(topSpeed, sim.speed);
  along = Math.max(along, ROUTE_PTS[nearestRouteIndex(p.x, p.z)].s);
  maxOff = Math.max(maxOff, roadDist(p.x, p.z));
  minUp = Math.min(minUp, sim.upY);
  if (sim.wheels.every((w) => !w.contact)) airTicks++;
  flipped = sim.upY < 0.3 ? flipped + DT : 0;
  if (flipped > 4) { fail = 'flipped over'; break; }
  if (along - lastProgress > 3) { lastProgress = along; lastProgressT = t; }
  if (recovering <= 0 && t - lastProgressT > 6) {
    recoveries++; recoveryDir = recoveries % 2 ? 1 : -1; recovering = 2.5; lastProgressT = t;
    recent = recent.filter((u) => t - u < 120); recent.push(t);
    if (recent.length > 5) { fail = 'stuck'; break; }
  }
  if (Math.hypot(p.x - goal.x, p.z - goal.z) < 60) break;
}
if (!fail && Math.hypot(sim.pos.x - goal.x, sim.pos.z - goal.z) >= 60) fail = 'timed out';

if (fail) console.log(`  failed at x ${sim.pos.x.toFixed(0)} z ${sim.pos.z.toFixed(0)}, ${ROUTE_PTS[idx].s.toFixed(0)} m along, speed ${sim.speed.toFixed(1)}, upY ${sim.upY.toFixed(2)}`);
const km = (m) => (m / 1000).toFixed(2);
console.log(`${fail ? '✖' : '✔'} ${which.padEnd(9)} ${useRapier ? 'rapier' : 'classic'}  ${fail ? fail.toUpperCase() : 'reached БЕТА'}  `
  + `${(t / 60).toFixed(1)} min · ${km(along)}/${km(ROUTE_LEN)} km · top ${(topSpeed * 3.6).toFixed(0)} km/h · `
  + `max off-road ${maxOff.toFixed(0)} m · lowest upY ${minUp.toFixed(2)} · airborne ${(100 * airTicks / ticks).toFixed(1)} % · rescues ${recoveries}`);
process.exit(fail ? 1 : 0);
