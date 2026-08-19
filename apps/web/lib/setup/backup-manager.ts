import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, copyFileSync } from 'fs';
import { join } from 'path';

const BACKUP_BASE = '/app/data/backups';
const AUTO_BACKUPS = '/app/data/backups/auto';
const RETENTION_PATH = '/app/data/retention.json';

const VALID_ID_RE = /^[\w-]+$/;

function resolveBackupPath(backupId: string): string {
  if (!backupId || !VALID_ID_RE.test(backupId)) {
    throw new Error('Invalid backup ID');
  }
  return join(AUTO_BACKUPS, backupId);
}

function isSafeDbValue(val: unknown): val is string {
  return typeof val === 'string' && val.length > 0 && val.length <= 256 && /^[a-zA-Z0-9_\-.:/ ]+$/.test(val);
}

export interface BackupManifest {
  backup_id: string;
  type: 'auto' | 'manual';
  trigger: string;
  elogbook_version: string;
  supabase_version: string;
  created_at: string;
  size_bytes: number;
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
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
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
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      size += getDirSize(filePath);
    } else {
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
    const result = execFileSync(
      'psql',
      ['-h', host, '-p', String(port), '-U', user, '-d', db, '-t', '-c', `SELECT COUNT(*) FROM ${table}`],
      { encoding: 'utf-8', timeout: 10000, env: { ...process.env, PGPASSWORD: pass } }
    );
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export async function createFullBackup(
  trigger: string,
  dbConfig: { host: string; port: number; database: string; user: string; password: string },
  versionInfo: { elogbook: string; supabase: string }
): Promise<BackupManifest> {
  const backupId = new Date().toISOString().replace(/[:.]/g, '-');
  if (!VALID_ID_RE.test(backupId)) {
    throw new Error('Invalid backup ID generated');
  }
  const backupDir = resolveBackupPath(backupId);
  ensureDir(backupDir);

  if (!isSafeDbValue(dbConfig.host) || !isSafeDbValue(String(dbConfig.port)) || !isSafeDbValue(dbConfig.user) || !isSafeDbValue(dbConfig.database) || !isSafeDbValue(dbConfig.password)) {
    throw new Error('Invalid database configuration');
  }

  // 1. Database dump
  const dbDumpPath = join(backupDir, 'database.sql.gz');
  execFileSync(
    'bash',
    ['-c', `pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} | gzip > "${dbDumpPath}"`],
    { encoding: 'utf-8', timeout: 600000, env: { ...process.env, PGPASSWORD: dbConfig.password } }
  );

  // 2. Config files
  const configFiles = ['/app/data/.env.local', '/opt/supabase/.env', '/app/data/versions.json'];
  for (const file of configFiles) {
    if (existsSync(/* turbopackIgnore: true */ file)) {
      const basename = file.split('/').pop() || 'config';
      copyFileSync(file, join(backupDir, basename));
    }
  }

  // 3. Caddy config
  if (existsSync(/* turbopackIgnore: true */ '/app/config/Caddyfile')) {
    copyFileSync('/app/config/Caddyfile', join(backupDir, 'Caddyfile'));
  }

  // 4. Storage files
  const storageDir = join(backupDir, 'storage');
  if (existsSync(/* turbopackIgnore: true */ '/opt/supabase/volumes/storage')) {
    execFileSync('cp', ['-r', '/opt/supabase/volumes/storage', storageDir], { timeout: 600000 });
  }

  // 5. Generate manifest
  const manifest: BackupManifest = {
    backup_id: backupId,
    type: 'auto',
    trigger,
    elogbook_version: versionInfo.elogbook,
    supabase_version: versionInfo.supabase,
    created_at: new Date().toISOString(),
    size_bytes: getDirSize(backupDir),
    contents: {
      database: existsSync(dbDumpPath),
      auth_users: true,
      storage_files: existsSync(storageDir),
      config: true,
      ssl_certs: existsSync(join(backupDir, 'Caddyfile')),
    },
    database_stats: {
      case_entries: countTableRows(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password, 'case_entries'),
      profiles: countTableRows(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password, 'profiles'),
      tenants: countTableRows(dbConfig.host, dbConfig.port, dbConfig.database, dbConfig.user, dbConfig.password, 'tenants'),
    },
  };

  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // 6. Apply retention
  await applyRetentionPolicy();

  return manifest;
}

export async function restoreFromBackup(
  backupId: string,
  dbConfig: { host: string; port: number; database: string; user: string; password: string }
): Promise<{ success: boolean; error?: string }> {
  if (!backupId || !VALID_ID_RE.test(backupId)) {
    return { success: false, error: 'Invalid backup ID' };
  }
  const backupDir = resolveBackupPath(backupId);
  if (!existsSync(backupDir)) {
    return { success: false, error: `Backup ${backupId} not found` };
  }

  try {
    // 1. Restore database
    const dbDumpPath = join(backupDir, 'database.sql.gz');
    if (existsSync(dbDumpPath)) {
      if (!isSafeDbValue(dbConfig.host) || !isSafeDbValue(String(dbConfig.port)) || !isSafeDbValue(dbConfig.user) || !isSafeDbValue(dbConfig.database) || !isSafeDbValue(dbConfig.password)) {
        return { success: false, error: 'Database configuration contains invalid characters' };
      }

      execFileSync(
        'bash',
        ['-c', `gunzip -c "${dbDumpPath}" | psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database}`],
        { encoding: 'utf-8', timeout: 600000, env: { ...process.env, PGPASSWORD: dbConfig.password } }
      );
    }

    // 2. Restore config files
    const envPath = join(backupDir, '.env.local');
    if (existsSync(envPath)) {
      copyFileSync(envPath, '/app/data/.env.local');
    }
    const versionsPath = join(backupDir, 'versions.json');
    if (existsSync(versionsPath)) {
      copyFileSync(versionsPath, '/app/data/versions.json');
    }

    return { success: true };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errMsg };
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
        // Skip invalid backups
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
    if (totalSize <= maxBytes && backups.length - deleted <= policy.minimum_kept) break;

    const ageDays = (Date.now() - new Date(backup.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const retentionDays = policy.auto_backups[backup.trigger as keyof typeof policy.auto_backups] || 14;

    if (ageDays > retentionDays || totalSize > maxBytes) {
      if (VALID_ID_RE.test(backup.backup_id)) {
        rmSync(resolveBackupPath(backup.backup_id), { recursive: true, force: true });
      }
      totalSize -= backup.size_bytes;
      deleted++;
    }
  }

  return deleted;
}

export async function verifyBackupIntegrity(backupId: string): Promise<boolean> {
  if (!backupId || !VALID_ID_RE.test(backupId)) return false;
  const backupDir = resolveBackupPath(backupId);
  if (!existsSync(backupDir)) return false;

  const manifestPath = join(backupDir, 'manifest.json');
  if (!existsSync(manifestPath)) return false;

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as BackupManifest;

  if (manifest.contents.database && !existsSync(join(backupDir, 'database.sql.gz'))) {
    return false;
  }

  return true;
}
