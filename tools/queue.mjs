// The factory's ticket queue (pipeline/tickets.json): who is next, what is in flight, what
// finished. No agents are started from here; whoever does the work (a person or a Claude
// session) asks for the next ticket, and reports back. As soon as one is closed, the next
// one is handed out — until the budget set at `start` runs out.
//   node tools/queue.mjs start [minutes]   set the time budget
//   node tools/queue.mjs next              claim the next ticket (prints it), or say why none
//   node tools/queue.mjs done T-01 "note"  close it as finished
//   node tools/queue.mjs fail T-01 "why"   close it as failed
//   node tools/queue.mjs status | report
import fs from 'node:fs';

const FILE = new URL('../pipeline/tickets.json', import.meta.url).pathname;
const STATE = new URL('../pipeline/status.json', import.meta.url).pathname;
const REPORT = new URL('../pipeline/report.md', import.meta.url).pathname;
const MIN_LEFT = 5; // minutes: below this no new ticket is started
const load = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const save = (d) => fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n');
const state = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
const [cmd, a, b] = process.argv.slice(2);
const left = () => (state().deadline ? (new Date(state().deadline) - Date.now()) / 60000 : Infinity);

if (cmd === 'start') {
  const minutes = Number(a) || 30;
  fs.writeFileSync(STATE, JSON.stringify({ started: new Date().toISOString(), deadline: new Date(Date.now() + minutes * 60000).toISOString() }, null, 2));
  console.log(`бюджет ${minutes} хв, до ${new Date(Date.now() + minutes * 60000).toLocaleTimeString()}`);
} else if (cmd === 'next') {
  const d = load();
  const doing = d.tickets.find((t) => t.status === 'doing');
  if (doing) { console.log(`ще в роботі ${doing.id}: закрий його (done/fail) перед наступним`); process.exit(2); }
  if (left() < MIN_LEFT) { console.log(`бюджет вичерпано (лишилось ${left().toFixed(1)} хв), нових тікетів не видаю`); process.exit(3); }
  const t = d.tickets.find((x) => x.status === 'todo');
  if (!t) { console.log('черга порожня'); process.exit(4); }
  t.status = 'doing'; t.started = new Date().toISOString(); save(d);
  console.log(`${t.id} · ${t.title}\nЩо зробити: ${t.goal}\nГотово, коли: ${t.accept}\nПравила: ${d.rules}\nЛишилось часу: ${left().toFixed(0)} хв`);
} else if (cmd === 'done' || cmd === 'fail') {
  const d = load();
  const t = d.tickets.find((x) => x.id === a);
  if (!t) { console.log('нема такого тікета'); process.exit(1); }
  t.status = cmd === 'done' ? 'done' : 'failed'; t.finished = new Date().toISOString(); t.note = b || ''; save(d);
  console.log(`${t.id} → ${t.status}. ${left() >= MIN_LEFT && d.tickets.some((x) => x.status === 'todo') ? 'Бери наступний: node tools/queue.mjs next' : 'Далі тікетів не видаю.'}`);
} else if (cmd === 'status' || cmd === 'report') {
  const d = load();
  const lines = d.tickets.map((t) => `- ${t.status === 'done' ? '✅' : t.status === 'failed' ? '✖' : t.status === 'doing' ? '🔧' : '⬜'} ${t.id} ${t.title}${t.note ? ` — ${t.note}` : ''}`);
  const text = `# Черга фабрики · ${new Date().toLocaleString()}\n\n${lines.join('\n')}\n\nЛишилось часу: ${Number.isFinite(left()) ? left().toFixed(0) + ' хв' : 'бюджет не заданий'}\n`;
  if (cmd === 'report') fs.writeFileSync(REPORT, text);
  console.log(text);
} else console.log('start [хв] | next | done ID "note" | fail ID "why" | status | report');
