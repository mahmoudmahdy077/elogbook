import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, copyFileSync } from 'fs';
import { join } from 'path';

const BACKUP_BASE = '/app/data/backups';
const RETENTION_PATH = '/app/data/retention.json';

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
  try {
    const result = execSync(
      `PGPASSWORD=${pass} psql -h ${host} -p ${port} -U ${user} -d ${db} -t -c "SELECT COUNT(*) FROM ${table}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 10000 }
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
  const backupDir = join(BACKUP_BASE, 'auto', backupId);
  ensureDir(backupDir);

  // 1. Database dump
  const dbDumpPath = join(backupDir, 'database.sql.gz');
  execSync(
    `PGPASSWORD=${dbConfig.password} pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} | gzip > "${dbDumpPath}"`,
    { encoding: 'utf-8', timeout: 600000 }
  );

  // 2. Config files
  const configFiles = ['/app/data/.env.local', '/opt/supabase/.env', '/app/data/versions.json'];
  for (const file of configFiles) {
    if (existsSync(file)) {
      copyFileSync(file, join(backupDir, file.split('/').pop()!));
    }
  }

  // 3. Caddy config
  if (existsSync('/app/config/Caddyfile')) {
    copyFileSync('/app/config/Caddyfile', join(backupDir, 'Caddyfile'));
  }

  // 4. Storage files
  const storageDir = join(backupDir, 'storage');
  if (existsSync('/opt/supabase/volumes/storage')) {
    execSync(`cp -r /opt/supabase/volumes/storage "${storageDir}"`, { timeout: 600000 });
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
  const backupDir = join(BACKUP_BASE, 'auto', backupId);
  if (!existsSync(backupDir)) {
    return { success: false, error: `Backup ${backupId} not found` };
  }

  try {
    // 1. Restore database
    const dbDumpPath = join(backupDir, 'database.sql.gz');
    if (existsSync(dbDumpPath)) {
      execSync(
        `gunzip -c "${dbDumpPath}" | PGPASSWORD=${dbConfig.password} psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database}`,
        { encoding: 'utf-8', timeout: 600000 }
      );
    }

    // 2. Restore config files
    if (existsSync(join(backupDir, '.env.local'))) {
      copyFileSync(join(backupDir, '.env.local'), '/app/data/.env.local');
    }
    if (existsSync(join(backupDir, 'versions.json'))) {
      copyFileSync(join(backupDir, 'versions.json'), '/app/data/versions.json');
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
  const autoDir = join(BACKUP_BASE, 'auto');
  if (!existsSync(autoDir)) return 0;

  const backups = listBackups('auto');
  let deleted = 0;

  // Enforce max total size
  let totalSize = backups.reduce((sum, b) => sum + b.size_bytes, 0);
  const maxBytes = policy.max_total_size_gb * 1024 * 1024 * 1024;

  for (const backup of backups) {
    if (totalSize <= maxBytes && backups.length - deleted <= policy.minimum_kept) break;

    const ageDays = (Date.now() - new Date(backup.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const retentionDays = policy.auto_backups[backup.trigger as keyof typeof policy.auto_backups] || 14;

    if (ageDays > retentionDays || totalSize > maxBytes) {
      rmSync(join(autoDir, backup.backup_id), { recursive: true, force: true });
      totalSize -= backup.size_bytes;
      deleted++;
    }
  }

  return deleted;
}

export async function verifyBackupIntegrity(backupId: string): Promise<boolean> {
  const backupDir = join(BACKUP_BASE, 'auto', backupId);
  if (!existsSync(backupDir)) return false;

  const manifestPath = join(backupDir, 'manifest.json');
  if (!existsSync(manifestPath)) return false;

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as BackupManifest;

  // Check database dump exists
  if (manifest.contents.database && !existsSync(join(backupDir, 'database.sql.gz'))) {
    return false;
  }

  return true;
}
