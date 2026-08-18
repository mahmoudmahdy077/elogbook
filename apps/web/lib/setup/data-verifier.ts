import { Pool } from 'pg';

export interface IntegrityReport {
  timestamp: string;
  tables: Record<string, number>;
  auth_users: number;
  storage_files: number;
  all_healthy: boolean;
}

async function countRows(pool: Pool, table: string): Promise<number> {
  try {
    const result = await pool.query(`SELECT COUNT(*) FROM ${table}`);
    return parseInt(result.rows[0].count, 10);
  } catch {
    return -1;
  }
}

export async function verifyDataIntegrity(
  host: string,
  port: number,
  database: string,
  user: string,
  password: string
): Promise<IntegrityReport> {
  const pool = new Pool({ host, port, database, user, password, max: 1 });

  try {
    const tables = [
      'case_entries', 'profiles', 'tenants', 'case_templates',
      'approval_requests', 'audit_logs', 'subscription_plans',
      'goals', 'rotations', 'comments',
    ];

    const tableCounts: Record<string, number> = {};
    for (const table of tables) {
      tableCounts[table] = await countRows(pool, table);
    }

    return {
      timestamp: new Date().toISOString(),
      tables: tableCounts,
      auth_users: 0,
      storage_files: 0,
      all_healthy: Object.values(tableCounts).every(c => c >= 0),
    };
  } finally {
    await pool.end();
  }
}
