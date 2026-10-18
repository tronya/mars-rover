// The tester's gate for any ticket: the whole test suite, then the playbot drives the truck
// the full road on both real regions. Exit code 1 if anything fails.
//   node tools/verify.mjs
import { spawnSync } from 'node:child_process';
const ROOT = new URL('..', import.meta.url).pathname;
const run = (label, cmd, args, env = {}) => {
  process.stdout.write(`${label} … `);
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  console.log(r.status === 0 ? 'ok' : 'FAILED');
  if (r.status) { console.log((r.stdout + r.stderr).split('\n').slice(-25).join('\n')); process.exit(1); }
};
run('npm test', 'npm', ['test']);
run('playbot truck · jezero', 'node', ['tools/playbot.mjs', 'truck']);
run('playbot truck · gale', 'node', ['tools/playbot.mjs', 'truck'], { TEST_REGION: 'gale' });
run('playbot truck · olympus', 'node', ['tools/playbot.mjs', 'truck'], { TEST_REGION: 'olympus' });
console.log('verify: all green');
