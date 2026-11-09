// Cycle 101 full-rotation regression replay (the 32-suite live board).
// Same mechanics as run-loop.mjs but standalone: fresh JSON state, per-suite
// log capture, quota self-heal before approvals. Results -> cycle101-replay-results.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROTATION = [
  'cycle1-case-web', 'cycle2-case-mobile', 'cycle3-approvals', 'cycle9-evals',
  'cycle10-rbac', 'cycle11-dashboard', 'cycle12-billing', 'cycle13-reports',
  'cycle14-perf', 'cycle23-comments', 'cycle25-shifts', 'cycle25b-shifts-schema',
  'cycle25c-shifts-full', 'cycle27-goals', 'cycle32-ops', 'cycle33-attachments',
  'cycle35-templates', 'cycle36-msf', 'cycle41-notifications', 'cycle43-favorites',
  'cycle44-consent', 'cycle46-onboarding', 'cycle48-compliance', 'cycle49-push-tokens',
  'cycle51-webhooks', 'cycle53-admin-users', 'cycle54-plan-features',
  'cycle56-tenant-settings', 'cycle57-sso', 'cycle63-profile', 'cycle64-sessions',
  'cycle67-reports-data',
];

function runScript(name, timeoutMs) {
  const path = fileURLToPath(new URL(`./${name}.mjs`, import.meta.url));
  try {
    const out = execFileSync(process.execPath, [path], { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
    return { out, code: 0 };
  } catch (e) {
    return { out: (e.stdout ?? '') + '\n' + (e.stderr ?? String(e.message)), code: e.status ?? 1 };
  }
}

function parse(out) {
  const m = out.match(/(\d+)\/(\d+) checks passed/);
  return m ? { passed: +m[1], total: +m[2] } : { passed: 0, total: 0 };
}

const results = [];
for (const suite of ROTATION) {
  // Quota self-heal before suites that insert cases (free plan caps demo at 20).
  if (['cycle1-case-web', 'cycle2-case-mobile', 'cycle3-approvals'].includes(suite)) {
    try { runScript('free-quota-slots', 60000); } catch { /* best effort */ }
  }
  const t0 = Date.now();
  let { out, code } = runScript(suite, 180000);
  let { passed, total } = parse(out);
  let okFlag = code === 0 && total > 0 && passed === total;
  if (!okFlag) {
    console.log(`[..] ${suite} failed — retrying once after 15s cooldown`);
    await new Promise(r => setTimeout(r, 15000));
    ({ out, code } = runScript(suite, 180000));
    ({ passed, total } = parse(out));
    okFlag = code === 0 && total > 0 && passed === total;
  }
  const ms = Date.now() - t0;
  results.push({ suite, ok: okFlag, passed, total, ms, ts: new Date().toISOString() });
  console.log(`[${okFlag ? 'ok' : 'FAIL'}] ${suite} :: ${passed}/${total} (${ms}ms)`);
  if (!okFlag) console.log(out.split('\n').filter(l => l.startsWith('FAIL')).join('\n'));
  await new Promise(r => setTimeout(r, 1200));
}
writeFileSync(new URL('./cycle101-replay-results.json', import.meta.url), JSON.stringify(results, null, 2));
const fails = results.filter(r => !r.ok);
const even = results.filter(r => r.total > 0);
console.log(`\n[replay] ${even.length}/${results.length} suites reported checks; passed=${results.filter(r => r.ok).length}, failed=${fails.length}`);
console.log(`[replay] total checks: ${even.reduce((a, r) => a + r.total, 0)} -> ${even.reduce((a, r) => a + r.passed, 0)} passed`);
if (fails.length) console.log('FAILED:', JSON.stringify(fails.map(r => r.suite)));
