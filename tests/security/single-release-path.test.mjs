import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const checkerPath = resolve(root, 'scripts', 'verify-single-release-path.mjs');

async function loadChecker() {
  assert.ok(existsSync(checkerPath), 'single release path checker must exist');
  return import(`${pathToFileURL(checkerPath).href}?test=${Date.now()}`);
}

function rules(findings) {
  return findings.map(({ rule }) => rule);
}

function releaseFixture({ productionNeeds = ['typecheck', 'tests', 'migration-replay', 'sast', 'secret-scan', 'dependency-audit', 'container-scan', 'function-scan', 'sbom', 'evidence', 'staging-smoke', 'dast', 'staging-approval'] } = {}) {
  return `on:
  workflow_dispatch:
    inputs:
      staging_approved:
        required: true
        type: boolean
      staging_url:
        required: true
        type: string
  workflow_call:
    inputs:
      staging_approved:
        required: true
        type: boolean
      staging_url:
        required: true
        type: string
permissions:
  contents: read
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          persist-credentials: false
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
  tests:
    runs-on: ubuntu-latest
    needs: [typecheck]
    steps:
      - run: pnpm test
  migration-replay:
    runs-on: ubuntu-latest
    steps:
      - run: supabase db reset && supabase db test
  sast:
    runs-on: ubuntu-latest
    steps:
      - run: semgrep --config .semgrep.yml .
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/verify-secret-containment.mjs
  dependency-audit:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm audit --prod --audit-level=high
  container-scan:
    runs-on: ubuntu-latest
    steps:
      - run: trivy image elogbook-web:scan
  function-scan:
    runs-on: ubuntu-latest
    steps:
      - name: Check every manifest Edge Function
        run: |
          set -euo pipefail
          function_count="$(jq -er '.functions | keys | length' supabase/functions/manifest.json)"
          scanned_count=0
          while IFS= read -r function_name; do
            deno check --frozen --no-config --import-map=supabase/import_map.json --lock=supabase/deno.lock "supabase/functions/\${function_name}/index.ts"
            scanned_count=$((scanned_count + 1))
          done < <(jq -er '.functions | keys[]' supabase/functions/manifest.json)
          test "\${scanned_count}" -eq "\${function_count}"
      - run: deno test --frozen --config supabase/functions/payment-webhook/deno.json --lock supabase/functions/payment-webhook/deno.lock --allow-import --allow-net=localhost --allow-env supabase/functions/payment-webhook/index.test.ts
  sbom:
    runs-on: ubuntu-latest
    needs: [container-scan, function-scan]
    steps:
      - run: node scripts/generate-release-evidence.mjs --all
  evidence:
    runs-on: ubuntu-latest
    needs: [sbom, sast, secret-scan, dependency-audit, tests, migration-replay]
    steps:
      - run: node scripts/verify-release-evidence.mjs --verify
  staging-smoke:
    runs-on: ubuntu-latest
    needs: [evidence]
    steps:
      - run: node scripts/verify-boot.mjs
  dast:
    runs-on: ubuntu-latest
    needs: [staging-smoke]
    steps:
      - run: docker run ghcr.io/zaproxy/zaproxy@sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef zap-baseline.py
  staging-approval:
    runs-on: ubuntu-latest
    needs: [staging-smoke]
    if: inputs.staging_approved == true
    environment: staging
    steps:
      - run: echo staging-approved
  production:
    runs-on: ubuntu-latest
    needs: ${JSON.stringify(productionNeeds)}
    if: github.event_name == 'workflow_dispatch' && inputs.staging_approved == true
    environment: production
    env:
      RELEASE_ATTESTATION_VERIFIER: \${{ vars.RELEASE_ATTESTATION_VERIFIER }}
      PRODUCTION_ENVIRONMENT_VERIFIER: \${{ vars.PRODUCTION_ENVIRONMENT_VERIFIER }}
    steps:
      - run: node scripts/verify-release-evidence.mjs --verify --require-promotion
      - run: pnpm deploy:production
`;
}

