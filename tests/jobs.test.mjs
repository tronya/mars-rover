// The science "core sample" errand: only on the real map, drill at a named place, then deliver.
import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { createJobs } = await import('../src/jobs.js');
const { REAL_PLACES } = await import('../src/real-mars.js');

test('a core-sample job appears and can be completed on the real map', { skip: !REAL_PLACES.length && 'classic terrain has no real places' }, () => {
  const jobs = createJobs();
  let found = null;
  let x = 0, z = 0;
  for (let n = 0; n < 400 && !found; n++) {
    let t = 0;
    for (let i = 0; i < 40 && !jobs.active; i++) { t += 1; jobs.update(t, 1, x, z, 0); }
    if (jobs.active?.title.startsWith('Керн ґрунту')) found = jobs.active;
    else jobs.skip();
  }
  assert.ok(found, 'no sample job in 400 offers');
  const hold = found.steps[0];
  assert.equal(hold.type, 'hold');
  let ev = null;
  for (let i = 0; i < 20; i++) ev = jobs.update(100 + i, 1, hold.at.x, hold.at.z, 0) || ev;
  assert.equal(jobs.active.step, 1, 'drilling did not finish after holding still');
  const home = found.steps[1].at;
  for (let i = 0; i < 3; i++) ev = jobs.update(200 + i, 1, home.x, home.z, 0) || ev;
  assert.equal(ev?.type, 'done');
  assert.ok(ev.pay >= 6);
});
