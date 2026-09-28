import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import {
  chmodSync,
   copyFileSync,
   existsSync,
   lstatSync,
   mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, join, relative, resolve, sep } from 'path';
import { logger } from '@/lib/logger';

const BACKUP_BASE = '/app/data/backups';
const AUTO_BACKUPS = '/app/data/backups/auto';
const RETENTION_PATH = '/app/data/retention.json';
const VALID_ID_RE = /^[\w-]+$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

type DbConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

type RestoreOptions = {
  disposableTarget: true;
  targetDatabase: string;
  postRestoreCheckHook: string;
};

type BackupArtifact = {
  name: string;
  kind: 'database' | 'config' | 'storage';
  sha256: string;
};

type ProviderConfig = {
  encryptionHook: string;
  storageProvider: string;
  uploadHook: string;
  remoteVerifyHook: string;
  kmsProvider: string;
  kmsKeyReference: string;
  kmsVerifyHook: string;
  objectLockMode: 'compliance' | 'governance';
  objectLockRetentionDays: number;
  objectLockVerifyHook: string;
  testMode: boolean;
};

function isSafeDbValue(val: unknown): val is string {
  return typeof val === 'string' && val.length > 0 && val.length <= 256 && /^[a-zA-Z0-9_\-.:/ ]+$/.test(val);
}

function isSafeSecret(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\n') && !value.includes('\r') && !value.includes('\0');
}

function safeBackupDir(backupId: string): string {
  return safeBackupDirIn(AUTO_BACKUPS, backupId);
}

export function safeBackupDirIn(base: string, backupId: string): string {
  const id = basename(backupId);
  const dir = resolve(base, id);
  const rel = relative(base, dir);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error('Path traversal detected');
  }
  return dir;
}

export function buildDumpCommand(
  dbConfig: { host: string; port: number; database: string; user: string },
  dbDumpPath: string,
): string[] {
  return [
    '-c',
    `umask 077; set -o pipefail; pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} | gzip > "${dbDumpPath}"`,
  ];
}

export function buildRestoreCommand(
  dbConfig: { host: string; port: number; database: string; user: string },
  dbDumpPath: string,
): string[] {
  return [
    '-c',
    `set -o pipefail; gunzip -c "${dbDumpPath}" | psql -v ON_ERROR_STOP=1 -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database}`,
  ];
}

function buildPlainRestoreCommand(
  dbConfig: { host: string; port: number; database: string; user: string },
  sqlPath: string,
): string[] {
  return [
    '-c',
    `set -o pipefail; psql -v ON_ERROR_STOP=1 -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} --file "${sqlPath}"`,
  ];
}

export function shouldDeleteBackup(args: {
  ageDays: number;
  retentionDays: number;
  totalSize: number;
  maxBytes: number;
  keptCount: number;
  minimumKept: number;
}): boolean {
  if (args.keptCount <= args.minimumKept) return false;
  return args.ageDays > args.retentionDays || args.totalSize > args.maxBytes;
}

export interface BackupManifest {
  backup_id: string;
  type: 'auto' | 'manual';
  trigger: string;
  elogbook_version: string;
  supabase_version: string;
  created_at: string;
  size_bytes: number;
  durability: 'durable' | 'local-test-only';
  checksum_algorithm: 'SHA-256';
  key_management: {
    provider: string;
    key_reference_sha256: string;
  };
  object_lock: {
    mode: 'compliance' | 'governance' | 'local-test-only';
    retention_days: number;
  };
  artifacts: BackupArtifact[];
  contents: {
    database: boolean;
    auth_users: boolean;
    storage_files: boolean;
    config: boolean;
    ssl_certs: boolean;
  };
  database_stats: Record<string, number>;
}

export interface RetentionPolicy {
  auto_backups: { daily: number; pre_update: number; pre_restart: number };
  manual_backups: { retention: string };
  minimum_kept: number;
  max_total_size_gb: number;
}

function ensureDir(dir: string): void {
  if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error('Backup directory cannot be a symlink');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  chmodSync(dir, 0o700);
}

function writePrivateFile(path: string, content: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Backup file cannot be a symlink');
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
}

function withPrivateUmask<T>(callback: () => T): T {
  const previous = process.umask(0o077);
  try {
    return callback();
  } finally {
    process.umask(previous);
  }
}

