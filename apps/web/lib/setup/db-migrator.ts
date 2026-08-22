import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

export interface MigrationResult {
  file: string;
  status: 'success' | 'error' | 'skipped';
  duration_ms: number;
  error?: string;
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

async function getAppliedMigrations(pool: Pool): Promise<string[]> {
  const exists = await tableExists(pool, 'schema_migrations');
  if (!exists) return [];

  const result = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  return result.rows.map(r => r.version);
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
    const files = getMigrationFiles(migrationsDir);
    const applied = await getAppliedMigrations(pool);
    await ensureSchemaMigrations(pool);

    const results: MigrationResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const version = file.replace('.sql', '');

      if (applied.includes(version)) {
        results.push({ file, status: 'skipped', duration_ms: 0 });
        onProgress?.({ total: files.length, completed: i + 1, current: file, results });
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      const start = Date.now();

      try {
        await pool.query('BEGIN');
        await pool.query(sql);
        await pool.query(
          'INSERT INTO schema_migrations (version, filename, duration_ms) VALUES ($1, $2, $3)',
          [version, file, Date.now() - start]
        );
        await pool.query('COMMIT');

        const duration = Date.now() - start;
        results.push({ file, status: 'success', duration_ms: duration });
      } catch (error) {
        await pool.query('ROLLBACK');
        const duration = Date.now() - start;
        const errMsg = error instanceof Error ? error.message : String(error);
        results.push({ file, status: 'error', duration_ms: duration, error: errMsg });
      }

      onProgress?.({ total: files.length, completed: i + 1, current: file, results });
    }

    return results;
  } finally {
    await pool.end();
  }
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
      applied: applied.length,
      pending: files.length - applied.length,
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
