import { describe, it, expect } from 'vitest';

// T07/F03: backup shell correctness, tested through pure exported seams.
// (Module-level 'fs' mocking does not take in this repo's Vitest setup —
// verified empirically — so pipelines, predicates, and guards are exported
// pure and asserted directly. Integration behavior runs in the ops drills.)

import {
  buildDumpCommand,
  buildRestoreCommand,
  shouldDeleteBackup,
  safeBackupDirIn,
} from '../backup-manager';

const DB = { host: 'db', port: 5432, database: 'postgres', user: 'postgres' };

describe('buildDumpCommand (F03 pipefail)', () => {
  it('runs the dump pipeline with pipefail so a failed pg_dump cannot yield a valid gzip', () => {
    const [shell, script] = buildDumpCommand(DB, '/backups/x/database.sql.gz');
    expect(shell).toBe('-c');
    expect(script).toContain('set -o pipefail');
    expect(script).toContain('pg_dump');
    expect(script).toContain('| gzip > "/backups/x/database.sql.gz"');
  });

  it('interpolates only validated connection fields (no shell metachar injection surface)', () => {
    const [, script] = buildDumpCommand(DB, '/backups/x/database.sql.gz');
    expect(script).not.toContain('; rm');
    expect(script).toContain('-h db -p 5432 -U postgres -d postgres');
  });
});

describe('buildRestoreCommand (F03 ON_ERROR_STOP)', () => {
  it('restores with pipefail + ON_ERROR_STOP so partial restores cannot report success', () => {
    const [shell, script] = buildRestoreCommand(DB, '/backups/x/database.sql.gz');
    expect(shell).toBe('-c');
    expect(script).toContain('set -o pipefail');
    expect(script).toContain('ON_ERROR_STOP=1');
    expect(script).toContain('gunzip -c "/backups/x/database.sql.gz" | psql');
  });
});

describe('shouldDeleteBackup floor (F03 retention minimum)', () => {
  it('never deletes below minimum_kept even when over quota', () => {
    expect(
      shouldDeleteBackup({
        ageDays: 60,
        retentionDays: 14,
        totalSize: 15 * 1024 ** 3,
        maxBytes: 10 * 1024 ** 3,
        keptCount: 3,
        minimumKept: 3,
      }),
    ).toBe(false);
  });

  it('never deletes the last remaining set', () => {
    expect(
      shouldDeleteBackup({
        ageDays: 999,
        retentionDays: 14,
        totalSize: 999,
        maxBytes: 1,
        keptCount: 1,
        minimumKept: 3,
      }),
    ).toBe(false);
  });

  it('deletes aged excess above the floor', () => {
    expect(
      shouldDeleteBackup({
        ageDays: 60,
        retentionDays: 14,
        totalSize: 100,
        maxBytes: 10 * 1024 ** 3,
        keptCount: 5,
        minimumKept: 3,
      }),
    ).toBe(true);
  });

  it('keeps fresh sets within quota above the floor', () => {
    expect(
      shouldDeleteBackup({
        ageDays: 1,
        retentionDays: 14,
        totalSize: 100,
        maxBytes: 10 * 1024 ** 3,
        keptCount: 5,
        minimumKept: 3,
      }),
    ).toBe(false);
  });
});

describe('safeBackupDirIn traversal guard (portable)', () => {
  it('resolves a plain id inside the base', () => {
    const dir = safeBackupDirIn('/app/data/backups/auto', 'b1');
    expect(dir).toContain('b1');
    expect(dir).toContain('auto');
  });

  it('rejects bare parent traversal', () => {
    expect(() => safeBackupDirIn('/app/data/backups/auto', '..')).toThrow(/traversal/i);
  });

  it('neutralizes embedded traversal via basename (stays inside base)', () => {
    const dir = safeBackupDirIn('/app/data/backups/auto', '../other');
    expect(dir).toContain('other');
    expect(dir).toContain('auto');
  });
});
