#!/usr/bin/env node
// Publishes the factory's progress for the dashboard (gdoc-pwa → Фабрика): BACKLOG.md
// parsed into columns, plus the current run — which item, which stage, QA rounds, a
// short log — as status.json on the `factory-status` branch of the game's repo. The
// dashboard reads it from the GitHub API.
//
// The branch is written with git plumbing (hash-object / mktree / commit-tree), so
// publishing never touches the working copy, the index or the checked-out branch —
// it is safe to call in the middle of a build. Run state between calls is kept in
// .factory/run.json (ignored by git).
//
//   node tools/factory-status.mjs start F-002 factory/f-002-menu-orbit
//   node tools/factory-status.mjs stage build running "будівельник почав"
//   node tools/factory-status.mjs stage qa failed "QA: 2 проблеми"
//   node tools/factory-status.mjs finish review|merged|failed|rejected "…"
//   node tools/factory-status.mjs sync            (backlog only)
//   add --no-push to write .factory/status.json without publishing

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = join(ROOT, '.factory', 'run.json');
const OUT = join(ROOT, '.factory', 'status.json');
const REMOTE = 'rover';
const BRANCH = 'factory-status';
const REPO = 'tronya/mars-rover';
export const STAGES = ['ideas', 'build', 'qa', 'publish', 'merge'];

const git = (args, input) => execFileSync('git', args, { cwd: ROOT, input, encoding: 'utf8' }).trim();

// BACKLOG.md → { proposals, chosen, review, done, rejected }, each a list of items.
const SECTIONS = { 'Пропозиції': 'proposals', 'Вибрано': 'chosen', 'На перевірці': 'review', 'Готово': 'done', 'Відхилено': 'rejected' };
export function parseBacklog(md) {
  const out = { proposals: [], chosen: [], review: [], done: [], rejected: [] };
  let sec = null;
  let item = null;
  for (const line of md.split('\n')) {
    const h2 = line.match(/^## (.+)$/);
    if (h2) { sec = SECTIONS[h2[1].trim()] || null; item = null; continue; }
    if (!sec) continue;
    const h3 = line.match(/^### (F-\d+) · (.+)$/);
    if (h3) { item = { id: h3[1], title: h3[2].trim() }; out[sec].push(item); continue; }
    const field = line.match(/^- \*\*(.+?):\*\* (.*)$/);
    if (field && item) {
      const key = { 'Навіщо': 'why', 'Що зробити': 'what', 'Готово, коли': 'done', 'Розмір': 'size', 'Гілка': 'branch' }[field[1]];
      if (key) item[key] = field[2].trim();
      continue;
    }
    // Free-form one-liners (e.g. the rejected list).
    const bullet = line.match(/^- (.+)$/);
    if (bullet && !item) out[sec].push({ id: null, title: bullet[1].trim() });
  }
  return out;
}

function loadRun() {
  try { return JSON.parse(readFileSync(RUN, 'utf8')); } catch { return null; }
}
function saveRun(run) {
  mkdirSync(dirname(RUN), { recursive: true });
  writeFileSync(RUN, JSON.stringify(run, null, 2));
}

function publish(status) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(status, null, 2));
  const blob = git(['hash-object', '-w', OUT]);
  const tree = git(['mktree'], `100644 blob ${blob}\tstatus.json\n`);
  let parent = '';
  try { parent = git(['rev-parse', '--verify', '-q', `refs/heads/${BRANCH}`]); } catch { /* first publish */ }
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `factory status ${status.updated}`]);
  git(['update-ref', `refs/heads/${BRANCH}`, commit]);
  git(['push', '-q', '--force', REMOTE, `refs/heads/${BRANCH}:refs/heads/${BRANCH}`]);
}

function main(argv) {
  const push = !argv.includes('--no-push');
  const [cmd, a, b, ...rest] = argv.filter((x) => x !== '--no-push');
  const now = new Date().toISOString();
  let run = loadRun();
  const log = (stage, text) => { run.log = [{ at: now, stage, text }, ...(run.log || [])].slice(0, 40); };

  if (cmd === 'start') {
    run = {
      id: a,
      branch: b || null,
      startedAt: now,
      state: 'running',
      qaRounds: 0,
      stages: Object.fromEntries(STAGES.map((s) => [s, { state: 'pending' }])),
      log: [],
    };
    run.stages.ideas = { state: 'done', at: now };
    log('ideas', `Вибрано ${a}`);
  } else if (cmd === 'stage') {
    if (!run) throw new Error('no run: call start first');
    const [stage, state, note] = [a, b, rest.join(' ')];
    if (!STAGES.includes(stage)) throw new Error(`unknown stage ${stage}`);
    run.stages[stage] = { state, at: now, note: note || undefined };
    if (stage === 'qa' && state === 'running') run.qaRounds++;
    log(stage, note || `${stage}: ${state}`);
  } else if (cmd === 'finish') {
    if (!run) throw new Error('no run: call start first');
    run.state = a; // review | merged | failed | rejected
    run.finishedAt = now;
    log(a === 'merged' ? 'merge' : 'publish', [b, ...rest].join(' ') || a);
  } else if (cmd !== 'sync') {
    console.error('usage: start <id> <branch> | stage <stage> <running|done|failed> [note] | finish <review|merged|failed|rejected> [note] | sync');
    process.exit(2);
  }
  if (run) saveRun(run);

  const backlog = parseBacklog(readFileSync(join(ROOT, 'BACKLOG.md'), 'utf8'));
  const item = run && [...Object.values(backlog)].flat().find((i) => i.id === run.id);
  const status = {
    updated: now,
    repo: REPO,
    run: run && {
      ...run,
      title: item?.title ?? null,
      criteria: item?.done ?? null,
      compare: run.branch ? `https://github.com/${REPO}/compare/main...${run.branch}` : null,
    },
    backlog,
  };
  if (push) publish(status);
  else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(status, null, 2));
  }
  console.log(`factory status: ${cmd}${run ? ` · ${run.id} · ${run.state}` : ''}${push ? ' · published' : ''}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