const dispatchOnlyDeployment = `on:
  workflow_dispatch:
    inputs:
      approved_promotion:
        required: true
        type: boolean
jobs:
  deploy:
    if: github.event_name == 'workflow_dispatch' && inputs.approved_promotion == true
    environment: production
    steps:
      - run: deploy-production
`;

const functionManifest = JSON.parse(readFileSync(resolve(root, 'supabase/functions/manifest.json'), 'utf8'));

function analyze(checker, release, deployments = {}, manifest = functionManifest) {
  return checker.analyzeReleasePath({
    release,
    deployments,
    functionManifest: manifest,
  });
}

test('accepts a protected release graph with evidence before production', async () => {
  const checker = await loadChecker();
  const findings = analyze(checker, { '.github/workflows/release.yml': releaseFixture() }, {
    '.github/workflows/deploy-web.yml': `on:\n  workflow_dispatch:\n    inputs:\n      staging_approved:\n        required: true\n        type: boolean\n      staging_url:\n        required: true\n        type: string\njobs:\n  release:\n    if: github.event_name == 'workflow_dispatch' && inputs.staging_approved == true\n    uses: ./.github/workflows/release.yml\n    with:\n      staging_approved: \${{ inputs.staging_approved }}\n      staging_url: \${{ inputs.staging_url }}\n    secrets: inherit\n`,
  });

  assert.deepEqual(findings, []);
});

test('rejects a production deployment that can run on push', async () => {
  const checker = await loadChecker();
  const deployment = dispatchOnlyDeployment
    .replace('on:\n', 'on:\n  push:\n    branches: [main]\n')
    .replace("    if: github.event_name == 'workflow_dispatch' && inputs.approved_promotion == true", "    if: github.ref == 'refs/heads/main' && inputs.approved_promotion == true");
  const findings = analyze(checker, { '.github/workflows/release.yml': releaseFixture() }, {
    '.github/workflows/deploy-web.yml': deployment,
  });

  assert.ok(rules(findings).includes('production-push-trigger'));
});

test('rejects a security or quality job that is not a production dependency', async () => {
  const checker = await loadChecker();
  const release = releaseFixture({ productionNeeds: ['staging-approval'] }).replace(
    'needs: [sbom, sast, secret-scan, dependency-audit, tests, migration-replay]',
    'needs: [sbom, secret-scan, dependency-audit, tests, migration-replay]',
  );
  const findings = analyze(checker, { '.github/workflows/release.yml': release }, {});

  assert.ok(rules(findings).includes('promotion-dependency-required'));
});

test('rejects bypass environment controls', async () => {
  const checker = await loadChecker();
  const release = releaseFixture().replace(
    '  production:\n',
    '  production:\n    env:\n      RELEASE_BYPASS: "true"\n',
  );
  const findings = analyze(checker, { '.github/workflows/release.yml': release }, {});

  assert.ok(rules(findings).includes('bypass-environment-forbidden'));
});

test('requires explicit staging approval', async () => {
  const checker = await loadChecker();
  const release = releaseFixture()
    .replace('    if: inputs.staging_approved == true\n    environment: staging\n', '    environment: staging\n')
    .replace('    if: github.event_name == \'workflow_dispatch\' && inputs.staging_approved == true\n', '    if: github.event_name == \'workflow_dispatch\'\n');
  const findings = analyze(checker, { '.github/workflows/release.yml': release }, {});

  assert.ok(rules(findings).includes('staging-approval-required'));
});

test('rejects missing release evidence or SBOM gates', async () => {
  const checker = await loadChecker();
  const release = releaseFixture()
    .replace('      - run: node scripts/generate-release-evidence.mjs --all\n', '      - run: echo sbom\n')
    .replace('      - run: node scripts/verify-release-evidence.mjs --verify\n', '      - run: echo evidence\n');
  const findings = analyze(checker, { '.github/workflows/release.yml': release }, {});

  assert.ok(rules(findings).includes('sbom-gate-required'));
  assert.ok(rules(findings).includes('evidence-gate-required'));
});

