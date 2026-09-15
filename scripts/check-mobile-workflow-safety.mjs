#!/usr/bin/env node
/**
 * R1 — mobile workflow fork/PR safety gate (Approach C risk-first hardening).
 *
 * Credential-bearing production EAS builds must run only on protected
 * main pushes or manual dispatch (production environment). PRs use static
 * gates or secret-free preview builds:
 * - build job: environment: production + if: push || workflow_dispatch
 * - typecheck/lint/ledger-check + fork-validation jobs: no ${{ secrets.* }}
 * - no EAS build invocation outside the guarded build job
 *
 * Usage: node scripts/check-mobile-workflow-safety.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = '.github/workflows/deploy-mobile.yml';
const text = readFileSync(resolve(ROOT, path), 'utf-8');
const failures = [];

if (!/environment:\s*production/.test(text)) {
  failures.push(`${path}: build job missing environment: production`);
}

if (!/if:\s*github\.event_name\s*==\s*'push'\s*\|\|\s*github\.event_name\s*==\s*'workflow_dispatch'/.test(text)) {
  failures.push(`${path}: build job missing if: push || workflow_dispatch guard`);
}

// Split into job blocks roughly by top-level job keys for secret scoping.
const lines = text.split('\n');
let currentJob = null;
const jobSecrets = new Map();
for (const line of lines) {
  const jobMatch = line.match(/^  ([a-z-]+):\s*$/);
  if (jobMatch) currentJob = jobMatch[1];
  if (currentJob && /\$\{\{\s*secrets\./.test(line)) {
    if (!jobSecrets.has(currentJob)) jobSecrets.set(currentJob, []);
    jobSecrets.get(currentJob).push(line.trim());
  }
}

for (const job of ['typecheck', 'lint', 'ledger-check', 'fork-validation']) {
  if (jobSecrets.has(job)) {
    failures.push(`${path}: job ${job} must be secret-free but references secrets: ${jobSecrets.get(job).join('; ')}`);
  }
}

if (!jobSecrets.has('build') || jobSecrets.get('build').length === 0) {
  failures.push(`${path}: build job expected to carry release secrets but found none`);
}

// EAS build invocations must only appear in guarded build section.
const easCount = (text.match(/eas build --platform/g) || []).length;
if (easCount !== 2) {
  failures.push(`${path}: expected exactly 2 guarded eas build invocations (android+ios), got ${easCount}`);
}

if (failures.length > 0) {
  console.error(`check-mobile-workflow-safety: ${failures.length} failure(s)`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log('check-mobile-workflow-safety: OK');
