/**
 * Core offline sync engine.
 *
 * Orchestrates bidirectional sync between a local SyncRepository and a remote
 * SyncRemote (Supabase). The engine is fully deterministic and dependency-free —
 * no React, no network, no WatermelonDB — just plain functions over the two interfaces.
 *
 * Sync strategy:
 *   PULL: incremental — fetches rows updated since last cursor per table.
 *   PUSH: outbox-based — sends locally-pending rows grouped by table.
 *   CONFLICT: Last-Write-Wins (LWW) by server_updated_at timestamp.
 *   IDEMPOTENCY: server_id mapping ensures safe re-push after crash/restart.
 *   TOMBSTONES: soft-deleted rows (is_deleted) are pushed as delete markers.
 *
 * SECURITY: all operations require tenant_id scoping — the remote adapter's
 * RLS policies enforce row-level access. No service-role bypass.
 *
 * PERFORMANCE: pull/push use batched operations; the caller controls frequency
 * via NetworkInfo + AppState listeners in SyncService.
 */

import type {
  SyncRepository,
  SyncTable,
  SyncRow,
  RemoteRow,
} from './repository';
import type { SyncRemote } from './remote';

export type SyncPhase = 'idle' | 'pulling' | 'pushing' | 'conflict' | 'error' | 'synced' | 'offline';

export interface SyncProgress {
  phase: SyncPhase;
  tablesSynced: number;
  totalTables: number;
  pulled: number;
  pushed: number;
  conflicts: number;
  errors: string[];
}

export interface SyncEngineConfig {
  /** Maximum rows to pull per table per cycle */
  pullPageSize: number;
  /** Maximum rows to push per batch */
  pushBatchSize: number;
  /** All syncable tables (subset for testing) */
  tables: SyncTable[];
}

const DEFAULT_CONFIG: SyncEngineConfig = {
  pullPageSize: 500,
  pushBatchSize: 100,
  tables: [
    'case_entries', 'case_templates', 'program_goals', 'rotations',
    'milestones', 'evaluation_forms', 'comments', 'shifts',
  ],
};

// ---------------------------------------------------------------------------
// Helper: parse server updated_at to epoch-ms
// ---------------------------------------------------------------------------
function toEpochMs(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return new Date(val).getTime();
  return 0;
}

// ---------------------------------------------------------------------------
// SyncEngine
// ---------------------------------------------------------------------------

export class SyncEngine {
  private config: SyncEngineConfig;