test('requires promotion-mode evidence verification at the production boundary', async () => {
  const checker = await loadChecker();
  const release = releaseFixture().replace(
    'node scripts/verify-release-evidence.mjs --verify --require-promotion',
    'node scripts/verify-release-evidence.mjs --verify --deterministic-only',
  );
  const findings = analyze(checker, { '.github/workflows/release.yml': release }, {});

  assert.ok(rules(findings).includes('promotion-evidence-gate-required'));
});

test('requires external attestation and production environment verifiers', async () => {
  const checker = await loadChecker();
  const release = releaseFixture()
    .replace(/^\s*RELEASE_ATTESTATION_VERIFIER:.*\n/m, '')
    .replace(/^\s*PRODUCTION_ENVIRONMENT_VERIFIER:.*\n/m, '');
  const findings = analyze(checker, { '.github/workflows/release.yml': release }, {});

  assert.ok(rules(findings).includes('release-attestation-verifier-required'));
  assert.ok(rules(findings).includes('production-environment-verifier-required'));
});

test('requires release workflow to exist and be dispatch-only', async () => {
  const checker = await loadChecker();
  const findings = checker.analyzeReleasePath({
    release: {},
    deployments: {},
  });

  assert.ok(rules(findings).includes('release-workflow-required'));
  assert.ok(rules(findings).includes('release-dispatch-only'));
});

test('requires staging DAST as a promotion dependency', async () => {
  const checker = await loadChecker();
  const release = releaseFixture().replace(/  dast:\n[\s\S]*?  staging-approval:/, '  staging-approval:');
  const findings = analyze(checker, { '.github/workflows/release.yml': release }, {});

  assert.ok(rules(findings).includes('dast-gate-required'));
});

test('rejects top-level bypass environment blocks and inline push triggers', async () => {
  const checker = await loadChecker();
  const release = releaseFixture().replace(
    'permissions:\n',
    'env:\n  RELEASE_BYPASS: "true"\npermissions:\n',
  );
  const deployment = `on: [push, workflow_dispatch]\njobs:\n  deploy:\n    if: github.ref == 'refs/heads/main' && inputs.approved_promotion == true\n    environment: production\n    steps:\n      - run: deploy-production\n`;
  const findings = analyze(checker, { '.github/workflows/release.yml': release }, {
    '.github/workflows/deploy-web.yml': deployment,
  });

  assert.ok(rules(findings).includes('bypass-environment-forbidden'));
  assert.ok(rules(findings).includes('production-push-trigger'));
});

test('accepts a dispatch-only wrapper that delegates to the canonical release workflow', async () => {
  const checker = await loadChecker();
  const wrapper = `on:\n  workflow_dispatch:\n    inputs:\n      staging_approved:\n        required: true\n        type: boolean\n      staging_url:\n        required: true\n        type: string\njobs:\n  release:\n    if: github.event_name == 'workflow_dispatch' && inputs.staging_approved == true\n    uses: ./.github/workflows/release.yml\n    with:\n      staging_approved: \${{ inputs.staging_approved }}\n      staging_url: \${{ inputs.staging_url }}\n    secrets: inherit\n`;
  const findings = analyze(checker, { '.github/workflows/release.yml': releaseFixture() }, {
    '.github/workflows/deploy-web.yml': wrapper,
  });

  assert.deepEqual(findings, []);
});

test('preserves non-production preview workflows', async () => {
  const checker = await loadChecker();
  const preview = `on:\n  pull_request:\njobs:\n  deploy-preview:\n    environment: preview\n    steps:\n      - run: vercel deploy --yes\n`;
  const findings = analyze(checker, { '.github/workflows/release.yml': releaseFixture() }, {
    '.github/workflows/deploy-preview.yml': preview,
  });

  assert.deepEqual(findings, []);
});

