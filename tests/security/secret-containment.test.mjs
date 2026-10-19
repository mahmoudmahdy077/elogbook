import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scannerPath = resolve(root, 'scripts', 'verify-secret-containment.mjs');

async function loadScanner() {
  assert.ok(readFileSync(scannerPath, 'utf8').length > 0, 'secret containment scanner must exist');
  return import(pathToFileURL(scannerPath).href);
}

function createFixtureRepository() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'elogbook-secret-containment-'));
  const serviceRoleJwt = [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    'eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzAwMDAwMDAwfQ',
    'c2lnbmF0dXJlLXBsYWNlaG9sZGVyLXNpZ25hdHVyZQ',
  ].join('.');
  const providerKey = ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('_');
  const privateKeyHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  const markdown = [
    '# Incident notes',
    '',
    '- Nested credential:',
    `  service_role_key: \`${serviceRoleJwt}\``,
  ].join('\n');
  const fixtures = {
    'service-role.env': `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleJwt}\n`,
    'provider.key': `PROVIDER_API_KEY=${providerKey}\n`,
    'private.key': `${privateKeyHeader}\n`,
    'incident.md': `${markdown}\n`,
  };

  for (const [path, content] of Object.entries(fixtures)) {
    writeFileSync(join(fixtureRoot, path), content, 'utf8');
  }
  writeFileSync(join(fixtureRoot, '.gitignore'), '.env*\nSECURITY_ALERT_ENV_SECRETS.md\n', 'utf8');
  execFileSync('git', ['init', '--quiet'], { cwd: fixtureRoot, stdio: 'ignore' });
  execFileSync('git', ['add', '--', '.'], { cwd: fixtureRoot, stdio: 'ignore' });
  writeFileSync(join(fixtureRoot, '.env.local'), `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleJwt}\n`, 'utf8');
  writeFileSync(
    join(fixtureRoot, 'SECURITY_ALERT_ENV_SECRETS.md'),
    `# Incident\n\nNested provider credential: ${providerKey}\n`,
    'utf8',
  );

  return { fixtureRoot, secrets: [serviceRoleJwt, providerKey, privateKeyHeader] };
}

test('fails closed on secret-bearing fixtures without exposing values', async () => {
  const { formatFinding, scanRepository } = await loadScanner();
  const { fixtureRoot, secrets } = createFixtureRepository();

  try {
    const trackedResult = scanRepository({ root: fixtureRoot });
    const result = scanRepository({ root: fixtureRoot, local: true });
    const report = result.findings.map(formatFinding).join('\n');

    assert.equal(trackedResult.failed, true);
    assert.equal(result.failed, true);
    assert.ok(result.findings.every((finding) =>
      Object.keys(finding).length === 4
      && typeof finding.path === 'string'
      && Number.isInteger(finding.line)
      && typeof finding.rule === 'string'
      && /^[0-9a-f]{12}$/.test(finding.hash)));
    assert.ok(result.findings.some(({ rule }) => rule === 'supabase-jwt'));
    assert.ok(result.findings.some(({ rule }) => rule === 'provider-key-prefix'));
    assert.ok(result.findings.some(({ rule }) => rule === 'private-key-header'));
    assert.ok(result.findings.some(({ rule }) => rule === 'secret-bearing-markdown'));
    for (const secret of secrets) {
      assert.ok(!report.includes(secret), 'scanner output contained a fixture secret');
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('rejects a synthetic real-shaped JWT', async () => {
  const { scanText } = await loadScanner();
  const syntheticJwt = [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    'eyJyb2xlIjoic2VydmljZV9yb2xlIn0',
    'c2lnbmF0dXJlLXBsYWNlaG9sZGVyLXNpZ25hdHVyZQ',
  ].join('.');
  const findings = scanText('fixture.ts', `SUPABASE_SERVICE_ROLE_KEY = ${syntheticJwt}`);

  assert.equal(findings.some(({ rule }) => rule === 'supabase-jwt'), true);
});

test('tracked Hermes staff workflow scripts contain no live credentials', () => {
  const scripts = [
    '.hermes/swarm/staff-workflows.mjs',
    '.hermes/swarm/staff-workflows-cleanup.mjs',
    '.hermes/swarm/staff-workflows-tombstone-svc.mjs',
  ];
  const legacyPassword = ['password', '123', '!'].join('');
  const jwtShape = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

  for (const script of scripts) {
    const source = readFileSync(resolve(root, script), 'utf8');
    assert.equal(jwtShape.test(source), false, `${script} contains a JWT-shaped credential`);
    assert.equal(source.includes(legacyPassword), false, `${script} contains a hardcoded shared password`);
    assert.equal(/password\s*[:=]\s*["'`][^"'`]+["'`]/i.test(source), false, `${script} contains a password literal`);
  }
});
