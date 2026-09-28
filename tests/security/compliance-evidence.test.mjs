import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const validatorPath = resolve(root, 'scripts', 'verify-compliance-evidence.mjs');

async function loadValidator() {
  assert.ok(existsSync(validatorPath), 'compliance evidence validator must exist');
  return import(`${pathToFileURL(validatorPath).href}?test=${Date.now()}`);
}

function rules(findings) {
  return findings.map(({ rule }) => rule);
}

function validControl() {
  return {
    id: 'TEST-1',
    title: 'Test control',
    owner: 'Security owner',
    implementation_paths: ['scripts/verify-compliance-evidence.mjs'],
    test_ci_references: ['tests/security/compliance-evidence.test.mjs'],
    evidence_artifacts: ['SECURITY.md'],
    review_date: '2026-09-24',
    vendor_baa_status: 'pending',
    exception_expiry: null,
  };
}

test('parses the repository YAML and accepts the checked-in evidence set', async () => {
  const { parseYaml, validateRepository } = await loadValidator();
  const result = validateRepository({ root, today: '2026-09-24' });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
  assert.ok(parseYaml('version: 1\ncontrols:\n  - id: TEST-1\n'));
});

test('rejects missing required control fields and ownerless controls', async () => {
  const { validateDocuments } = await loadValidator();
  const matrix = {
    version: 1,
    controls: [
      { ...validControl(), owner: '', implementation_paths: [] },
    ],
  };
  const result = validateDocuments({
    root,
    today: '2026-09-24',
    matrix,
    vendors: { vendors: [] },
    exceptions: { exceptions: [] },
    claims: [],
  });

  assert.equal(result.ok, false);
  assert.ok(rules(result.findings).includes('ownerless-control'));
  assert.ok(rules(result.findings).includes('missing-required-field'));
});

test('rejects expired exceptions, missing evidence paths, and unsupported claims', async () => {
  const { scanUnsupportedClaims, validateDocuments } = await loadValidator();
  const exception = {
    id: 'EXC-TEST',
    title: 'Test exception',
    owner: 'Security owner',
    status: 'open',
    expires_on: '2026-01-01',
    review_date: '2026-09-24',
    evidence_artifacts: ['SECURITY.md'],
    compensating_controls: ['Stop production promotion'],
  };
  const result = validateDocuments({
    root,
    today: '2026-09-24',
    matrix: {
      version: 1,
      controls: [{
        ...validControl(),
        id: 'TEST-2',
        implementation_paths: ['scripts/does-not-exist.mjs'],
        evidence_artifacts: ['docs/does-not-exist.md'],
        exception_id: 'EXC-TEST',
        exception_expiry: '2026-01-01',
      }],
    },
    vendors: { vendors: [] },
    exceptions: { exceptions: [exception] },
    claims: [{
      path: 'SECURITY.md',
      text: 'The service is HIPAA compliant and encrypted at rest with SQLCipher; signed artifacts are complete.',
      evidencePaths: [],
    }],
  });

  assert.equal(result.ok, false);
  assert.ok(rules(result.findings).includes('expired-exception'));
  assert.ok(rules(result.findings).includes('missing-evidence-path'));
  assert.ok(rules(result.findings).includes('unsupported-claim'));
  assert.deepEqual(
    scanUnsupportedClaims('SECURITY.md', 'The service is encrypted.', { root, evidencePaths: ['SECURITY.md'] }),
    [],
  );
});

test('redacts secret-like values in findings and emits deterministic order', async () => {
  const { formatFinding, validateDocuments } = await loadValidator();
  const secret = ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('_');
  const result = validateDocuments({
    root,
    today: '2026-09-24',
    matrix: { version: 1, controls: [{ ...validControl(), evidence_artifacts: [secret] }] },
    vendors: { vendors: [] },
    exceptions: { exceptions: [] },
    claims: [],
  });
  const output = result.findings.map(formatFinding).join('\n');

  assert.equal(result.ok, false);
  assert.ok(!output.includes(secret));
  assert.ok(!formatFinding({ path: 'SECURITY.md', line: 1, rule: 'test', message: secret }).includes(secret));
  assert.equal(formatFinding(result.findings[0]), formatFinding(result.findings[0]));
});
