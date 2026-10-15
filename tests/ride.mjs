// Ride quality: drive a chassis over rough ground and measure how hard the body is
// thrown about — vertical acceleration of the body (RMS and peak, in g) and how much
// of the time wheels hang in the air. Lower is smoother. Shared by the test and by
// hand-tuning runs:  TEST_CHASSIS=buggy node tests/ride.mjs
import './env.mjs';
const { VehicleSim, GRAVITY } = await import('../src/physics.js');
const { createRapierSim } = await import('../src/rapier-sim.js');
const { SPEC } = await import('../src/chassis.js');

export async function ride(make, seconds = 25, heading = 0.4, x = 0, z = 0) {
  const s = await make();
  s.reset(x, z, heading);
  const dt = 1 / 60;
  for (let t = 0; t < 1; t += dt) s.update(dt, { throttle: 0, steer: 0, brake: 0 });
  let vy = s.vel.y, sum = 0, peak = 0, n = 0, air = 0, wheelsN = 0, jolts = 0;
  for (let t = 0; t < seconds; t += dt) {
    // Fully off the road, as main.js sets it: each chassis's own rolling resistance
    // and churn (a road car like the speedster bogs down out here — on purpose).
    const T = SPEC.terrain;
    s.rollMul = T.offRoll;
    s.dragMul = T.offDrag;
    s.update(dt, { throttle: 0.8, steer: Math.sin(t * 0.3) * 0.25, brake: 0 });
    const a = (s.vel.y - vy) / dt / GRAVITY;
    vy = s.vel.y;
    if (t > 2) { sum += a * a; peak = Math.max(peak, Math.abs(a)); n++; if (Math.abs(a) > 2) jolts++; }
    for (const w of s.wheels) { wheelsN++; if (!w.contact) air++; }
  }
  return { rms: Math.sqrt(sum / n), peak, jolts: (jolts / n) * 60, air: air / wheelsN, speed: s.speed * 3.6, upright: s.upY > 0.5 };
}
export const classic = async () => new VehicleSim();
export const rapier = () => createRapierSim();

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [name, make] of [['classic', classic], ['rapier', rapier]]) {
    // Three routes out of the same spot, so one lucky or unlucky bump doesn't decide it.
    const rs = [];
    // Open ground away from the bases, so a crash into a building doesn't count as ride.
    for (const [h, x, z] of [[0.4, 900, 400], [2.0, -700, 1200], [4.2, 1500, -900]]) rs.push(await ride(make, 25, h, x, z));
    const avg = (k) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
    console.log(`${name.padEnd(8)} vertical accel RMS ${avg('rms').toFixed(2)} g, jolts over 2 g ${avg("jolts").toFixed(2)}/s, worst peak ${Math.max(...rs.map((r) => r.peak)).toFixed(1)} g, wheels in the air ${(avg('air') * 100).toFixed(0)} %, end ${rs.map((r) => `${r.speed.toFixed(0)}${r.upright ? '' : '↯'}`).join('/')} km/h`);
  }
}
