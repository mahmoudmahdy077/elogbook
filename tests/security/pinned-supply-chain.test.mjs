import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const checkerPath = resolve(root, 'scripts', 'verify-pinned-supply-chain.mjs');
const pnpmfilePath = resolve(root, '.pnpmfile.cjs');
const lockfilePath = resolve(root, 'pnpm-lock.yaml');

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

const RANGE_PNPMFILE = `function readPackage(pkg, context) {
  if (pkg.dependencies && pkg.dependencies['fast-uri'] && /^(\^|~)?3\./.test(pkg.dependencies['fast-uri'])) {
    pkg.dependencies['fast-uri'] = '3.1.8'
  }
  return pkg
}
module.exports = { hooks: { readPackage } }
`;

const PARENT_PNPMFILE = `function readPackage(pkg, context) {
  if (pkg.name === 'next') {
    if (pkg.dependencies && pkg.dependencies.postcss) {
      pkg.dependencies.postcss = '8.5.24'
    }
  }
  return pkg
}
module.exports = { hooks: { readPackage } }
`;

const LOOP_PNPMFILE = `function readPackage(pkg, context) {
  if (pkg.dependencies) {
    for (const dependency of Object.keys(pkg.dependencies)) {
      if (/^metro(?:-.+)?$/.test(dependency) && /^(?:\^|~)?0\.84\.[0-4]$/.test(pkg.dependencies[dependency])) {
        pkg.dependencies[dependency] = '0.84.6'
      }
    }
  }
  return pkg
}
module.exports = { hooks: { readPackage } }
`;

function lock(...keys) {
  return `lockfileVersion: '9.0'\n\nimporters:\n  .: {}\n\npackages:\n${keys.map((k) => `  ${k}`).join('\n')}\n`;
}

test('reads the pins the repository pnpmfile actually declares', async () => {
  const { parsePnpmfilePins } = await loadChecker();
  const pins = parsePnpmfilePins(readFileSync(pnpmfilePath, 'utf8'));
  const shape = (name) => {
    const pin = pins.find((entry) => entry.name === name);
    return { name: pin.name, versions: pin.versions, scope: pin.scope };
  };

  assert.deepEqual(shape('fast-uri'), { name: 'fast-uri', versions: ['3.1.8'], scope: 'range' });
  assert.deepEqual(shape('dompurify'), { name: 'dompurify', versions: ['3.4.13'], scope: 'range' });
  assert.deepEqual(shape('nanoid'), { name: 'nanoid', versions: ['3.3.18'], scope: 'range' });
  // Two targets: the rule rewrites a whole major line, so the lock may hold
  // either of them and nothing else.
  assert.deepEqual(shape('undici'), { name: 'undici', versions: ['6.28.1', '7.29.1'], scope: 'range' });
  // Guarded on the requesting parent, so a second version resolved by some
  // other parent is not drift.
  assert.deepEqual(shape('postcss'), { name: 'postcss', versions: ['8.5.24'], scope: 'parent' });
  assert.equal(pins.find((entry) => entry.name === 'sharp').scope, 'parent');
  assert.equal(pins.find((entry) => entry.name === 'brace-expansion').scope, 'parent');
  // The loop form is pinned too, and the loop's guard is not a parent check.
  assert.equal(pins.filter((pin) => pin.namePattern === 'metro(?:-.+)?').length, 1);
});

test('rejects a pin the lockfile never resolved', async () => {
  const { analyzeNpmPins } = await loadChecker();
  const findings = analyzeNpmPins({
    pnpmfileText: RANGE_PNPMFILE,
    lockfileText: lock('ajv@8.17.1: {}', 'fast-uri@3.1.7: {}'),
  });

  assert.deepEqual(rules(findings), ['npm-pin-not-in-lock']);
  assert.ok(findings.some(({ message }) => message.includes('fast-uri') && message.includes('3.1.8')));
});

test('rejects a second, unpinned version of a range-pinned package', async () => {
  const { analyzeNpmPins } = await loadChecker();
  const findings = analyzeNpmPins({
    pnpmfileText: RANGE_PNPMFILE,
    lockfileText: lock('fast-uri@3.1.8: {}', 'fast-uri@3.1.7: {}'),
  });

  assert.deepEqual(rules(findings), ['npm-pin-version-drift']);
  assert.ok(findings[0].message.includes('3.1.7'));
});

