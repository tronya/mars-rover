// BACKLOG.md → dashboard columns (tools/factory-status.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBacklog } from '../tools/factory-status.mjs';

test('parses backlog sections, items and their fields', () => {
  const md = `# Беклог
## Пропозиції
### F-007 · Камера в меню
- **Навіщо:** живе меню.
- **Готово, коли:** камера рухається.
- **Розмір:** S
## Вибрано
### F-003 · Бази
- **Розмір:** L
## На перевірці
### F-001 · Гараж
- **Гілка:** factory/f-001-garage
## Готово
## Відхилено
- Земля — прибрано
`;
  const b = parseBacklog(md);
  assert.deepEqual(b.proposals, [{ id: 'F-007', title: 'Камера в меню', why: 'живе меню.', done: 'камера рухається.', size: 'S' }]);
  assert.equal(b.chosen[0].id, 'F-003');
  assert.equal(b.review[0].branch, 'factory/f-001-garage');
  assert.deepEqual(b.done, []);
  assert.deepEqual(b.rejected, [{ id: null, title: 'Земля — прибрано' }]);
});
