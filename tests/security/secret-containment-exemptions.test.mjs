import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanText } from '../../scripts/verify-secret-containment.mjs';

// Assembled from parts so this file does not itself carry a real-shaped
// secret, the same way secret-containment.test.mjs does it.
const JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJyb2xlIjoic2VydmljZV9yb2xlIn0',
  'abcdefghijklmnop',
].join('.');
const PROVIDER_KEY = ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('_');

function flagged(path, text) {
  return scanText(path, text).map((finding) => finding.rule);
}

test('a real secret is still caught inside a test file', () => {
  const rules = flagged('tests/security/x.test.mjs', `const key = 'SUPABASE_SERVICE_ROLE_KEY: ${JWT}';`);

  assert.ok(rules.includes('supabase-jwt'), `expected supabase-jwt, got ${rules.join(',')}`);
  assert.ok(rules.includes('supabase-service-role-assignment'));
});

test('a quoted provider key is still caught inside a test file', () => {
  const rules = flagged('tests/security/x.test.mjs', `const key = '${PROVIDER_KEY}';`);

  assert.ok(rules.includes('provider-key-prefix'), `expected provider-key-prefix, got ${rules.join(',')}`);
});

test('an unquoted secret is still caught in env and in source', () => {
  assert.ok(flagged('.env.example', `SUPABASE_SERVICE_ROLE_KEY=${JWT}`).includes('supabase-jwt'));
  assert.ok(flagged('apps/web/lib/x.ts', `const key = ${JWT};`).includes('supabase-jwt'));
});

test('an unquoted bare identifier in a test is indirection, not an embedded secret', () => {
  assert.deepEqual(
    flagged('tests/security/x.test.mjs', 'SUPABASE_SERVICE_ROLE_KEY: serviceRoleCanary'),
    [],
  );
});

test('the bare-identifier exemption does not apply outside tests', () => {
  assert.ok(
    flagged('apps/web/lib/x.ts', 'SUPABASE_SERVICE_ROLE_KEY: serviceRoleCanaryValue').length > 0,
    'a bare identifier in source must still be reported',
  );
});

test('a self-describing documentation placeholder is not a secret', () => {
  assert.deepEqual(
    flagged('docs/plan.md', "EMAIL_TOKEN_SIGNING_SECRET: 'token-secret-with-at-least-32-bytes'"),
    [],
  );
});

test('a cookie read in a documentation code sample is not a secret', () => {
  assert.deepEqual(
    flagged('docs/plan.md', "const token = request.cookies.get('csrf-token')?.value;"),
    [],
  );
});