function sha256File(path: string): string {
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (!SHA256_RE.test(digest)) throw new Error('SHA-256 generation failed');
  return digest;
}

function withPgPassFile<T>(password: string, callback: (env: NodeJS.ProcessEnv) => T): T {
  if (!isSafeSecret(password)) throw new Error('Invalid database secret');
  const directory = mkdtempSync(join(tmpdir(), 'elogbook-pgpass-'));
  const passFile = join(directory, 'pgpass');
  try {
    ensureDir(directory);
    const escaped = password.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
    writePrivateFile(passFile, `*:*:*:*:${escaped}\n`);
    const env: NodeJS.ProcessEnv = { ...process.env, PGPASSFILE: passFile };
    delete env.PGPASSWORD;
    return callback(env);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runHook(hook: string, args: string[], timeout = 600000): string {
  if (!hook || !existsSync(hook) || lstatSync(hook).isSymbolicLink()) throw new Error('Backup provider hook is not configured');
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PGPASSWORD;
  try {
    return execFileSync(hook, args, {
      encoding: 'utf8',
      timeout,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('Backup provider hook failed');
  }
}

function productionProviderValue(name: string, value: string): string {
  if (!value || !/^[A-Za-z0-9._:/-]+$/.test(value)) throw new Error(`${name} is not configured`);
  if (/(?:local|placeholder|replace|example|dummy|test|fixture|changeme)/i.test(value)) {
    throw new Error(`${name} is not production-approved`);
  }
  return value;
}

function verifyProviderResult(hook: string, args: string[]): void {
  if (runHook(hook, args, 60_000).trim() !== 'verified') {
    throw new Error('Backup provider verification failed');
  }
}

function providerConfig(): ProviderConfig {
  const testModeRequested = process.env.BACKUP_TEST_MODE === '1' || process.env.BACKUP_TEST_MODE === 'true';
  const productionRuntime = process.env.NODE_ENV === 'production' || process.env.BACKUP_ENVIRONMENT === 'production';
  if (testModeRequested && productionRuntime) throw new Error('Local test mode is forbidden in production');
  const testMode = testModeRequested;
  const encryptionHook = process.env.BACKUP_ENCRYPTION_HOOK || '';
  const storageProvider = process.env.BACKUP_STORAGE_PROVIDER || '';
  const uploadHook = process.env.BACKUP_UPLOAD_HOOK || '';
  const remoteVerifyHook = process.env.BACKUP_REMOTE_VERIFY_HOOK || '';
  const kmsProvider = process.env.BACKUP_KMS_PROVIDER || '';
  const kmsKeyReference = process.env.BACKUP_KMS_KEY_REFERENCE || '';
  const kmsVerifyHook = process.env.BACKUP_KMS_VERIFY_HOOK || '';
  const objectLockMode = process.env.BACKUP_OBJECT_LOCK_MODE || '';
  const objectLockRetentionDays = Number(process.env.BACKUP_OBJECT_LOCK_RETENTION_DAYS || 0);
  const objectLockVerifyHook = process.env.BACKUP_OBJECT_LOCK_VERIFY_HOOK || '';
  if (!encryptionHook || !/^[A-Za-z0-9._:/-]+$/.test(encryptionHook)) throw new Error('Approved backup encryption is not configured');
  if (!testMode) {
    productionProviderValue('BACKUP_STORAGE_PROVIDER', storageProvider);
    productionProviderValue('BACKUP_KMS_PROVIDER', kmsProvider);
    productionProviderValue('BACKUP_KMS_KEY_REFERENCE', kmsKeyReference);
    if (!uploadHook || !remoteVerifyHook || !kmsVerifyHook || !objectLockVerifyHook) {
      throw new Error('Durable backup provider verification is not configured');
    }
    if (objectLockMode !== 'compliance' && objectLockMode !== 'governance') {
      throw new Error('Backup object-lock mode is invalid');
    }
    if (!Number.isInteger(objectLockRetentionDays) || objectLockRetentionDays < 1 || objectLockRetentionDays > 3650) {
      throw new Error('Backup object-lock retention is invalid');
    }
  }
  return {
    encryptionHook,
    storageProvider,
    uploadHook,
    remoteVerifyHook,
    kmsProvider,
    kmsKeyReference,
    kmsVerifyHook,
    objectLockMode: objectLockMode === 'governance' ? 'governance' : 'compliance',
    objectLockRetentionDays,
    objectLockVerifyHook,
    testMode,
  };
}

function objectPrefix(): string {
  const prefix = process.env.BACKUP_OBJECT_PREFIX || 'elogbook/backups';
  if (!/^[A-Za-z0-9._:/-]+$/.test(prefix) || prefix.startsWith('/') || prefix.includes('..') || prefix.includes('//')) {
    throw new Error('Backup object prefix is invalid');
  }
  return prefix;
}

function encryptFile(input: string, output: string, hook: string): void {
  if (existsSync(output)) throw new Error('Encrypted output already exists');
  runHook(hook, [input, output]);
  if (!existsSync(output) || lstatSync(output).isSymbolicLink() || statSync(output).size === 0) throw new Error('Encryption hook returned no artifact');
  chmodSync(output, 0o600);
}

function verifyRemoteArtifact(path: string, name: string, config: ProviderConfig): void {
  const expected = sha256File(path);
  const key = `${objectPrefix()}/${name}`;
  runHook(config.uploadHook, [path, key, expected]);
  const remote = runHook(config.remoteVerifyHook, [key, expected]).replace(/[\r\n\s]/g, '').toLowerCase();
  if (!SHA256_RE.test(remote) || remote !== expected) {
    throw new Error('Remote backup checksum verification failed');
  }
  verifyProviderResult(config.objectLockVerifyHook, [
    key,
    config.objectLockMode,
    String(config.objectLockRetentionDays),
  ]);
}

function getRetentionPolicy(): RetentionPolicy {
  if (existsSync(RETENTION_PATH)) {
    return JSON.parse(readFileSync(RETENTION_PATH, 'utf-8'));
  }
  return {
    auto_backups: { daily: 14, pre_update: 30, pre_restart: 7 },
    manual_backups: { retention: 'permanent' },
    minimum_kept: 3,
    max_total_size_gb: 10,
  };
}

function getDirSize(dir: string): number {
  let size = 0;
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = lstatSync(filePath);
    if (stat.isDirectory()) {
      size += getDirSize(filePath);
    } else if (stat.isFile()) {
      size += stat.size;
    }
  }
  return size;
}

function countTableRows(host: string, port: number, db: string, user: string, pass: string, table: string): number {
  if (!isSafeDbValue(host) || !isSafeDbValue(String(port)) || !isSafeDbValue(db) || !isSafeDbValue(user) || !isSafeDbValue(pass) || !isSafeDbValue(table)) {
    return 0;
  }
  try {
    return withPgPassFile(pass, (env) => {
      const result = execFileSync(
        'psql',
        ['-h', host, '-p', String(port), '-U', user, '-d', db, '-t', '-c', `SELECT COUNT(*) FROM ${table}`],
        { encoding: 'utf-8', timeout: 10000, env },
      );
      return parseInt(result.trim(), 10) || 0;
    });
  } catch {
    return 0;
  }
}

function assertValidDbConfig(dbConfig: DbConfig): void {
  if (!isSafeDbValue(dbConfig.host) || !isSafeDbValue(String(dbConfig.port)) || !isSafeDbValue(dbConfig.user) || !isSafeDbValue(dbConfig.database) || !isSafeSecret(dbConfig.password)) {
    throw new Error('Invalid database configuration');
  }
}

function manifestArtifactPath(backupDir: string, artifact: BackupArtifact): string {
  if (!/^[A-Za-z0-9._-]+$/.test(artifact.name) || basename(artifact.name) !== artifact.name) {
    throw new Error('Backup artifact path is invalid');
  }
  return join(backupDir, artifact.name);
}

function verifyManifest(backupDir: string, manifest: BackupManifest): boolean {
  if (manifest.checksum_algorithm !== 'SHA-256' || !Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) return false;
  try {
    for (const artifact of manifest.artifacts) {
      if (!SHA256_RE.test(artifact.sha256)) return false;
      const artifactPath = manifestArtifactPath(backupDir, artifact);
      if (!existsSync(artifactPath) || lstatSync(artifactPath).isSymbolicLink() || !statSync(artifactPath).isFile() || sha256File(artifactPath) !== artifact.sha256) return false;
    }
    const checksumPath = join(backupDir, 'checksums.sha256');
    if (!existsSync(checksumPath) || lstatSync(checksumPath).isSymbolicLink() || !statSync(checksumPath).isFile()) return false;
    const checksumLines = readFileSync(checksumPath, 'utf8').trim().split(/\r?\n/);
    if (checksumLines.length !== manifest.artifacts.length + 1) return false;
    const expectedEntries = new Map<string, string>([
      ...manifest.artifacts.map(({ name, sha256 }) => [name, sha256] as const),
      ['manifest.json', sha256File(join(backupDir, 'manifest.json'))],
    ]);
    const seen = new Set<string>();
    for (const line of checksumLines) {
      const match = /^([0-9a-f]{64})\s{2}([A-Za-z0-9._-]+)$/.exec(line);
      if (!match || expectedEntries.get(match[2]) !== match[1] || seen.has(match[2])) return false;
      seen.add(match[2]);
    }
    return seen.size === expectedEntries.size;
  } catch {
    return false;
  }
}

export async function createFullBackup(
  trigger: string,
  dbConfig: DbConfig,
  versionInfo: { elogbook: string; supabase: string },
): Promise<BackupManifest> {
  const backupId = new Date().toISOString().replace(/[:.]/g, '-');
  if (!VALID_ID_RE.test(backupId)) throw new Error('Invalid backup ID generated');
  assertValidDbConfig(dbConfig);
  const config = providerConfig();
  const backupDir = safeBackupDir(backupId);
  ensureDir(backupDir);

  try {
    if (!config.testMode) {
      verifyProviderResult(config.kmsVerifyHook, [config.kmsProvider, config.kmsKeyReference]);
    }
    const dbDumpPath = join(backupDir, 'database.sql.gz');
    withPgPassFile(dbConfig.password, (env) => {
      execFileSync('bash', buildDumpCommand(dbConfig, dbDumpPath), {
        encoding: 'utf-8',
        timeout: 600000,
        env,
      });
    });
    try {
      execFileSync('gzip', ['-t', dbDumpPath], { timeout: 60000 });
      if (statSync(dbDumpPath).size === 0) throw new Error('empty dump');
    } catch {
      throw new Error('Database dump failed integrity check; backup aborted');
    }

    const encryptedDatabasePath = join(backupDir, 'database.sql.gz.enc');
    encryptFile(dbDumpPath, encryptedDatabasePath, config.encryptionHook);
    rmSync(dbDumpPath, { force: true });

    const artifacts: BackupArtifact[] = [{ name: 'database.sql.gz.enc', kind: 'database', sha256: sha256File(encryptedDatabasePath) }];
    const configFiles = ['/app/data/.env.local', '/opt/supabase/.env', '/app/data/versions.json'];
    let configIncluded = false;
    for (const [index, file] of configFiles.entries()) {
      if (!existsSync(file) || lstatSync(file).isSymbolicLink() || !statSync(file).isFile()) continue;
      const staged = join(backupDir, `.config-${index}.source`);
      const encrypted = join(backupDir, `config-${index}.enc`);
      copyFileSync(file, staged);
      chmodSync(staged, 0o600);
      encryptFile(staged, encrypted, config.encryptionHook);
      rmSync(staged, { force: true });
      artifacts.push({ name: basename(encrypted), kind: 'config', sha256: sha256File(encrypted) });
      configIncluded = true;
    }

    if (existsSync('/opt/supabase/volumes/storage') && !lstatSync('/opt/supabase/volumes/storage').isSymbolicLink() && statSync('/opt/supabase/volumes/storage').isDirectory()) {
      const archive = join(backupDir, 'storage.tar');
      const encrypted = join(backupDir, 'storage.tar.enc');
      withPrivateUmask(() => {
        execFileSync('tar', ['-cf', archive, '-C', '/opt/supabase/volumes/storage', '.'], { timeout: 600000 });
      });
      chmodSync(archive, 0o600);
      encryptFile(archive, encrypted, config.encryptionHook);
      rmSync(archive, { force: true });
      artifacts.push({ name: basename(encrypted), kind: 'storage', sha256: sha256File(encrypted) });
    }

    const manifest: BackupManifest = {
      backup_id: backupId,
      type: 'auto',
      trigger,
      elogbook_version: versionInfo.elogbook,
      supabase_version: versionInfo.supabase,
      created_at: new Date().toISOString(),
      size_bytes: 0,
      durability: 'local-test-only',
      checksum_algorithm: 'SHA-256',
      key_management: {
        provider: config.kmsProvider || 'local-test-only',
        key_reference_sha256: createHash('sha256').update(config.kmsKeyReference).digest('hex'),
      },
      object_lock: {
        mode: config.testMode ? 'local-test-only' : config.objectLockMode,
        retention_days: config.testMode ? 0 : config.objectLockRetentionDays,
      },
      artifacts,
      contents: {
        database: true,
        auth_users: true,
        storage_files: artifacts.some(({ kind }) => kind === 'storage'),
        config: configIncluded,
        ssl_certs: false,
      },
      database_stats: {
        case_entries: countTableRows(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password, 'case_entries'),
        profiles: countTableRows(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password, 'profiles'),
        tenants: countTableRows(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password, 'tenants'),
      },
    };
    const manifestPath = join(backupDir, 'manifest.json');
    writePrivateFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const checksumPath = join(backupDir, 'checksums.sha256');
    manifest.size_bytes = getDirSize(backupDir);
    writePrivateFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const finalManifestHash = sha256File(manifestPath);
    const checksumLines = [
      ...artifacts.map(({ name, sha256 }) => `${sha256}  ${name}`),
      `${finalManifestHash}  manifest.json`,
    ];
    writePrivateFile(checksumPath, `${checksumLines.join('\n')}\n`);
    manifest.size_bytes = getDirSize(backupDir);
    writePrivateFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const stableManifestHash = sha256File(manifestPath);
    writePrivateFile(checksumPath, `${[
      ...artifacts.map(({ name, sha256 }) => `${sha256}  ${name}`),
      `${stableManifestHash}  manifest.json`,
    ].join('\n')}\n`);

    if (!config.testMode) {
      for (const artifact of artifacts) verifyRemoteArtifact(join(backupDir, artifact.name), artifact.name, config);
      verifyRemoteArtifact(manifestPath, 'manifest.json', config);
      verifyRemoteArtifact(checksumPath, 'checksums.sha256', config);
      manifest.durability = 'durable';
      manifest.size_bytes = getDirSize(backupDir);
      writePrivateFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const finalManifestHash = sha256File(manifestPath);
      writePrivateFile(checksumPath, `${[
        ...artifacts.map(({ name, sha256 }) => `${sha256}  ${name}`),
        `${finalManifestHash}  manifest.json`,
      ].join('\n')}\n`);
      verifyRemoteArtifact(manifestPath, 'manifest.json', config);
      verifyRemoteArtifact(checksumPath, 'checksums.sha256', config);
    }

    await applyRetentionPolicy();
    return manifest;
  } catch (error) {
    rmSync(backupDir, { recursive: true, force: true });
    throw error instanceof Error ? error : new Error('Backup failed');
  }
}

export async function restoreFromBackup(
  backupId: string,
  dbConfig: DbConfig,
  options?: Partial<RestoreOptions>,
): Promise<{ success: boolean; error?: string }> {
  if (!backupId || !VALID_ID_RE.test(backupId) || backupId !== basename(backupId) || backupId.includes('/') || backupId.includes('\\')) {
    return { success: false, error: 'Invalid backup ID' };
  }
  if (options?.disposableTarget !== true || !options.targetDatabase || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(options.targetDatabase) || options.targetDatabase === dbConfig.database) {
    return { success: false, error: 'An explicit disposable target is required' };
  }
  if (!options.postRestoreCheckHook || !existsSync(options.postRestoreCheckHook) || lstatSync(options.postRestoreCheckHook).isSymbolicLink()) {
    return { success: false, error: 'A post-restore checks hook is required' };
  }
  if (!isSafeDbValue(dbConfig.host) || !isSafeDbValue(String(dbConfig.port)) || !isSafeDbValue(dbConfig.user) || !isSafeSecret(dbConfig.password)) {
    return { success: false, error: 'Database configuration contains invalid characters' };
  }
  const backupDir = safeBackupDir(backupId);
  if (!existsSync(backupDir)) return { success: false, error: 'Backup not found' };

  const manifestPath = join(backupDir, 'manifest.json');
  if (!existsSync(manifestPath)) return { success: false, error: 'Backup manifest is missing' };
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as BackupManifest;
  } catch {
    return { success: false, error: 'Backup manifest is invalid' };
  }
  if (!verifyManifest(backupDir, manifest)) return { success: false, error: 'Backup checksum verification failed' };
  if (manifest.durability !== 'durable' && process.env.BACKUP_TEST_MODE !== '1' && process.env.BACKUP_TEST_MODE !== 'true') {
    return { success: false, error: 'Backup is not marked durable' };
  }
  const databaseArtifact = manifest.artifacts.find(({ kind }) => kind === 'database');
  if (!databaseArtifact) return { success: false, error: 'Backup has no verified database artifact' };
  const decryptionHook = process.env.BACKUP_DECRYPTION_HOOK || '';
  if (!decryptionHook) return { success: false, error: 'Approved backup decryption is not configured' };

  const staging = mkdtempSync(join(tmpdir(), 'elogbook-restore-'));
  try {
    ensureDir(staging);
    const plainPath = join(staging, 'database.sql');
    runHook(decryptionHook, [manifestArtifactPath(backupDir, databaseArtifact), plainPath]);
    if (!existsSync(plainPath) || lstatSync(plainPath).isSymbolicLink() || statSync(plainPath).size === 0) throw new Error('Decryption hook returned no SQL');
    chmodSync(plainPath, 0o600);
    const targetConfig = { ...dbConfig, database: options.targetDatabase };
    withPgPassFile(dbConfig.password, (env) => {
      execFileSync('bash', buildPlainRestoreCommand(targetConfig, plainPath), {
        encoding: 'utf-8',
        timeout: 600000,
        env,
      });
    });
    runHook(options.postRestoreCheckHook, [options.targetDatabase]);
    return { success: true };
  } catch {
    return { success: false, error: 'Restore or post-restore checks failed' };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function listBackups(type: 'auto' | 'manual' = 'auto'): BackupManifest[] {
  const dir = join(BACKUP_BASE, type);
  if (!existsSync(dir)) return [];

  const backups: BackupManifest[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const manifestPath = join(dir, entry, 'manifest.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
        backups.push(manifest);
      } catch {
        continue;
      }
    }
  }
  return backups.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function applyRetentionPolicy(): Promise<number> {
  const policy = getRetentionPolicy();
  if (!existsSync(AUTO_BACKUPS)) return 0;

  const backups = listBackups('auto');
  let deleted = 0;
  let totalSize = backups.reduce((sum, b) => sum + b.size_bytes, 0);
  const maxBytes = policy.max_total_size_gb * 1024 * 1024 * 1024;

  for (const backup of backups) {
    const ageDays = (Date.now() - new Date(backup.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const retentionDays = policy.auto_backups[backup.trigger as keyof typeof policy.auto_backups] || 14;
    if (
      shouldDeleteBackup({
        ageDays,
        retentionDays,
        totalSize,
        maxBytes,
        keptCount: backups.length - deleted,
        minimumKept: policy.minimum_kept,
      })
    ) {
      const dir = safeBackupDir(backup.backup_id);
      rmSync(dir, { recursive: true, force: true });
      totalSize -= backup.size_bytes;
      deleted += 1;
    }
  }

  if (totalSize > maxBytes) {
    logger.warn('Backup retention over quota with minimum sets kept', {
      totalSize,
      maxBytes,
      minimumKept: policy.minimum_kept,
    });
  }
  return deleted;
}

export async function verifyBackupIntegrity(backupId: string): Promise<boolean> {
  if (!backupId || !VALID_ID_RE.test(backupId) || backupId !== basename(backupId)) return false;
  const backupDir = safeBackupDir(backupId);
  if (!existsSync(backupDir)) return false;
  const manifestPath = join(backupDir, 'manifest.json');
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as BackupManifest;
    return verifyManifest(backupDir, manifest);
  } catch {
    return false;
  }
}
