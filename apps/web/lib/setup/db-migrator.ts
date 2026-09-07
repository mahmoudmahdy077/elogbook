import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { Pool } from 'pg';

export interface MigrationResult {
  file: string;
  status: 'success' | 'error' | 'skipped';
  duration_ms: number;
  error?: string;
}

/**
 * Stable content checksum (T08). Changed files are evidence to STOP —
 * never to re-run or blind-mark. Exported for unit tests.
 */
export function computeMigrationChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Statements that cannot run inside a transaction block (T08). Such files
 * run unwrapped (autocommit); a mid-file failure can leave partial state,
 * which the error text says explicitly. Exported for unit tests.
 */
const NON_TRANSACTIONAL_RE = /\b(CONCURRENTLY|VACUUM\s+(?!FULL)|CREATE\s+DATABASE|ALTER\s+SYSTEM|REINDEX\s+(DATABASE|SYSTEM))\b/i;

export function isNonTransactionalMigration(sql: string): boolean {
  return NON_TRANSACTIONAL_RE.test(sql);
}

export interface MigrationProgress {
  total: number;
  completed: number;
  current: string;
  results: MigrationResult[];
}

async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const result = await pool.query(
    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
    [tableName]
  );
  return result.rows[0].exists;
}

async function getAppliedMigrations(pool: Pool): Promise<Map<string, string | null>> {
  const applied = new Map<string, string | null>();
  // Custom ledger (this migrator's own history).
  if (await tableExists(pool, 'schema_migrations')) {
    const result = await pool.query(
      'SELECT version, checksum FROM schema_migrations ORDER BY version'
    );
    for (const r of result.rows) applied.set(r.version, r.checksum ?? null);
  }
  // Authoritative Supabase CLI history (T08): adopted, never written by
  // this migrator (CLI bookkeeping stays the CLI's). Absence is normal on
  // databases the CLI never touched.
  try {
    const cli = await pool.query(
      'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version'
    );
    for (const r of cli.rows) {
      if (!applied.has(r.version)) applied.set(r.version, null);
    }
  } catch {
    // No CLI history present — custom ledger alone decides.
  }
  return applied;
}

async function ensureSchemaMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW(),
      filename TEXT NOT NULL,
      duration_ms INTEGER
    )
  `);
  await pool.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`);
}

function getMigrationFiles(migrationsDir: string): string[] {
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  return files;
}

export async function runMigrations(
  host: string,
  port: number,
  database: string,
  user: string,
  password: string,
  migrationsDir: string,
  onProgress?: (progress: MigrationProgress) => void
): Promise<MigrationResult[]> {
  const pool = new Pool({ host, port, database, user, password, max: 1 });

  try {
    // Serialize runners (T08/T10 one-lock model): a second migrator waits
    // rather than interleaving ledgers.
    await pool.query(`SELECT pg_advisory_lock(hashtext('elogbook-migrator'))`);
    try {
      return await runMigrationsLocked(pool, migrationsDir, onProgress);
    } finally {
      await pool.query(`SELECT pg_advisory_unlock(hashtext('elogbook-migrator'))`);
    }
  } finally {
    await pool.end();
  }
}

async function runMigrationsLocked(
  pool: Pool,
  migrationsDir: string,
  onProgress?: (progress: MigrationProgress) => void
): Promise<MigrationResult[]> {
  const files = getMigrationFiles(migrationsDir);
  const applied = await getAppliedMigrations(pool);
  await ensureSchemaMigrations(pool);

  const results: MigrationResult[] = [];

  // Fail fast (T08/F04): the first error stops the run; every unattempted
  // file is reported 'skipped' so a partial run can never read as fully
  // applied. Callers must treat any 'error' entry as a blocked release.
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const version = file.replace('.sql', '');
    const record = (r: MigrationResult) => {
      results.push(r);
      onProgress?.({ total: files.length, completed: i + 1, current: file, results });
    };

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    const checksum = computeMigrationChecksum(sql);

    if (applied.has(version)) {
      const recorded = applied.get(version);
      // A changed file is evidence to STOP, never to re-run or blind-mark.
      if (recorded !== null && recorded !== undefined && recorded !== checksum) {
        record({
          file,
          status: 'error',
          duration_ms: 0,
          error: `checksum mismatch for already-applied migration ${version}: file changed after application; refusing to continue`,
        });
        for (let j = i + 1; j < files.length; j++) {
          results.push({ file: files[j], status: 'skipped', duration_ms: 0 });
        }
        return results;
      }
      record({ file, status: 'skipped', duration_ms: 0 });
      continue;
    }

    const start = Date.now();
    const transactional = !isNonTransactionalMigration(sql);

    try {
      if (transactional) await pool.query('BEGIN');
      await pool.query(sql);
      await pool.query(
        'INSERT INTO schema_migrations (version, filename, duration_ms, checksum) VALUES ($1, $2, $3, $4)',
        [version, file, Date.now() - start, checksum]
      );
      if (transactional) await pool.query('COMMIT');

      const duration = Date.now() - start;
      record({ file, status: 'success', duration_ms: duration });
    } catch (error) {
      if (transactional) {
        try {
          await pool.query('ROLLBACK');
        } catch {
          // Already-aborted connection; the error below is authoritative.
        }
      }
      const duration = Date.now() - start;
      const errMsg = error instanceof Error ? error.message : String(error);
      const suffix = transactional
        ? ''
        : ' (non-transactional file: partial application possible — inspect before retrying)';
      record({ file, status: 'error', duration_ms: duration, error: errMsg + suffix });
      for (let j = i + 1; j < files.length; j++) {
        results.push({ file: files[j], status: 'skipped', duration_ms: 0 });
      }
      return results;
    }
  }

  return results;
}

export async function verifyMigrationState(
  host: string,
  port: number,
  database: string,
  user: string,
  password: string,
  migrationsDir: string
): Promise<{ applied: number; pending: number; total: number }> {
  const pool = new Pool({ host, port, database, user, password, max: 1 });

  try {
    const files = getMigrationFiles(migrationsDir);
    const applied = await getAppliedMigrations(pool);

    return {
      applied: applied.size,
      pending: files.length - applied.size,
      total: files.length,
    };
  } finally {
    await pool.end();
  }
}

export async function testConnection(
  host: string,
  port: number,
  database: string,
  user: string,
  password: string
): Promise<{ connected: boolean; version?: string; error?: string }> {
  const pool = new Pool({ host, port, database, user, password, max: 1 });

  try {
    const result = await pool.query('SELECT version()');
    return { connected: true, version: result.rows[0].version };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { connected: false, error: errMsg };
  } finally {
    await pool.end();
  }
}
