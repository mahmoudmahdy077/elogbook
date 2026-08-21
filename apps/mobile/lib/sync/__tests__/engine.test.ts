/**
 * SyncEngine comprehensive test suite — all cycles 3-4 validated.
 *
 * Tests: pull, push, LWW conflict resolution, idempotency, soft-delete
 * tombstones, batch operations, cursor persistence, full sync round-trip.
 *
 * Uses InMemorySyncRepository + a mock SyncRemote that simulates Supabase
 * behavior deterministically. No native deps, no network — runs in node vitest.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SyncEngine } from '../engine';
import { InMemorySyncRepository } from '../in-memory-repo';
import type { SyncRemote } from '../../sync/remote';
import type { SyncTable, RemoteRow, SyncRow } from '../repository';

// ---------------------------------------------------------------------------
// Mock remote that simulates Supabase pull/push
// ---------------------------------------------------------------------------
class MockRemote implements SyncRemote {
  remoteData: Map<SyncTable, RemoteRow[]> = new Map();
  pushLog: { table: SyncTable; rows: Record<string, unknown>[] }[] = [];
  shouldError = false;

  reset() {
    this.remoteData.clear();
    this.pushLog = [];
    this.shouldError = false;
  }

  seed(table: SyncTable, rows: RemoteRow[]) {
    this.remoteData.set(table, rows);
  }

  async pullChanges(
    table: SyncTable,
    _tenantId: string,
    sinceEpochMs: number,
    limit: number,
  ): Promise<RemoteRow[]> {
    if (this.shouldError) throw new Error('network error');
    // Include pushed data in the remote store (simulates Supabase persistence)
    const rows = this.remoteData.get(table) ?? [];
    return rows
      .filter((r) => new Date(r.updated_at).getTime() > sinceEpochMs)
      .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
      .slice(0, limit);
  }

  async pushBatch(
    table: SyncTable,
    rows: Record<string, unknown>[],
  ): Promise<{ inserted: number; errors: string[] }> {
    if (this.shouldError) return { inserted: 0, errors: ['mock push error'] };
    this.pushLog.push({ table, rows });
    // Persist pushed rows to the remote store (simulates Supabase)
    const existing = this.remoteData.get(table) ?? [];
    for (const r of rows) {
      const existingIdx = existing.findIndex((e) => e.id === r.id);
      const remoteRow: RemoteRow = {
        id: r.id as string,
        tenant_id: r.tenant_id as string,
        updated_at: r.updated_at as string,
        deleted_at: r.deleted_at as string | undefined,
        ...r,
      };
      if (existingIdx >= 0) {
        existing[existingIdx] = remoteRow;
      } else {
        existing.push(remoteRow);
      }
    }
    this.remoteData.set(table, existing);
    return { inserted: rows.length, errors: [] };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeServerRow(id: string, tenantId: string, updatedAt: string, extra?: Record<string, unknown>): RemoteRow {
  return { id, tenant_id: tenantId, updated_at: updatedAt, ...extra };
}

function makeLocalRow(id: string, serverId: string | null, status: string, tenantId: string): SyncRow {
  const now = Date.now();
  return {
    id,
    server_id: serverId,
    tenant_id: tenantId,
    server_updated_at: serverId ? now - 1000 : null,
    local_sync_status: status as SyncRow['local_sync_status'],
    is_deleted: false,
    data: {},
    created_at: now - 5000,
    updated_at: now,
  };
}

const TENANT = 'tenant-1';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SyncEngine', () => {
  let repo: InMemorySyncRepository;
  let remote: MockRemote;
  let engine: SyncEngine;

  beforeEach(() => {
    repo = new InMemorySyncRepository();
    remote = new MockRemote();
    engine = new SyncEngine(repo, remote, { tables: ['case_entries', 'case_templates'] });
  });

  // --- Pull ---
  describe('pull', () => {
    it('pulls remote rows into empty local DB', async () => {
      remote.seed('case_entries', [
        makeServerRow('s1', TENANT, '2025-01-01T00:00:00Z', { status: 'draft' }),
        makeServerRow('s2', TENANT, '2025-01-02T00:00:00Z', { status: 'pending' }),
      ]);
      const progress = await engine.sync(TENANT);
      expect(progress.pulled).toBe(2);
      const local = repo.all('case_entries');
      expect(local).toHaveLength(2);
      expect(local[0]!.server_id).toBe('s1');
      expect(local[0]!.local_sync_status).toBe('synced');
    });

    it('increments pull cursor across syncs', async () => {
      remote.seed('case_entries', [
        makeServerRow('s1', TENANT, '2025-01-01T00:00:00Z'),
      ]);
      await engine.sync(TENANT);
      expect(repo.all('case_entries')).toHaveLength(1);

      // Second pull — same data, should not duplicate
      const progress2 = await engine.sync(TENANT);
      expect(progress2.pulled).toBe(0); // no new rows since cursor
      expect(repo.all('case_entries')).toHaveLength(1);
    });

    it('skips deleted remote rows', async () => {
      remote.seed('case_entries', [
        makeServerRow('s1', TENANT, '2025-01-01T00:00:00Z', { deleted_at: '2025-01-02T00:00:00Z' }),
      ]);
      const progress = await engine.sync(TENANT);
      expect(progress.pulled).toBe(0);
      expect(repo.all('case_entries')).toHaveLength(0);
    });
  });

  // --- Push ---
  describe('push', () => {
    it('pushes pending_create rows', async () => {
      await repo.insert('case_entries', { tenant_id: TENANT, data: { status: 'draft' } });
      const progress = await engine.sync(TENANT);
      expect(progress.pushed).toBe(1);
      expect(remote.pushLog).toHaveLength(1);
      expect(remote.pushLog[0]!.table).toBe('case_entries');

      // Row should now be synced locally
      const local = repo.all('case_entries');
      expect(local[0]!.local_sync_status).toBe('synced');
    });

    it('pushes pending_update rows', async () => {
      // Seed a synced row then update it
      await repo.insert('case_entries', { tenant_id: TENANT });
      const local = repo.all('case_entries');
      await repo.markSynced('case_entries', local[0]!.id, 'server-id-1', Date.now());
      await repo.update('case_entries', local[0]!.id, { data: { status: 'pending' } });

      const progress = await engine.sync(TENANT);
      expect(progress.pushed).toBe(1);
    });

    it('pushes soft-deletes as tombstones', async () => {
      await repo.insert('case_entries', { tenant_id: TENANT });
      const local = repo.all('case_entries');
      await repo.markSynced('case_entries', local[0]!.id, 'server-id-1', Date.now());
      await repo.softDelete('case_entries', local[0]!.id);

      const progress = await engine.sync(TENANT);
      expect(progress.pushed).toBe(1);
      // Tombstone payload should have deleted_at
      const payload = remote.pushLog[0]!.rows[0] as Record<string, unknown>;
      expect(payload.deleted_at).toBeDefined();
      // Row removed from local DB after successful push
      expect(repo.all('case_entries')).toHaveLength(0);
    });

    it('does not push synced rows', async () => {
      await repo.insert('case_entries', { tenant_id: TENANT });
      const local = repo.all('case_entries');
      await repo.markSynced('case_entries', local[0]!.id, 's1', Date.now());

      const progress = await engine.sync(TENANT);
      expect(progress.pushed).toBe(0);
    });
  });

  // --- Conflict resolution ---
  describe('conflict resolution', () => {
    it('remote wins (LWW) when remote is newer', async () => {
      // Seed a local synced row
      const localId = await repo.insert('case_entries', { tenant_id: TENANT, data: { status: 'draft' } });
      await repo.markSynced('case_entries', localId, 's1', Date.now() - 10000);

      // Remote has a newer update for the same server_id
      remote.seed('case_entries', [
        makeServerRow('s1', TENANT, new Date().toISOString(), { status: 'approved' }),
      ]);

      const progress = await engine.sync(TENANT);
      expect(progress.conflicts).toBe(0); // No local pending, so no conflict flag
      const local = repo.all('case_entries');
      expect(local[0]!.data.status).toBe('approved'); // remote won
    });

    it('local wins when local is newer (remote skipped)', async () => {
      // Remote has an older update
      const older = new Date(Date.now() - 50000).toISOString();
      remote.seed('case_entries', [
        makeServerRow('s1', TENANT, older, { status: 'old-data' }),
      ]);

      // First pull to get the server row
      await engine.sync(TENANT);

      // Now make a local edit (newer)
      const local = repo.all('case_entries');
      await repo.update('case_entries', local[0]!.id, { data: { status: 'new-data' } });

      // Pull again — remote is still older, should be skipped
      remote.seed('case_entries', [
        makeServerRow('s1', TENANT, older, { status: 'old-data' }),
      ]);
      await engine.sync(TENANT);

      const rows = repo.all('case_entries');
      expect(rows[0]!.data.status).toBe('new-data'); // local preserved
    });

    it('handles concurrent local edit + remote edit (remote wins)', async () => {
      // Seed synced row
      const localId = await repo.insert('case_entries', { tenant_id: TENANT, data: { status: 'draft' } });
      await repo.markSynced('case_entries', localId, 's1', Date.now() - 10000);

      // Make local edit
      await repo.update('case_entries', localId, { data: { status: 'local-edit' } });

      // Remote has newer edit
      remote.seed('case_entries', [
        makeServerRow('s1', TENANT, new Date().toISOString(), { status: 'remote-edit' }),
      ]);

      // Pull: remote is newer, wins. Local edit lost (expected in LWW).
      const progress = await engine.sync(TENANT);
      // The row gets merged from remote
      const rows = repo.all('case_entries');
      expect(rows[0]!.data.status).toBe('remote-edit');
    });
  });

  // --- Idempotency ---
  describe('idempotency', () => {
    it('re-sync is idempotent — no duplicates, no double pushes', async () => {
      await repo.insert('case_entries', { tenant_id: TENANT, data: { x: 1 } });
      await engine.sync(TENANT);
      const count1 = remote.pushLog.length;
      expect(count1).toBe(1);

      // Second sync — row is now synced, nothing to push
      await engine.sync(TENANT);
      expect(remote.pushLog.length).toBe(count1); // no new push
    });

    it('pulling the same server row twice does not create duplicates', async () => {
      remote.seed('case_entries', [
        makeServerRow('s1', TENANT, '2025-01-01T00:00:00Z'),
      ]);
      await engine.sync(TENANT);
      expect(repo.all('case_entries')).toHaveLength(1);

      await engine.sync(TENANT);
      expect(repo.all('case_entries')).toHaveLength(1);
    });
  });

  // --- Full round-trip ---
  describe('full sync round-trip', () => {
    it('create offline → sync → see on web → modify on web → sync → see locally', async () => {
      // 1. Create locally while "offline"
      const localId = await repo.insert('case_entries', {
        tenant_id: TENANT,
        data: { patient_mrn: 'MRN-001', status: 'draft' },
      });
      expect(repo.all('case_entries')).toHaveLength(1);
      expect(repo.all('case_entries')[0]!.local_sync_status).toBe('pending_create');

      // 2. Come online → sync (push)
      await engine.sync(TENANT);
      expect(repo.all('case_entries')[0]!.local_sync_status).toBe('synced');

      // Verify the pushed row is now in the mock's remote store
      const pushedRows = remote.remoteData.get('case_entries') ?? [];
      expect(pushedRows.length).toBe(1);
      const pushedId = pushedRows[0]!.id;

      // 3. "Web" modifies the row (simulate a newer server version)
      const laterTime = new Date(Date.now() + 10000).toISOString();
      remote.seed('case_entries', [
        { id: pushedId, tenant_id: TENANT, updated_at: laterTime, status: 'approved' },
      ]);

      // 4. Pull again (force re-pull by resetting cursor)
      await repo.setLastPullAt('case_entries', 0);
      await engine.sync(TENANT);

      // 5. Local row reflects the web change
      const local = repo.all('case_entries');
      expect(local[0]!.data.status).toBe('approved');
      expect(local[0]!.server_id).toBe(pushedId);
    });
  });

  // --- Error handling ---
  describe('error handling', () => {
    it('network error during pull does not crash', async () => {
      remote.seed('case_entries', [makeServerRow('s1', TENANT, '2025-01-01T00:00:00Z')]);
      remote.shouldError = true;
      const progress = await engine.sync(TENANT);
      expect(progress.phase).toBe('error');
      expect(progress.errors.length).toBeGreaterThan(0);
    });

    it('push error marks row as pending (not lost)', async () => {
      await repo.insert('case_entries', { tenant_id: TENANT });
      remote.shouldError = true;
      await engine.sync(TENANT);

      // Row should still be pending
      const pending = await repo.findByStatus('case_entries', 'pending_create');
      expect(pending).toHaveLength(1);
    });
  });

  // --- Multi-table ---
  describe('multi-table sync', () => {
    it('syncs data across multiple tables', async () => {
      await repo.insert('case_entries', { tenant_id: TENANT, data: { a: 1 } });
      await repo.insert('case_templates', { tenant_id: TENANT, data: { name: 'T1' } });

      remote.seed('case_entries', [
        makeServerRow('s1', TENANT, '2025-01-01T00:00:00Z', { b: 2 }),
      ]);
      remote.seed('case_templates', [
        makeServerRow('s2', TENANT, '2025-01-01T00:00:00Z', { name: 'Remote Template' }),
      ]);

      const progress = await engine.sync(TENANT);
      expect(progress.pulled).toBe(2);
      expect(progress.pushed).toBe(2); // one create per table
    });
  });
});