test('rejects direct production commands hidden in a non-deployment job', async () => {
  const checker = await loadChecker();
  const deployment = `on:\n  workflow_dispatch:\n    inputs:\n      approved_promotion:\n        required: true\n        type: boolean\njobs:\n  checks:\n    steps:\n      - run: pnpm functions:deploy\n`;
  const findings = analyze(checker, { '.github/workflows/release.yml': releaseFixture() }, {
    '.github/workflows/deploy-web.yml': deployment,
  });

  assert.ok(rules(findings).includes('independent-production-command-forbidden'));
});

test('rejects an independent production environment job without a deploy command', async () => {
  const checker = await loadChecker();
  const deployment = `on:\n  workflow_dispatch:\n    inputs:\n      approved_promotion:\n        required: true\n        type: boolean\njobs:\n  checks:\n    environment:\n      name: production\n    steps:\n      - run: echo check\n`;
  const findings = analyze(checker, { '.github/workflows/release.yml': releaseFixture() }, {
    '.github/workflows/independent.yml': deployment,
  });

  assert.ok(rules(findings).includes('independent-production-job-forbidden'));
});

test('rejects a function scan that does not enumerate the manifest', async () => {
  const checker = await loadChecker();
  const release = releaseFixture().replace(
    /function_count=.*?test "\$\{scanned_count\}" -eq "\$\{function_count\}"/s,
    'deno check --frozen supabase/functions/payment-webhook/index.ts',
  );
  const findings = analyze(checker, { '.github/workflows/release.yml': release }, {}, {
    functions: {
      'payment-webhook': {},
      'ai-insights': {},
    },
  });

  assert.ok(rules(findings).includes('function-scan-manifest-required'));
  assert.ok(rules(findings).includes('function-scan-function-required'));
});

test('requires evidence, SAST, DAST, SBOM, and migration jobs as direct promotion dependencies', async () => {
  const checker = await loadChecker();
  const release = releaseFixture({ productionNeeds: ['staging-approval'] });
  const findings = analyze(checker, { '.github/workflows/release.yml': release }, {});

  for (const rule of ['promotion-dependency-required']) {
    assert.ok(rules(findings).includes(rule));
  }
});

test('rejects mutable dependency installs in release workflows', async () => {
  const checker = await loadChecker();
  const release = releaseFixture().replace(
    '      - run: pnpm install --frozen-lockfile\n      - run: pnpm typecheck',
    '      - run: pnpm install --frozen-lockfile=false\n      - run: pnpm typecheck',
  );
  const findings = analyze(checker, { '.github/workflows/release.yml': release }, {});

  assert.ok(rules(findings).includes('frozen-lockfile-required'));
});

test('rejects a reusable wrapper that omits canonical release inputs', async () => {
  const checker = await loadChecker();
  const wrapper = `on:\n  workflow_dispatch:\n    inputs:\n      approved_promotion:\n        required: true\n        type: boolean\njobs:\n  release:\n    if: github.event_name == 'workflow_dispatch' && inputs.approved_promotion == true\n    uses: ./.github/workflows/release.yml\n    secrets: inherit\n`;
  const findings = analyze(checker, { '.github/workflows/release.yml': releaseFixture() }, {
    '.github/workflows/deploy-web.yml': wrapper,
  });

  assert.ok(rules(findings).includes('release-delegation-input-required'));
});

test('is safe to import and exposes stable finding metadata', async () => {
  const checker = await loadChecker();
  const findings = analyze(checker, { '.github/workflows/release.yml': 'on:\n  push:\n' }, {});

  assert.ok(findings.length > 0);
  assert.ok(findings.every(({ path, line, rule }) =>
    typeof path === 'string' && Number.isInteger(line) && typeof rule === 'string'));
});
