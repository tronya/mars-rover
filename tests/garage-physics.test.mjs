// The garage drives each vehicle it shows along its own strip of ground under Rapier
// (garage-ground.js + rapier-sim.js). Every ground chassis must manage a minute of
// that at walking pace: never tipped over, never sunk into the ground, still moving.
//   node --test tests/garage-physics.test.mjs
import './env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createRapierSim } = await import('../src/rapier-sim.js');
const { garageGround, garageStones, garageHeight, garageInput, wrapGarage } = await import('../src/garage-ground.js');
const { chassisKit } = await import('../src/chassis.js');

const DT = 1 / 60;
const GROUND = ['truck', 'crawler', 'hauler', 'buggy', 'speedster', 'galatea'];

for (const id of GROUND) {
  test(`${id} drives 60 s in the garage without rolling or sinking`, async () => {
    const ground = garageGround(garageStones());
    const sim = await createRapierSim({ chassis: id, ground });
    sim.reset(0, 0, 0);
    const { SPEC } = chassisKit(id);
    // The mount plane's height over the ground standing still: wheel radius plus
    // static suspension. Sunk means the body far below that.
    const ride = 0.855 * SPEC.wheelScale + SPEC.susp.Lstatic;
    const origin = sim.pos.clone();
    let minUp = 1, minClear = Infinity, maxSide = 0, dist = 0, wraps = 0, onStone = 0;
    let last = sim.pos.clone();
    for (let t = 0; t < 60; t += DT) {
      sim.update(DT, garageInput(sim));
      const shift = wrapGarage(sim);
      if (shift) wraps++;
      last.z += shift;
      dist += Math.hypot(sim.pos.x - last.x, sim.pos.z - last.z);
      last.copy(sim.pos);
      sim.origin(origin);
      if (t > 1) {
        minUp = Math.min(minUp, sim.upY);
        minClear = Math.min(minClear, origin.y - garageHeight(origin.x, origin.z));
        maxSide = Math.max(maxSide, Math.abs(sim.pos.x));
        // Wheel-frames spent on top of a stone: the drive is meant to cross them.
        for (const w of sim.wheels) if (w.contact && ground.height(w.cx, w.cz) > garageHeight(w.cx, w.cz) + 0.05) onStone++;
      }
      assert.ok(Number.isFinite(sim.pos.x + sim.pos.y + sim.pos.z), 'position became NaN');
    }
    const avg = dist / 60;
    console.log(`  ${id}: ${dist.toFixed(0)} m at ${avg.toFixed(2)} m/s, lowest upY ${minUp.toFixed(2)}, lowest mount-plane clearance ${minClear.toFixed(2)} m (ride ${ride.toFixed(2)}), widest off line ${maxSide.toFixed(2)} m, wraps ${wraps}, wheel-frames on stones ${onStone}`);
    sim.dispose();
    assert.ok(minUp > 0.5, 'tipped over');
    assert.ok(minClear > ride * 0.4, 'body sank toward the ground');
    assert.ok(avg > 1, 'barely moving');
    assert.ok(maxSide < 3, 'wandered off the strip');
    assert.ok(onStone > 0, 'never drove over a stone');
  });
}
