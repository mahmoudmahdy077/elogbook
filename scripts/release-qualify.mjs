#!/usr/bin/env node
// T27 release qualification aggregator. Runs every fast gate + unit suite
// and writes a timestamped evidence package under
// docs/upgrade/evidence/T27/. `--full` additionally runs typecheck, lint,
// and the complete unit suites (slow). Anything requiring Docker, VPS,
// browsers, humans, or secrets is reported BLOCKED with its prerequisite
// — never passed by default.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const FULL = process.argv.includes('--full');
const OUT = join(ROOT, 'docs/upgrade/evidence/T27');
mkdirSync(OUT, { recursive: true });

const results = [];
function run(name, cmd, opts = {}) {
  const started = Date.now();
  try {
    execFileSync(cmd[0], cmd.slice(1), {
      cwd: opts.cwd ?? ROOT,
      encoding: 'utf-8',
      timeout: opts.timeout ?? 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
      // pnpm is a shell shim on Windows (needs a shell); a spaced node
      // path breaks under cmd quoting, so node runs shell-less.
      shell: opts.shell ?? (cmd[0] === 'pnpm' && process.platform === 'win32'),
      env: { ...process.env, ...(opts.env ?? {}) },
    });
    results.push({ name, status: 'pass', ms: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push({ name, status: 'fail', ms: Date.now() - started, detail: String(e.message).slice(0, 500) });
    console.log(`FAIL ${name}`);
  }
}
function blocked(name, prerequisite) {
  results.push({ name, status: 'blocked', prerequisite });
  console.log(`BLOCKED ${name} (${prerequisite})`);
}

const node = process.execPath;
for (const script of [
  'verify-tenant-scope.mjs',
  'verify-phi-claim.mjs',
  'verify-single-ip.mjs',
  'verify-exports.mjs',
  'verify-security-tests.mjs',
  'verify-credential-fail-closed.mjs',
  'verify-boot.mjs',
  'verify-e2e-auth.mjs',
  'verify-tokens.mjs',
]) {
  run(`gate:${script}`, [node, join(ROOT, 'scripts', script)]);
}

// Fast unit suites (security/behavioral core). Full matrix runs in CI.
// Paths are package-relative: pnpm --filter runs with the package cwd.
const SUITES = [
  'lib/__tests__/rate-limit-contract.test.ts',
  'lib/__tests__/client-ip.test.ts',
  'lib/__tests__/csp.test.ts',
  'lib/__tests__/e2e-cookie.test.ts',
  'lib/__tests__/theme-policy.test.ts',
  'lib/__tests__/site-content.test.ts',
  'lib/__tests__/dashboard-data.test.ts',
  'lib/__tests__/tenant-branding.test.ts',
  'lib/setup/__tests__/backup-manager.test.ts',
  'lib/setup/__tests__/db-migrator.test.ts',
  'lib/setup/__tests__/version-tracker.test.ts',
  'lib/supabase/__tests__/require-admin.test.ts',
  'lib/supabase/__tests__/tenant-admins.test.ts',
  'lib/supabase/__tests__/require-platform-admin.test.ts',
  'app/api/health/__tests__/route.test.ts',
  'app/api/ready/__tests__/route.test.ts',
];
run('unit:security-core', ['pnpm', '--filter', '@elogbook/web', 'exec', 'vitest', 'run', ...SUITES], { timeout: 300000 });
run('unit:ops', ['pnpm', '--filter', '@elogbook/ops', 'test'], { timeout: 180000 });
run('unit:shared', ['pnpm', '--filter', '@elogbook/shared', 'test'], { timeout: 180000 });

if (FULL) {
  run('typecheck', ['pnpm', 'typecheck'], { timeout: 600000 });
  run('lint', ['pnpm', 'lint:all'], { timeout: 600000 });
  run('test:unit-full', ['pnpm', 'test:unit'], { timeout: 900000 });
} else {
  blocked('typecheck/lint/full-unit', 'pass --full (slow; CI runs them per push)');
}

// Environment-dependent gates: automated only with prerequisites.
blocked('db-tests (pgTAP)', 'Docker + `supabase start` (CI db-tests job runs them)');
blocked('deno-test', 'deno toolchain (CI deno-test job runs it)');
blocked('e2e (Playwright)', 'browsers + E2E secrets + running app (CI e2e job when E2E_ENABLED)');
blocked('docker-boot', 'Docker (CI docker-boot job builds + probes)');
blocked('restore/upgrade fault injection', 'throwaway VPS + off-host backup (T27 drills)');
blocked('load/soak + EXPLAIN', 'qualified VPS + synthetic dataset (T26-full)');
blocked('accessibility/browser matrix', 'browsers + manual keyboard pass (G5)');
blocked('G8 identifiable-data gate', 'governance owner + independent assessment (T19b+)');

let fingerprint = 'unknown';
try {
  fingerprint = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim();
} catch { /* ignore */ }

const pkg = {
  generated_at: new Date().toISOString(),
  commit: fingerprint,
  node: process.version,
  mode: FULL ? 'full' : 'fast',
  results,
  summary: {
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    blocked: results.filter((r) => r.status === 'blocked').length,
  },
};
writeFileSync(join(OUT, 'latest.json'), JSON.stringify(pkg, null, 2));
const md = [
  `# Qualification run ${pkg.generated_at} (${pkg.commit}, ${pkg.mode})`,
  '',
  `pass ${pkg.summary.pass} · fail ${pkg.summary.fail} · blocked ${pkg.summary.blocked}`,
  '',
  ...results.map((r) =>
    `- [${r.status.toUpperCase()}] ${r.name}${r.ms !== undefined ? ` (${r.ms}ms)` : ''}${r.prerequisite ? ` — needs: ${r.prerequisite}` : ''}${r.detail ? ` — ${r.detail}` : ''}`,
  ),
  '',
].join('\n');
writeFileSync(join(OUT, 'latest.md'), md);
console.log(`\npass ${pkg.summary.pass} · fail ${pkg.summary.fail} · blocked ${pkg.summary.blocked}`);
console.log(`evidence: docs/upgrade/evidence/T27/latest.{json,md}`);
if (pkg.summary.fail > 0) process.exit(1);