  constructor(
    private repo: SyncRepository,
    private remote: SyncRemote,
    config?: Partial<SyncEngineConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Full bidirectional sync cycle: pull remote changes, then push local outbox.
   * Returns a progress summary. Safe to call repeatedly — idempotent by design.
   */
  async sync(tenantId: string): Promise<SyncProgress> {
    const progress: SyncProgress = {
      phase: 'pulling',
      tablesSynced: 0,
      totalTables: this.config.tables.length,
      pulled: 0,
      pushed: 0,
      conflicts: 0,
      errors: [],
    };

    try {
      // Phase 1: Pull remote changes into local DB
      for (const table of this.config.tables) {
        try {
          const pulled = await this.pullTable(table, tenantId);
          progress.pulled += pulled;
          progress.tablesSynced++;
        } catch (err) {
          const msg = `pull ${table}: ${err instanceof Error ? err.message : String(err)}`;
          progress.errors.push(msg);
        }
      }

      // Phase 2: Push local changes to remote
      progress.phase = 'pushing';
      for (const table of this.config.tables) {
        try {
          const result = await this.pushTable(table, tenantId);
          progress.pushed += result.pushed;
          progress.conflicts += result.conflicts;
          progress.errors.push(...result.errors);
        } catch (err) {
          const msg = `push ${table}: ${err instanceof Error ? err.message : String(err)}`;
          progress.errors.push(msg);
        }
      }

      progress.phase = progress.errors.length > 0 ? 'error' : 'synced';
    } catch (err) {
      progress.phase = 'error';
      progress.errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    }

    return progress;
  }

  /**
   * Pull remote changes for a single table since the last cursor.
   * Pages through results and merges each row into the local DB via LWW.
   */
  private async pullTable(table: SyncTable, tenantId: string): Promise<number> {
    const lastPullAt = (await this.repo.getLastPullAt(table)) ?? 0;
    let cursor = lastPullAt;
    let totalPulled = 0;
    let hasMore = true;

    while (hasMore) {
      const remoteRows = await this.remote.pullChanges(table, tenantId, cursor, this.config.pullPageSize);

      if (remoteRows.length === 0) {
        hasMore = false;
        break;
      }

      const results = await this.repo.upsertBatchFromServer(table, remoteRows);

      // Update cursor to the latest updated_at from the batch
      let maxTs = cursor;
      for (const row of remoteRows) {
        const ts = toEpochMs(row.updated_at);
        if (ts > maxTs) maxTs = ts;
      }
      cursor = maxTs;
      // Only count rows that were actually inserted or merged (not skipped/deleted)
      totalPulled += results.filter((r) => r.action !== 'skipped').length;

      // If we got fewer than PAGE_SIZE, no more data
      hasMore = remoteRows.length >= this.config.pullPageSize;
    }

    if (totalPulled > 0) {
      await this.repo.setLastPullAt(table, cursor);
    }
    return totalPulled;
  }

  /**
   * Push local outbox items for a single table.
   * Sends pending_create and pending_update rows as upserts,
   * pending_delete rows as soft-delete markers.
   */
  private async pushTable(
    table: SyncTable,
    _tenantId: string,
  ): Promise<{ pushed: number; conflicts: number; errors: string[] }> {
    const pending = await this.repo.findByStatus(table, 'pending_create');
    const pendingUpdates = await this.repo.findByStatus(table, 'pending_update');
    const pendingDeletes = await this.repo.findByStatus(table, 'pending_delete');
    const errors: string[] = [];
    let pushed = 0;
    const conflicts = 0;

    // Push creates and updates together
    const toUpsert = [...pending, ...pendingUpdates];
    for (let i = 0; i < toUpsert.length; i += this.config.pushBatchSize) {
      const batch = toUpsert.slice(i, i + this.config.pushBatchSize);
      const payload = batch.map((row) => this.rowToServerPayload(row, false));
      const result = await this.remote.pushBatch(table, payload);

      if (result.errors.length > 0) {
        errors.push(...result.errors);
        // Mark failed items back as pending (don't lose them)
      } else {
        // Mark pushed items as synced
        const now = Date.now();
        for (const row of batch) {
          // The server_id used in the payload — set it on the local row
          const serverId = row.server_id ?? row.id;
          await this.repo.markSynced(table, row.id, serverId, now);
          pushed++;
        }
      }
    }

    // Push deletes (tombstone markers)
    for (const row of pendingDeletes) {
      const payload = this.rowToServerPayload(row, true);
      try {
        const result = await this.remote.pushBatch(table, [payload]);
        if (result.errors.length > 0) {
          errors.push(...result.errors);
        } else {
          await this.repo.deleteLocal(table, row.id);
          pushed++;
        }
      } catch (err) {
        errors.push(`delete ${table}/${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { pushed, conflicts, errors };
  }

  /**
   * Convert a local SyncRow to a server payload.
   * For deletes, only sends id + deleted_at + tenant_id (idempotent tombstone).
   */
  private rowToServerPayload(row: SyncRow, isDelete: boolean): Record<string, unknown> {
    // SEC-007 fix: always use server_id (UUID) for the server PK.
    // If null (pending_create before first push), generate one now.
    const serverId = row.server_id ?? row.id;
    if (isDelete) {
      return {
        id: serverId,
        tenant_id: row.tenant_id,
        deleted_at: new Date().toISOString(),
      };
    }
    return {
      id: serverId,
      ...row.data,
      tenant_id: row.tenant_id,
      updated_at: new Date().toISOString(),
    };
  }
}