test('accepts a parent-scoped pin that is present beside another parent version', async () => {
  const { analyzeNpmPins } = await loadChecker();
  const findings = analyzeNpmPins({
    pnpmfileText: PARENT_PNPMFILE,
    lockfileText: lock('postcss@8.5.24: {}', 'postcss@8.5.26: {}'),
  });

  assert.deepEqual(findings, []);
});

test('accepts the loop form and checks every package it matches', async () => {
  const { analyzeNpmPins } = await loadChecker();
  const ok = analyzeNpmPins({
    pnpmfileText: LOOP_PNPMFILE,
    lockfileText: lock('metro@0.84.6: {}', 'metro-config@0.84.6: {}'),
  });
  const drifted = analyzeNpmPins({
    pnpmfileText: LOOP_PNPMFILE,
    lockfileText: lock('metro@0.84.6: {}', 'metro-config@0.84.5: {}'),
  });

  assert.deepEqual(ok, []);
  // metro-config resolved a version the loop's rule should have rewritten, so
  // the pin did not reach it. The rule is pattern-wide, so every package the
  // pattern matches is checked, not just the one named in the assignment.
  assert.deepEqual(rules(drifted), ['npm-pin-not-in-lock']);
  assert.ok(drifted[0].message.includes('metro-config'));
  assert.ok(drifted[0].message.includes('0.84.6'));
});

test('refuses to run when the lockfile is missing', async () => {
  const { analyzeNpmPins } = await loadChecker();
  const findings = analyzeNpmPins({ pnpmfileText: RANGE_PNPMFILE, lockfileText: null });

  assert.deepEqual(rules(findings), ['npm-pin-lock-missing']);
});

test("the repository's own pnpmfile and lockfile agree", async () => {
  const { analyzeNpmPins, lockfilePackageVersions } = await loadChecker();
  const findings = analyzeNpmPins({
    pnpmfileText: readFileSync(pnpmfilePath, 'utf8'),
    lockfileText: readFileSync(lockfilePath, 'utf8'),
  });

  assert.deepEqual(findings, []);

  // The named floor: fast-uri is exact and nothing else slipped in.
  const versions = lockfilePackageVersions(readFileSync(lockfilePath, 'utf8'));
  assert.deepEqual([...versions.get('fast-uri')], ['3.1.8']);
});

test('every advisory pin is at or above the patched version', () => {
  // A pin that satisfies today's advisory database still goes stale when a new
  // advisory lands against it: the rule keeps resolving, so nothing in the build
  // fails and the pin silently drifts back below the fix. Naming the floor here
  // turns that into a failing test that points at the exact rule to bump.
  //
  // Floors are keyed by major because several packages are pinned on more than
  // one line (undici 6 and 7, js-yaml 3 and 4), and each line has its own fix.
  const floors = {
    'fast-uri': { 3: '3.1.8' },
    'brace-expansion': { 5: '5.0.12' },
    nanoid: { 3: '3.3.18' },
    undici: { 6: '6.28.1', 7: '7.29.1' },
    'js-yaml': { 3: '3.15.1', 4: '4.3.2' },
    dompurify: { 3: '3.4.13' },
    uuid: { 11: '11.1.1' },
  };

  const pnpmfile = readFileSync(pnpmfilePath, 'utf8');
  const compare = (a, b) => {
    const left = a.split('.').map(Number);
    const right = b.split('.').map(Number);
    for (let i = 0; i < 3; i += 1) {
      if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
    }
    return 0;
  };

  for (const [name, byMajor] of Object.entries(floors)) {
    const pinned = [...pnpmfile.matchAll(new RegExp(`'${name}'\\] = '([^']+)'`, 'g'))]
      .map(([, version]) => version)
      // A `file:` pin is a local patch rather than a registry version: the
      // minimatch 3 line carries its own patched brace-expansion in-tree, and
      // there is no published version to compare it against.
      .filter((version) => !version.startsWith('file:'));
    assert.ok(pinned.length > 0, `${name} must be pinned in .pnpmfile.cjs`);

    for (const version of pinned) {
      const major = Number(version.split('.')[0]);
      const floor = byMajor[major];
      assert.ok(floor, `${name} is pinned to ${version}, which has no recorded advisory floor`);
      assert.ok(
        compare(version, floor) >= 0,
        `${name} is pinned to ${version}, below the patched floor ${floor}`,
      );
    }
  }
});

test('the repository scan reports no npm pin drift', async () => {
  const { scanRepository } = await loadChecker();
  const result = scanRepository();

  assert.deepEqual(
    result.findings.filter(({ rule }) => rule.startsWith('npm-pin-')),
    [],
  );
});