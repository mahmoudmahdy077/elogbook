import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const backupScript = resolve(root, 'scripts', 'backup-db.sh');
const restoreScript = resolve(root, 'scripts', 'restore-db.sh');
const workflowPath = resolve(root, '.github', 'workflows', 'backup.yml');
const bash = process.env.BASH_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const urlScheme = ['postgresql', '://'].join('');
const secret = ['fixture', 'database', 'secret', 'value'].join('-');

function bashPath(value) {
  if (process.platform !== 'win32') return value;
  const normalized = value.replaceAll('\\', '/');
  return normalized.replace(/^([A-Za-z]):/, '/$1');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8',
    timeout: options.timeout || 120000,
  });
}

function runBash(script, env = {}) {
  return run(bash, ['-lc', `cd '${bashPath(root)}' && ${script}`], { env });
}

function writeExecutable(path, content) {
  writeFileSync(path, content, 'utf8');
  chmodSync(path, 0o700);
}

function createFixture() {
  const fixture = mkdtempSync(join(tmpdir(), 'elogbook-backup-flow-'));
  const bin = join(fixture, 'bin');
  const remote = join(fixture, 'remote');
  const backupDir = join(fixture, 'backups');
  const logFile = join(fixture, 'backup.log');
  const passFile = join(fixture, 'pgpass');
  const argvLog = join(fixture, 'pg-dump.argv');
  mkdirSync(bin, { recursive: true });
  mkdirSync(remote, { recursive: true });
  writeFileSync(passFile, `*:*:*:*:${secret}\n`, { mode: 0o600 });
  writeExecutable(join(bin, 'pg_dump'), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" > '${bashPath(argvLog)}'
printf 'SELECT 1;\\n'
`);
  writeExecutable(join(bin, 'encrypt'), `#!/usr/bin/env bash
set -eu
input="$1"
output="$2"
cp "$input" "$output"
printf '%s\\n' "$input $output" > '${bashPath(join(fixture, 'encrypt.log'))}'
`);
  writeExecutable(join(bin, 'upload'), `#!/usr/bin/env bash
set -eu
source_path="$1"
object_key="$2"
cp "$source_path" '${bashPath(remote)}/'$(basename "$object_key")
printf '%s\\n' "$object_key" >> '${bashPath(join(fixture, 'upload.log'))}'
`);
  writeExecutable(join(bin, 'decrypt'), `#!/usr/bin/env bash
set -eu
gzip -dc "$1" > "$2"
`);
  writeExecutable(join(bin, 'psql'), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" > '${bashPath(join(fixture, 'psql.log'))}'
`);
  writeExecutable(join(bin, 'verify'), `#!/usr/bin/env bash
set -eu
object_key="$1"
if [[ "\${BACKUP_REMOTE_CHECKSUM_OVERRIDE:-}" == "wrong" ]]; then
  printf '%064d\\n' 0
  exit 0
fi
sha256sum '${bashPath(remote)}/'$(basename "$object_key") | awk '{print $1}'
`);
  writeExecutable(join(bin, 'post-check'), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$1" > '${bashPath(join(fixture, 'post-check.log'))}'
`);
  writeExecutable(join(bin, 'kms-verify'), `#!/usr/bin/env bash
set -eu
[[ "\${BACKUP_KMS_VERIFY_FAIL:-}" != "1" ]] || exit 1
printf '%s\\n' 'verified'
`);
  writeExecutable(join(bin, 'object-lock-verify'), `#!/usr/bin/env bash
set -eu
[[ "\${BACKUP_OBJECT_LOCK_VERIFY_FAIL:-}" != "1" ]] || exit 1
printf '%s\\n' 'verified'
`);
  return { fixture, bin, remote, backupDir, logFile, passFile, argvLog };
}

function baseEnv(f, extra = {}) {
  return {
    PATH: `${bashPath(f.bin)}:${process.env.PATH || ''}`,
    PGHOST: 'db.example.test',
    PGPORT: '5432',
    PGUSER: 'backup_user',
    PGDATABASE: 'elogbook',
    PGPASSFILE: bashPath(f.passFile),
    BACKUP_DIR: bashPath(f.backupDir),
    LOG_FILE: bashPath(f.logFile),
    BACKUP_STORAGE_PROVIDER: 'storage-primary',
    BACKUP_ENCRYPTION_PROVIDER: 'encryption-primary',
    BACKUP_ENCRYPTION_HOOK: bashPath(join(f.bin, 'encrypt')),
    BACKUP_KMS_PROVIDER: 'kms-primary',
    BACKUP_KMS_KEY_REFERENCE: 'backup-key-primary-v1',
    BACKUP_KMS_VERIFY_HOOK: bashPath(join(f.bin, 'kms-verify')),
    BACKUP_OBJECT_LOCK_MODE: 'compliance',
    BACKUP_OBJECT_LOCK_RETENTION_DAYS: '30',
    BACKUP_OBJECT_LOCK_VERIFY_HOOK: bashPath(join(f.bin, 'object-lock-verify')),
    BACKUP_UPLOAD_HOOK: bashPath(join(f.bin, 'upload')),
    BACKUP_REMOTE_VERIFY_HOOK: bashPath(join(f.bin, 'verify')),
    BACKUP_DECRYPTION_HOOK: bashPath(join(f.bin, 'decrypt')),
    POST_RESTORE_CHECK_HOOK: bashPath(join(f.bin, 'post-check')),
    BACKUP_OBJECT_PREFIX: 'security-test',
    ...extra,
  };
}

function runBackup(f, extra = {}) {
  return runBash(`bash ./scripts/backup-db.sh`, baseEnv(f, extra));
}

test('uses discrete libpq settings and contains no database URL or password variable', () => {
  const sources = [backupScript, resolve(root, 'scripts', 'backup-config.sh'), workflowPath]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  for (const forbidden of ['SUPABASE_DB_URL', 'DB_URL', 'DATABASE_URL']) {
    assert.equal(sources.includes(forbidden), false, `forbidden variable ${forbidden}`);
  }
  assert.doesNotMatch(sources, /PGPASSWORD\s*=/);
  assert.match(sources, /PGHOST/);
  assert.match(sources, /PGPORT/);
  assert.match(sources, /PGUSER/);
  assert.match(sources, /PGDATABASE/);
  assert.match(sources, /PGPASSFILE/);
  assert.equal(sources.includes(urlScheme), false);
});

test('the application backup manager also uses secret files and durable gates', () => {
  const source = readFileSync(resolve(root, 'apps', 'web', 'lib', 'setup', 'backup-manager.ts'), 'utf8');
  assert.doesNotMatch(source, /PGPASSWORD\s*:/);
  assert.match(source, /PGPASSFILE/);
  assert.match(source, /sha256/i);
  assert.match(source, /BACKUP_UPLOAD_HOOK|BACKUP_REMOTE_VERIFY_HOOK/);
  assert.match(source, /BACKUP_KMS_PROVIDER/);
  assert.match(source, /BACKUP_KMS_KEY_REFERENCE/);
  assert.match(source, /BACKUP_KMS_VERIFY_HOOK/);
  assert.match(source, /BACKUP_OBJECT_LOCK_MODE/);
  assert.match(source, /BACKUP_OBJECT_LOCK_RETENTION_DAYS/);
  assert.match(source, /BACKUP_OBJECT_LOCK_VERIFY_HOOK/);
  assert.match(source, /disposable/i);
});

test('does not place a secret in pg_dump argv or backup logs', () => {
  const f = createFixture();
  try {
    const result = runBackup(f, { BACKUP_TEST_MODE: '1' });
    assert.equal(result.status, 0, result.stderr);
    const argv = readFileSync(f.argvLog, 'utf8');
    const logs = existsSync(f.logFile) ? readFileSync(f.logFile, 'utf8') : '';
    assert.equal(argv.includes(secret), false);
    assert.equal(argv.includes(urlScheme), false);
    assert.equal(logs.includes(secret), false);
    assert.equal(logs.includes(urlScheme), false);
  } finally {
    rmSync(f.fixture, { recursive: true, force: true });
  }
});

test('reports local-only output as non-durable', () => {
  const f = createFixture();
  try {
    const result = runBackup(f, { BACKUP_TEST_MODE: '1' });
    assert.match(result.stdout, /LOCAL_TEST_ONLY/);
    assert.doesNotMatch(result.stdout, /BACKUP_(?:DURABLE_)?SUCCESS|durable success/i);
  } finally {
    rmSync(f.fixture, { recursive: true, force: true });
  }
});

test('fails closed before dumping when approved encryption is not configured', () => {
  const f = createFixture();
  try {
    const result = runBackup(f, { BACKUP_ENCRYPTION_HOOK: '', BACKUP_ENCRYPTION_PROVIDER: '' });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(f.argvLog), false);
    assert.doesNotMatch(result.stdout, /BACKUP_DURABLE_SUCCESS/);
  } finally {
    rmSync(f.fixture, { recursive: true, force: true });
  }
});

test('fails closed before dumping when KMS identity or verification is absent', () => {
  const cases = [
    { BACKUP_KMS_PROVIDER: '', BACKUP_KMS_KEY_REFERENCE: '', BACKUP_KMS_VERIFY_HOOK: '' },
    { BACKUP_KMS_KEY_REFERENCE: 'REPLACE_WITH_LOCAL_KEY' },
    { BACKUP_KMS_VERIFY_HOOK: '' },
  ];
  for (const overrides of cases) {
    const f = createFixture();
    try {
      const result = runBackup(f, overrides);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(f.argvLog), false);
      assert.doesNotMatch(result.stdout, /BACKUP_DURABLE_SUCCESS/);
    } finally {
      rmSync(f.fixture, { recursive: true, force: true });
    }
  }
});

test('fails closed before dumping when object-lock controls are absent', () => {
  const cases = [
    { BACKUP_OBJECT_LOCK_MODE: '' },
    { BACKUP_OBJECT_LOCK_RETENTION_DAYS: '0' },
    { BACKUP_OBJECT_LOCK_VERIFY_HOOK: '' },
  ];
  for (const overrides of cases) {
    const f = createFixture();
    try {
      const result = runBackup(f, overrides);
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(f.argvLog), false);
      assert.doesNotMatch(result.stdout, /BACKUP_DURABLE_SUCCESS/);
    } finally {
      rmSync(f.fixture, { recursive: true, force: true });
    }
  }
});

test('does not report durable success when KMS or object-lock verification fails', () => {
  for (const env of [{ BACKUP_KMS_VERIFY_FAIL: '1' }, { BACKUP_OBJECT_LOCK_VERIFY_FAIL: '1' }]) {
    const f = createFixture();
    try {
      const result = runBackup(f, env);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /BACKUP_DURABLE_SUCCESS/);
    } finally {
      rmSync(f.fixture, { recursive: true, force: true });
    }
  }
});

test('refuses the local test mode in a production runtime', () => {
  const f = createFixture();
  try {
    const result = runBackup(f, { BACKUP_TEST_MODE: '1', NODE_ENV: 'production' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /LOCAL_TEST_ONLY/);
  } finally {
    rmSync(f.fixture, { recursive: true, force: true });
  }
});

test('verifies the remote SHA-256 before reporting durable success', () => {
  const f = createFixture();
  try {
    const result = runBackup(f, { BACKUP_REMOTE_CHECKSUM_OVERRIDE: 'wrong' });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /BACKUP_DURABLE_SUCCESS/);
    assert.ok(existsSync(join(f.fixture, 'upload.log')));
    const files = readdirSync(f.backupDir, { recursive: true }).map(String);
    assert.ok(files.some((file) => file.endsWith('.sha256')));
  } finally {
    rmSync(f.fixture, { recursive: true, force: true });
  }
});

test('uploads encrypted artifacts and reports durable success only after matching remote digests', () => {
  const f = createFixture();
  try {
    const result = runBackup(f);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /BACKUP_DURABLE_SUCCESS/);
    const uploaded = readFileSync(join(f.fixture, 'upload.log'), 'utf8').trim().split(/\r?\n/);
    assert.equal(uploaded.length, 4);
    assert.ok(readdirSync(f.remote).some((file) => file.endsWith('.db.enc')));
    assert.ok(readdirSync(f.remote).some((file) => file.endsWith('.config.enc')));
    assert.ok(readdirSync(f.remote).some((file) => file.endsWith('.manifest.json')));
    assert.ok(readdirSync(f.remote).some((file) => file.endsWith('.sha256')));
  } finally {
    rmSync(f.fixture, { recursive: true, force: true });
  }
});

test('sets restrictive permissions for backup directories and files', () => {
  const f = createFixture();
  try {
    const result = runBackup(f, { BACKUP_TEST_MODE: '1' });
    assert.equal(result.status, 0, result.stderr);
    const source = readFileSync(backupScript, 'utf8');
    assert.match(source, /umask 077/);
    assert.match(source, /chmod 600/);
    assert.match(source, /chmod 700|mkdir -m 700/);
    if (process.platform !== 'win32') {
      const allFiles = readdirSync(f.backupDir, { recursive: true });
      for (const relative of allFiles) {
        const mode = statSync(join(f.backupDir, relative)).mode & 0o777;
        assert.equal(mode & 0o077, 0, `${relative} is group/world accessible`);
      }
    }
  } finally {
    rmSync(f.fixture, { recursive: true, force: true });
  }
});

test('restores only a verified artifact into an explicit disposable target and runs the post-check hook', () => {
  const f = createFixture();
  try {
    const backup = runBackup(f);
    assert.equal(backup.status, 0, `${backup.stdout}\n${backup.stderr}`);
    const names = readdirSync(f.backupDir);
    const manifestName = names.find((name) => name.endsWith('.manifest.json'));
    const manifest = JSON.parse(readFileSync(join(f.backupDir, manifestName), 'utf8'));
    const databaseArtifact = manifest.artifacts.find(({ kind }) => kind === 'database');
    const artifactPath = join(f.backupDir, databaseArtifact.name);
    const checksum = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
    const result = runBash(
      `bash ./scripts/restore-db.sh --artifact '${bashPath(artifactPath)}' --manifest '${bashPath(join(f.backupDir, manifestName))}' --checksum ${checksum} --target-database restore_drill --disposable-target`,
      baseEnv(f),
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const psqlArgs = readFileSync(join(f.fixture, 'psql.log'), 'utf8');
    assert.equal(psqlArgs.includes(secret), false);
    assert.equal(psqlArgs.includes(urlScheme), false);
    assert.match(psqlArgs, /restore_drill/);
    assert.equal(readFileSync(join(f.fixture, 'post-check.log'), 'utf8').trim(), 'restore_drill');
  } finally {
    rmSync(f.fixture, { recursive: true, force: true });
  }
});

test('backup operations document KMS and object-lock blockers without approving local keys', () => {
  const strategy = readFileSync(resolve(root, 'docs', 'backup-strategy.md'), 'utf8');
  const drill = readFileSync(resolve(root, 'docs', 'operations', 'backup-drill.md'), 'utf8');

  assert.match(strategy, /BACKUP_KMS_VERIFY_HOOK/);
  assert.match(strategy, /BACKUP_OBJECT_LOCK_VERIFY_HOOK/);
  assert.match(strategy, /local placeholder keys[\s\S]*never production-approved/i);
  assert.match(drill, /local fixture[\s\S]*not production evidence/i);
  assert.doesNotMatch(`${strategy}\n${drill}`, /restore (?:has )?(?:passed|succeeded)/i);
});

test('restore rejects path traversal, unknown checksums, and missing disposable target', () => {
  const f = createFixture();
  try {
    assert.ok(existsSync(restoreScript));
    const manifest = join(f.fixture, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({
      format: 'elogbook-backup-v1',
      artifact: 'artifact.enc',
      artifact_sha256: 'unknown',
    }), 'utf8');
    const cases = [
      `'${bashPath(join(f.fixture, '..', 'outside.enc'))}'`,
      `'${bashPath(manifest)}'`,
    ];
    for (const artifact of cases) {
      const result = runBash(`bash ./scripts/restore-db.sh --artifact ${artifact} --manifest '${bashPath(manifest)}'`, baseEnv(f));
      assert.notEqual(result.status, 0);
    }
    const missingTarget = runBash(
      `bash ./scripts/restore-db.sh --artifact '${bashPath(join(f.fixture, 'artifact.enc'))}' --manifest '${bashPath(manifest)}' --checksum unknown`,
      baseEnv(f),
    );
    assert.notEqual(missingTarget.status, 0);
  } finally {
    rmSync(f.fixture, { recursive: true, force: true });
  }
});
