import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const checkerPath = resolve(root, 'scripts', 'verify-release-containment.mjs');

async function loadChecker() {
  assert.ok(existsSync(checkerPath), 'release containment checker must exist');
  return import(pathToFileURL(checkerPath).href);
}

function rulesFor(analyzeWorkflow, text) {
  return analyzeWorkflow('.github/workflows/fixture.yml', text).map(({ rule }) => rule);
}

const approvedDispatch = `  workflow_dispatch:
    inputs:
      approved_promotion:
        description: Approved after the unified release gate
        required: true
        type: boolean
`;

test('allows main pushes for checks while rejecting direct production jobs', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const text = `on:
  push:
    branches: [main]
${approvedDispatch}jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm test
  deploy:
    if: github.event_name == 'workflow_dispatch' && inputs.approved_promotion == true
    environment:
      name: production
    steps:
      - run: deploy-production
`;

  const rules = rulesFor(analyzeWorkflow, text);
  assert.ok(rules.includes('independent-production-command-forbidden'));
  assert.ok(rules.includes('independent-production-job-forbidden'));
});

test('rejects a production job that can run on a main push', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const text = `on:
  push:
    branches: [main]
${approvedDispatch}jobs:
  deploy:
    if: github.ref == 'refs/heads/main' && inputs.approved_promotion == true
    environment: production
    steps:
      - run: deploy-production
`;

  assert.ok(rulesFor(analyzeWorkflow, text).includes('production-main-push-trigger'));
});

test('treats a wildcard main push filter as production-capable', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const text = `on:
  push:
    branches: ['**']
${approvedDispatch}jobs:
  deploy:
    if: github.ref == 'refs/heads/main' && inputs.approved_promotion == true
    environment: production
    steps:
      - run: deploy-production
`;

  assert.ok(rulesFor(analyzeWorkflow, text).includes('production-main-push-trigger'));
});

test('requires an explicit approved promotion input and job guard', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const text = `on:
  workflow_dispatch:
jobs:
  deploy:
    environment: production
    steps:
      - run: deploy-production
`;
  const rules = rulesFor(analyzeWorkflow, text);

  assert.ok(rules.includes('approved-promotion-input-required'));
  assert.ok(rules.includes('production-dispatch-guard-required'));
  assert.ok(rules.includes('production-approval-guard-required'));
});

test('rejects setup update and backup routes without explicit isolation', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const secretCanary = 'RELEASE_CONTAINMENT_SECRET_CANARY';
  const text = `on:
${approvedDispatch}jobs:
  deploy:
    if: github.event_name == 'workflow_dispatch' && inputs.approved_promotion == true
    environment: production
    steps:
      - name: Destructive routes
        env:
          CANARY: ${secretCanary}
        run: |
          curl -fsS "$BASE_URL/api/setup/complete"
          curl -fsS "$BASE_URL/api/update/execute"
          curl -fsS "$BASE_URL/api/backup/run"
          echo "$CANARY"
`;
  const findings = analyzeWorkflow('.github/workflows/fixture.yml', text);

  assert.equal(findings.filter(({ rule }) => rule === 'destructive-route-isolation-required').length, 3);
  assert.ok(findings.every(({ path, line, rule }) =>
    path === '.github/workflows/fixture.yml' && Number.isInteger(line) && typeof rule === 'string'));
  assert.ok(!JSON.stringify(findings).includes(secretCanary));
});

test('does not accept a comment as an isolation marker', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const text = `on:
${approvedDispatch}jobs:
  deploy:
    if: github.event_name == 'workflow_dispatch' && inputs.approved_promotion == true
    environment: production
    steps:
      - name: Comment-only marker
        env:
          # RELEASE_CONTAINMENT_ROUTE: isolated
        run: curl -fsS "$BASE_URL/api/setup/complete"
`;

  assert.ok(rulesFor(analyzeWorkflow, text).includes('destructive-route-isolation-required'));
});

test('accepts destructive routes explicitly marked isolated', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const text = `on:
${approvedDispatch}jobs:
  deploy:
    if: github.event_name == 'workflow_dispatch' && inputs.approved_promotion == true
    environment: production
    steps:
      - name: Isolated maintenance routes
        env:
          RELEASE_CONTAINMENT_ROUTE: isolated
        run: |
          curl -fsS "$BASE_URL/api/setup/complete"
          curl -fsS "$BASE_URL/api/update/execute"
          curl -fsS "$BASE_URL/api/backup/run"
`;

  const findings = analyzeWorkflow('.github/workflows/fixture.yml', text);
  assert.equal(findings.filter(({ rule }) => rule === 'destructive-route-isolation-required').length, 0);
  assert.ok(findings.some(({ rule }) => rule === 'independent-production-job-forbidden'));
});

test('accepts a dispatch-only wrapper that delegates to the canonical release workflow', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const text = `on:
  workflow_dispatch:
    inputs:
      staging_approved:
        required: true
        type: boolean
      staging_url:
        required: true
        type: string
jobs:
  release:
    if: github.event_name == 'workflow_dispatch' && inputs.staging_approved == true
    uses: ./.github/workflows/release.yml
    with:
      staging_approved: \${{ inputs.staging_approved }}
      staging_url: \${{ inputs.staging_url }}
    secrets: inherit
`;

  assert.deepEqual(analyzeWorkflow('.github/workflows/deploy-web.yml', text), []);
});

test('rejects a direct production command in an independent workflow', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const text = `on:
  workflow_dispatch:
    inputs:
      approved_promotion:
        required: true
        type: boolean
jobs:
  checks:
    steps:
      - run: pnpm functions:deploy
`;

  assert.ok(rulesFor(analyzeWorkflow, text).includes('independent-production-command-forbidden'));
});
