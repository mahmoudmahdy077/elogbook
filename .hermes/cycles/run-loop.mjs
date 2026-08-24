// 100-cycle regression loop runner.
// Each cycle = one suite script from the rotation; static checks interleaved by operator.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROTATION = [
  'cycle1-case-web',
  'cycle2-case-mobile',
  'cycle3-approvals',
  'cycle9-evals',
  'cycle10-rbac',
  'cycle11-dashboard',
  'cycle12-billing',
  'cycle13-reports',
  'cycle14-perf',
  'cycle23-comments',
  'cycle25-shifts',
  'cycle25b-shifts-schema',
  'cycle25c-shifts-full',
  'cycle27-goals',
  'cycle32-ops',
  'cycle33-attachments',
  'cycle35-templates',
  'cycle36-msf',
  'cycle41-notifications',
  'cycle43-favorites',
  'cycle44-consent',
  'cycle46-onboarding',
  'cycle48-compliance',
  'cycle49-push-tokens',
  'cycle51-webhooks',
  'cycle53-admin-users',
  'cycle54-plan-features',
  'cycle56-tenant-settings',
  'cycle57-sso',
  'cycle63-profile',
  'cycle64-sessions',
  'cycle67-reports-data',
];

const STATE_FILE = new globalThis.URL('./loop-state.json', import.meta.url);
const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { completedCycles: [], failures: {} };

const args = process.argv.slice(2);
const toArg = args.includes('--to') ? parseInt(args[args.indexOf('--to') + 1], 10) : null;

let done = state.completedCycles.length;
console.log(`[loop] ${done}/100 cycles already complete`);

function runSuite(suite) {
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [fileURLToPath(new globalThis.URL(`./${suite}.mjs`, import.meta.url))], {
      encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    code = e.status ?? 1;
    out = (e.stdout ?? '') + '\n' + (e.stderr ?? String(e.message));
  }
  return { out, code };
}

for (const suite of ROTATION) {
  if (done >= 100) break;
  const cycleNum = done + 1;
  if (toArg && cycleNum > toArg) break;

  const t0 = Date.now();
  let { out, code } = runSuite(suite);
  const m = out.match(/(\d+)\/(\d+) checks passed/);
  let passed = m ? parseInt(m[1], 10) : 0;
  let total = m ? parseInt(m[2], 10) : 0;
  let okFlag = code === 0 && total > 0 && passed === total;

  // auto-retry once on failure after cooldown (transient GoTrue rate limits)
  if (!okFlag) {
    console.log(`[..]   cycle ${cycleNum} ${suite} failed — cooling down 15s, retrying once`);
    await new Promise(r => setTimeout(r, 15000));
    ({ out, code } = runSuite(suite));
    const m2 = out.match(/(\d+)\/(\d+) checks passed/);
    passed = m2 ? parseInt(m2[1], 10) : 0;
    total = m2 ? parseInt(m2[2], 10) : 0;
    okFlag = code === 0 && total > 0 && passed === total;
  }

  const ms = Date.now() - t0;
  const entry = { cycle: cycleNum, suite, ok: okFlag, passed, total, ms, ts: new Date().toISOString() };
  state.completedCycles.push(entry);
  if (!okFlag) {
    state.failures[`${cycleNum}:${suite}`] = out.slice(-3000);
    console.log(`[FAIL] cycle ${cycleNum} ${suite} :: ${passed}/${total} (${ms}ms)\n${out.split('\n').filter(l => l.startsWith('FAIL')).join('\n')}`);
  } else {
    console.log(`[ok]   cycle ${cycleNum} ${suite} :: ${passed}/${total} (${ms}ms)`);
  }
  done = cycleNum;
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  await new Promise(r => setTimeout(r, 1200));
}

const fails = Object.keys(state.failures).length;
console.log(`\n[loop] progress: ${state.completedCycles.length}/100 | failed suites logged: ${fails}`);
