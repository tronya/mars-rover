// The full build: every upgrade at its top level, every vehicle owned, nothing owed.
import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { createUpgrades, BRANCHES, VEHICLE_PRICES } = await import('../src/upgrades.js');
const none = { collectedCount: () => 0, deliveredCount: () => 0 };

test('maxOut gives every upgrade its top level and every vehicle', () => {
  const up = createUpgrades(none, none);
  assert.equal(up.level('motor'), 0);
  up.maxOut();
  for (const b of BRANCHES) assert.equal(up.level(b.id), b.costs.length, `${b.id} not at the top`);
  for (const id of Object.keys(VEHICLE_PRICES)) assert.ok(up.ownsVehicle(id), `${id} not owned`);
  assert.ok(up.unlocked('sonar') && up.unlocked('avoidance') && up.unlocked('autopilot') && up.unlocked('farlight'));
  assert.ok(up.mul('motor') === 3 && up.mul('suspension') === 2.4);
  assert.equal(up.currency(), 0, 'the build should not cost, or add, any scrap');
});

test('a second createUpgrades reads the maxed save back', () => {
  const again = createUpgrades(none, none);
  assert.equal(again.level('wheels'), 2);
  assert.ok(again.ownsVehicle('galatea'));
});
