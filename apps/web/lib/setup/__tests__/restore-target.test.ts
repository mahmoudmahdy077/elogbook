import { describe, expect, it } from 'vitest';

// Control-plane restore targets (platform authority only).
//
// The caller never names a database. It supplies an opaque target id; the
// server derives the database name inside a private namespace and only accepts
// ids an operator has provisioned on this installation. Anything else — a
// system database, the live database, an arbitrary name — is refused before a
// single byte is decrypted or written.

import {
  RESERVED_DATABASE_NAMES,
  RESTORE_TARGET_PREFIX,
  isReservedDatabaseName,
  parseRestoreTargetAllowlist,
  resolveRestoreTarget,
  restoreTargetAllowlistFromEnv,
  restoreTargetDatabase,
} from '../restore-target';

describe('restore target derivation', () => {
  it('derives a namespaced database name from an opaque target id', () => {
    expect(restoreTargetDatabase('drill_1')).toBe(`${RESTORE_TARGET_PREFIX}drill_1`);
  });

  it('never returns a caller-supplied database name', () => {
    for (const candidate of [
      'postgres',
      'template1',
      'elogbook',
      'pg_catalog',
      'drill 1',
      'drill-1',
      'DRILL',
      '../pg_catalog',
      'drill_1; drop database postgres',
      '',
    ]) {
      expect(restoreTargetDatabase(candidate)).toBeNull();
    }
  });

  it('cannot alias another target: the id to name mapping is injective', () => {
    // A derived name is itself a syntactically valid id, so it must map to a
    // *third* database rather than resolving to the caller's string. Two ids
    // can therefore never share one database.
    const resolved = resolveRestoreTarget({
      targetId: 'elogbook_restore_drill_1',
      allowlist: ['elogbook_restore_drill_1', 'drill_1'],
    });
    expect(resolved).toEqual({
      ok: true,
      targetId: 'elogbook_restore_drill_1',
      database: 'elogbook_restore_elogbook_restore_drill_1',
    });
    expect(resolveRestoreTarget({ targetId: 'drill_1', allowlist: ['drill_1'] }))
      .toEqual({ ok: true, targetId: 'drill_1', database: 'elogbook_restore_drill_1' });
  });
});

describe('reserved database names', () => {
  it('reserves PostgreSQL, Supabase, and platform service databases', () => {
    for (const name of ['postgres', 'template0', 'template1', 'rdsadmin', 'defaultdb', 'supabase', 'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin']) {
      expect(RESERVED_DATABASE_NAMES.has(name)).toBe(true);
      expect(isReservedDatabaseName(name)).toBe(true);
    }
  });

  it('reserves the pg_ catalog and system namespace', () => {
    expect(isReservedDatabaseName('pg_catalog')).toBe(true);
    expect(isReservedDatabaseName('pg_toast')).toBe(true);
  });

  it('does not reserve a server-owned disposable target', () => {
    expect(isReservedDatabaseName('elogbook_restore_drill_1')).toBe(false);
  });
});

describe('parseRestoreTargetAllowlist', () => {
  it('keeps only well-formed, non-reserved target ids', () => {
    expect(parseRestoreTargetAllowlist('drill_1, drill_2')).toEqual(['drill_1', 'drill_2']);
    expect(parseRestoreTargetAllowlist('postgres,template1,BAD-NAME,,drill_1')).toEqual(['drill_1']);
  });

  it('treats an unset or empty allowlist as no provisioned targets', () => {
    expect(parseRestoreTargetAllowlist(undefined)).toEqual([]);
    expect(parseRestoreTargetAllowlist('')).toEqual([]);
  });

  it('de-duplicates repeated ids', () => {
    expect(parseRestoreTargetAllowlist('drill_1,drill_1')).toEqual(['drill_1']);
  });

  it('reads the allowlist from the environment', () => {
    expect(restoreTargetAllowlistFromEnv({ RESTORE_TARGET_ALLOWLIST: 'drill_9' })).toEqual(['drill_9']);
    expect(restoreTargetAllowlistFromEnv({})).toEqual([]);
  });
});

describe('resolveRestoreTarget', () => {
  it('resolves a provisioned target id to the server-owned database name', () => {
    const resolved = resolveRestoreTarget({ targetId: 'drill_1', allowlist: ['drill_1'] });
    expect(resolved).toEqual({ ok: true, targetId: 'drill_1', database: 'elogbook_restore_drill_1' });
  });

  it('refuses a system database even when an operator allowlists it', () => {
    for (const targetId of ['postgres', 'template1', 'pg_catalog', 'supabase']) {
      const resolved = resolveRestoreTarget({ targetId, allowlist: [targetId, 'drill_1'] });
      expect(resolved).toEqual({ ok: false, reason: 'reserved_database' });
    }
  });

  it('refuses a malformed target id', () => {
    for (const targetId of ['drill-1', 'Drill_1', 'drill_1; drop database postgres', '../x', '']) {
      const resolved = resolveRestoreTarget({ targetId, allowlist: [targetId] });
      expect(resolved).toEqual({ ok: false, reason: 'invalid_target_id' });
    }
  });

  it('refuses a target that was never provisioned on this installation', () => {
    expect(resolveRestoreTarget({ targetId: 'drill_2', allowlist: ['drill_1'] }))
      .toEqual({ ok: false, reason: 'not_provisioned' });
  });

  it('fails closed when no disposable target is provisioned', () => {
    expect(resolveRestoreTarget({ targetId: 'drill_1', allowlist: [] }))
      .toEqual({ ok: false, reason: 'not_provisioned' });
  });

  it('refuses a target that resolves to the live database', () => {
    expect(
      resolveRestoreTarget({
        targetId: 'drill_1',
        allowlist: ['drill_1'],
        productionDatabase: 'elogbook_restore_drill_1',
      }),
    ).toEqual({ ok: false, reason: 'production_database' });
  });
});
