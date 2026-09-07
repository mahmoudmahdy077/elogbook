import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// T08/F04: the migrator must stop on first failure, reconcile CLI history,
// verify checksums, serialize runners, and run non-transactional files
// without a wrapping transaction. 'pg' is an npm package (mockable);
/// migration files live in a real temp dir.

const pgState = vi.hoisted(() => ({
  queries: [] as string[],
  failOnContent: '' as string,
  customApplied: [] as { version: string; checksum: string | null }[],
  cliApplied: [] as string[],
  cliTableExists: false,
}));

vi.mock('pg', () => ({
  Pool: vi.fn(function (this: unknown) {
    return {
      query: async (sql: string) => {
        pgState.queries.push(sql);
        if (pgState.failOnContent && sql.includes(pgState.failOnContent)) {
          throw new Error('simulated statement failure');
        }
        if (/supabase_migrations/i.test(sql)) {
          if (/information_schema|to_regclass|EXISTS/i.test(sql) && !/SELECT version/i.test(sql)) {
            return { rows: [{ exists: pgState.cliTableExists }] };
          }
          return { rows: pgState.cliApplied.map((v) => ({ version: v })) };
        }
        if (/FROM schema_migrations/i.test(sql)) {
          return {
            rows: pgState.customApplied.map((r) => ({ version: r.version, checksum: r.checksum })),
          };
        }
        if (/information_schema/i.test(sql)) {
          return { rows: [{ exists: true }] };
        }
        return { rows: [] };
      },
      end: async () => {},
    };
  }),
  default: {},
}));

import { runMigrations, computeMigrationChecksum } from '../db-migrator';

let dir = '';
function writeMigration(name: string, sql: string) {
  writeFileSync(join(dir, name), sql, 'utf-8');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'migrator-test-'));
  pgState.queries.length = 0;
  pgState.failOnContent = '';
  pgState.customApplied = [];
  pgState.cliApplied = [];
  pgState.cliTableExists = false;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const CONN = { host: 'h', port: 5432, database: 'd', user: 'u', password: 'p' } as const;
const run = () => runMigrations(CONN.host, CONN.port, CONN.database, CONN.user, CONN.password, dir);

describe('runMigrations fail-fast (F04)', () => {
  it('stops at the first error and skips the rest', async () => {
    writeMigration('01_ok.sql', 'SELECT 1;');
    writeMigration('02_bad.sql', 'THROW_ME SELECT broken;');
    writeMigration('03_ok.sql', 'SELECT 3;');
    pgState.failOnContent = 'THROW_ME';

    const results = await run();
    expect(results.map((r) => r.status)).toEqual(['success', 'error', 'skipped']);
    expect(results[1].error).toMatch(/simulated statement failure/);
    // 03_ok.sql content never executed.
    expect(pgState.queries.some((q) => q.includes('SELECT 3'))).toBe(false);
  });

  it('serializes runners with an advisory lock and releases it', async () => {
    writeMigration('01_ok.sql', 'SELECT 1;');
    await run();
    expect(pgState.queries.some((q) => /pg_advisory_lock/i.test(q))).toBe(true);
    expect(pgState.queries.some((q) => /pg_advisory_unlock/i.test(q))).toBe(true);
  });
});

describe('checksum reconciliation (T08)', () => {
  it('computes stable sha256 checksums', () => {
    expect(computeMigrationChecksum('SELECT 1;')).toMatch(/^[0-9a-f]{64}$/);
    expect(computeMigrationChecksum('SELECT 1;')).toBe(computeMigrationChecksum('SELECT 1;'));
    expect(computeMigrationChecksum('SELECT 1;')).not.toBe(computeMigrationChecksum('SELECT 2;'));
  });

  it('blocks on checksum mismatch instead of re-running or blind-marking', async () => {
    writeMigration('01_ok.sql', 'SELECT 1; -- v2 content');
    writeMigration('02_ok.sql', 'SELECT 2;');
    pgState.customApplied = [{ version: '01_ok', checksum: 'deadbeef' }];

    const results = await run();
    expect(results[0].status).toBe('error');
    expect(results[0].error).toMatch(/checksum mismatch/i);
    expect(results.map((r) => r.status)).toEqual(['error', 'skipped']);
  });
});

describe('CLI history adoption (T08)', () => {
  it('treats CLI-recorded versions as applied', async () => {
    writeMigration('01_ok.sql', 'SELECT 1;');
    pgState.cliTableExists = true;
    pgState.cliApplied = ['01_ok'];

    const results = await run();
    expect(results.map((r) => r.status)).toEqual(['skipped']);
    expect(pgState.queries.some((q) => q.includes('SELECT 1;'))).toBe(false);
  });
});

describe('non-transactional files (T08)', () => {
  it('runs CONCURRENTLY files without a wrapping transaction', async () => {
    writeMigration('01_mv.sql', 'REFRESH MATERIALIZED VIEW CONCURRENTLY case_stats_mv;');
    const results = await run();
    expect(results.map((r) => r.status)).toEqual(['success']);
    const idx = pgState.queries.findIndex((q) => q.includes('CONCURRENTLY'));
    const begins = pgState.queries.filter((q) => q === 'BEGIN').length;
    const commits = pgState.queries.filter((q) => q === 'COMMIT').length;
    expect(idx).toBeGreaterThan(-1);
    // No BEGIN/COMMIT pair wraps the file: transactional files use both.
    expect(begins).toBe(commits);
    expect(begins).toBe(0);
  });
});
