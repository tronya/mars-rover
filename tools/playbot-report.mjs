// Runs the playbot for every chassis on every real region and writes one page with the
// results: pipeline/playbot-report.html (and .json next to it). Runs in parallel.
//   node tools/playbot-report.mjs [--rapier] [--quick]     --quick: the truck only
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const args = process.argv.slice(2);
const rapier = args.includes('--rapier');
const CHASSIS = args.includes('--quick') ? ['truck'] : ['truck', 'crawler', 'hauler', 'buggy', 'speedster', 'galatea'];
const REGIONS = [['jezero', 'Єзеро'], ['gale', 'Гейл']];
const jobs = REGIONS.flatMap(([r]) => CHASSIS.map((c) => ({ region: r, chassis: c })));

function runOne(job) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [new URL('./playbot.mjs', import.meta.url).pathname, job.chassis, ...(rapier ? ['--rapier'] : [])], {
      env: { ...process.env, TEST_REGION: job.region },
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => {
      const m = out.match(/(\d+\.\d+) min · ([\d.]+)\/([\d.]+) km · top (\d+) km\/h · max off-road (\d+) m · lowest upY ([\d.]+) · airborne ([\d.]+) % · rescues (\d+)/);
      const why = out.match(/(STUCK|FLIPPED OVER|TIMED OUT)/);
      resolve({ ...job, ok: code === 0, why: why ? why[1] : '', minutes: m && +m[1], km: m && +m[2], routeKm: m && +m[3], top: m && +m[4], off: m && +m[5], upY: m && +m[6], air: m && +m[7], rescues: m && +m[8] });
    });
  });
}

const results = [];
const queue = [...jobs];
await Promise.all(Array.from({ length: Math.max(1, Math.min(os.cpus().length - 1, 6)) }, async () => {
  for (let job; (job = queue.shift());) {
    const r = await runOne(job);
    results.push(r);
    console.log(`${r.ok ? '✔' : '✖'} ${r.region} ${r.chassis} ${r.minutes ?? ''} ${r.why}`);
  }
}));
results.sort((a, b) => jobs.findIndex((j) => j.region === a.region && j.chassis === a.chassis) - jobs.findIndex((j) => j.region === b.region && j.chassis === b.chassis));

const OUT = new URL('../pipeline/playbot-report', import.meta.url).pathname;
fs.writeFileSync(OUT + '.json', JSON.stringify({ when: new Date().toISOString(), physics: rapier ? 'rapier' : 'classic', results }, null, 2));
const rows = results.map((r) => `<tr class="${r.ok ? 'ok' : 'bad'}"><td>${REGIONS.find(([k]) => k === r.region)[1]}</td><td>${r.chassis}</td><td>${r.ok ? 'доїхав' : r.why || 'ні'}</td><td>${r.minutes ?? '–'}</td><td>${r.km ?? '–'} / ${r.routeKm ?? '–'}</td><td>${r.top ?? '–'}</td><td>${r.off ?? '–'}</td><td>${r.upY ?? '–'}</td><td>${r.air ?? '–'}</td><td>${r.rescues ?? '–'}</td></tr>`).join('\n');
const done = results.filter((r) => r.ok).length;
fs.writeFileSync(OUT + '.html', `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Звіт бота</title>
<style>
:root{--bg:#fff;--fg:#1d1a17;--mut:#6b6259;--ok:#e6f4ea;--bad:#fde7e4;--line:#ddd3c8}
@media (prefers-color-scheme:dark){:root{--bg:#161210;--fg:#f1e8de;--mut:#a39789;--ok:#14301c;--bad:#43201b;--line:#3a312a}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}p{color:var(--mut);margin:0 0 14px}
.wrap{overflow-x:auto}table{border-collapse:collapse;min-width:640px;width:100%}
th,td{padding:6px 9px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2),th:nth-child(3),td:nth-child(3){text-align:left}
tr.ok td:nth-child(3){background:var(--ok)}tr.bad td{background:var(--bad)}
</style></head><body>
<h1>Звіт бота: ${done} з ${results.length} доїхали</h1>
<p>${new Date().toLocaleString('uk-UA')} · фізика ${rapier ? 'Rapier' : 'класична'} · бот веде шасі всю дорогу АЛЬФА→БЕТА законом керування автопілота гри</p>
<div class="wrap"><table><thead><tr><th>Регіон</th><th>Шасі</th><th>Результат</th><th>хв</th><th>км</th><th>макс км/год</th><th>з дороги, м</th><th>мін. upY</th><th>у повітрі %</th><th>рятувань</th></tr></thead><tbody>
${rows}
</tbody></table></div></body></html>`);
console.log(`\n${done}/${results.length} доїхали → pipeline/playbot-report.html`);
