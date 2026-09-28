import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const checkerPath = resolve(root, 'scripts', 'verify-pinned-supply-chain.mjs');

async function loadChecker() {
  assert.ok(existsSync(checkerPath), 'pinned supply-chain checker must exist');
  return import(pathToFileURL(checkerPath).href);
}

function rules(findings) {
  return findings.map(({ rule }) => rule);
}

test('rejects mutable action refs and checkout credential persistence', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const findings = analyzeWorkflow('.github/workflows/fixture.yml', `jobs:
  check:
    steps:
      - uses: actions/checkout@v4
`);

  assert.ok(rules(findings).includes('action-ref-not-immutable'));
  assert.ok(rules(findings).includes('checkout-persist-credentials-required'));
  assert.ok(findings.every(({ path, line, message }) =>
    path === '.github/workflows/fixture.yml' && Number.isInteger(line) && message.length > 0));
});

test('accepts an immutable action ref with credentials disabled', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const findings = analyzeWorkflow('.github/workflows/fixture.yml', `jobs:
  check:
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false
`);

  assert.deepEqual(findings, []);
});

test('accepts inline checkout credential persistence settings', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const findings = analyzeWorkflow('.github/workflows/fixture.yml', `jobs:
  check:
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with: { persist-credentials: false }
`);

  assert.deepEqual(findings, []);
});

test('rejects mutable base and scanner image tags', async () => {
  const { analyzeDockerfile, analyzeCompose, analyzeWorkflow } = await loadChecker();
  const dockerfile = analyzeDockerfile('apps/web/Dockerfile', `FROM node:22-alpine AS base\n`);
  const compose = analyzeCompose('docker-compose.yml', `services:\n  caddy:\n    image: caddy:2\n`);
  const workflow = analyzeWorkflow('.github/workflows/fixture.yml', `jobs:
  scan:
    container:
      image: acme/scanner:latest
`);
  const dockerCommand = analyzeWorkflow('.github/workflows/fixture.yml', `jobs:
  scan:
    steps:
      - run: docker run --rm acme/scanner:latest
`);

  assert.ok(rules(dockerfile).includes('image-digest-required'));
  assert.ok(rules(compose).includes('image-digest-required'));
  assert.ok(rules(workflow).includes('image-digest-required'));
  assert.ok(rules(dockerCommand).includes('image-digest-required'));
});

test('rejects npx --yes without an exact tool version', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const findings = analyzeWorkflow('.github/workflows/fixture.yml', `jobs:
  sbom:
    steps:
      - run: npx --yes @cyclonedx/cyclonedx-npm --output-file sbom.json
`);

  assert.ok(rules(findings).includes('npx-tool-unpinned'));
  assert.ok(findings.some(({ message }) => message.includes('exact version')));
});

test('rejects npx --yes even when the top-level tool is exact', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const findings = analyzeWorkflow('.github/workflows/fixture.yml', `jobs:
  sbom:
    steps:
      - run: npx --yes @cyclonedx/cyclonedx-npm@6.0.1 --output-file sbom.json
`);

  assert.ok(rules(findings).includes('npx-yes-forbidden'));
  assert.ok(findings.some(({ message }) => message.includes('remove npx --yes')));
});

test('rejects Deno lock and type-check bypasses', async () => {
  const { analyzeDenoConfig, analyzeWorkflow } = await loadChecker();
  const config = analyzeDenoConfig('supabase/functions/payment-webhook/deno.json', `{\n  "lock": false\n}\n`);
  const workflow = analyzeWorkflow('.github/workflows/fixture.yml', `jobs:
  deno:
    steps:
      - run: deno test --no-lock --no-check supabase/functions/payment-webhook/index.test.ts
`);

  assert.ok(rules(config).includes('deno-lock-disabled'));
  assert.ok(rules(workflow).includes('deno-no-lock'));
  assert.ok(rules(workflow).includes('deno-no-check'));
});

test('detects Deno bypass flags split across a continued command', async () => {
  const { analyzeWorkflow } = await loadChecker();
  const findings = analyzeWorkflow('.github/workflows/fixture.yml', `jobs:
  deno:
    steps:
      - run: |
          deno test \\
            --no-lock \\
            --no-check supabase/functions/payment-webhook/index.test.ts
`);

  assert.ok(rules(findings).includes('deno-no-lock'));
  assert.ok(rules(findings).includes('deno-no-check'));
});

test('reports precise operator-required messages for unresolved pins', async () => {
  const { analyzeWorkflow, analyzeDockerfile } = await loadChecker();
  const action = analyzeWorkflow('.github/workflows/fixture.yml', `jobs:
  check:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
`);
  const image = analyzeDockerfile('apps/web/Dockerfile', 'FROM node:22-alpine\n');

  assert.match(action[0].message, /operator-required.*actions\/checkout@v4.*40-character/i);
  assert.match(image[0].message, /operator-required.*node:22-alpine.*sha256/i);
});
