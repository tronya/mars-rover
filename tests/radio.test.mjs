// The on-the-road radio: every real region has a chain, in order, short enough to read.
import './env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { REGION_RADIO } = await import('../src/real-mars.js');

test('every real region has chatter, ordered along the road', () => {
  for (const region of ['jezero', 'gale']) {
    const list = REGION_RADIO[region];
    assert.ok(list && list.length >= 3, `${region}: too little chatter`);
    let last = 0;
    for (const m of list) {
      assert.ok(m.at > last && m.at < 1, `${region}: ${m.at} out of order`);
      last = m.at;
      assert.ok(m.lines.length >= 1);
      for (const [from, text] of m.lines) {
        assert.ok(from && text, 'a line is missing its speaker or text');
        assert.ok(text.length <= 220, `${region}@${m.at}: line too long (${text.length})`);
        assert.ok(/[а-яіїєґ]/i.test(text), 'lines are in Ukrainian');
      }
    }
  }
});
