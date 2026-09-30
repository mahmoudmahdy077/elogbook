// Credential-bearing production EAS builds must run only on protected
// branches, in a job bound to the production environment, and never from a
// static or fork-facing job.
//
// deploy-mobile.yml delegates the build to the protected release gate, so the
// job that owns `eas build` is resolved from whichever workflow actually runs
// it. The required properties are unchanged: the owning workflow is
// environment-bound, carries the release secrets, is guarded, and issues
// exactly the two expected platform builds.
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const ENTRY_WORKFLOW = '.github/workflows/deploy-mobile.yml';
const CANDIDATE_WORKFLOWS = [
  ENTRY_WORKFLOW,
  '.github/workflows/release.yml',
];

// Jobs that run without credentials must stay without credentials.
const CREDENTIAL_FREE_JOBS = ['typecheck', 'lint', 'ledger-check', 'fork-validation'];

function readWorkflow(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), 'utf-8');
}

function topLevelJobs(text) {
  const jobs = [];
  const lines = text.split('\n');
  let current = null;
  for (const line of lines) {
    const match = line.match(/^  ([a-z-]+):\s*$/);
    if (match) {
      current = { name: match[1], lines: [] };
      jobs.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return jobs;
}

const present = CANDIDATE_WORKFLOWS.filter((p) => existsSync(resolve(ROOT, p)));
if (!present.includes(ENTRY_WORKFLOW)) {
  failures.push(`${ENTRY_WORKFLOW}: missing`);
}

const owners = present
  .map((p) => ({ path: p, text: readWorkflow(p) }))
  .filter((w) => /eas build\s+--platform/.test(w.text));

if (owners.length === 0) {
  failures.push(`no workflow among ${present.join(', ')} runs eas build --platform`);
}
if (owners.length > 1) {
  failures.push(`${owners.map((o) => o.path).join(' and ')}: both run eas build; only one workflow may own the mobile build`);
}

for (const { path: workflowPath, text } of owners) {
  const jobs = topLevelJobs(text);
  const buildJobs = jobs.filter((job) => job.lines.some((l) => /eas build\s+--platform/.test(l)));

  for (const job of buildJobs) {
    const body = job.lines.join('\n');
    if (!/environment:\s*production/.test(body)) {
      failures.push(`${workflowPath}: job ${job.name} runs eas build without environment: production`);
    }
    if (!/\bif:[^\n]*(?:push|workflow_dispatch)/.test(body)) {
      failures.push(`${workflowPath}: job ${job.name} runs eas build with no push or workflow_dispatch event guard`);
    }
    if (!/\$\{\{\s*secrets\./.test(body)) {
      failures.push(`${workflowPath}: job ${job.name} runs eas build but carries no release secrets`);
    }
  }

  const easCount = (text.match(/eas build --platform/g) || []).length;
  if (easCount !== 2) {
    failures.push(`${workflowPath}: expected exactly 2 guarded eas build invocations (android+ios), got ${easCount}`);
  }
}

// The credential-free jobs must never gain credentials, in any candidate file.
for (const workflowPath of present) {
  const jobs = topLevelJobs(readWorkflow(workflowPath));
  for (const job of jobs) {
    if (!CREDENTIAL_FREE_JOBS.includes(job.name)) continue;
    const secretLines = job.lines.filter((l) => /\$\{\{\s*secrets\./.test(l));
    if (secretLines.length > 0) {
      failures.push(`${workflowPath}: job ${job.name} must be secret-free but references secrets: ${secretLines.join('; ')}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`check-mobile-workflow-safety: ${failures.length} failure(s)`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}

console.log('check-mobile-workflow-safety: OK');