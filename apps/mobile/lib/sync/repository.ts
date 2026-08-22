/**
 * Offline-first repository abstraction.
 *
 * The sync engine and data-access layer operate against this interface.
 * WatermelonDB and the in-memory test implementation both satisfy it.
 * This is the seam that makes the entire offline mode testable in node.
 */

// ---------------------------------------------------------------------------
// Domain types (plain objects, no Model dependencies)
// ---------------------------------------------------------------------------

export type SyncTable =
  | 'case_entries'
  | 'case_templates'
  | 'program_goals'
  | 'rotations'
  | 'milestones'
  | 'evaluation_forms'
  | 'comments'
  | 'shifts';

export type SyncStatus = 'synced' | 'pending_create' | 'pending_update' | 'pending_delete';

export interface SyncRow {
  /** Local WatermelonDB ID (client-generated UUIDv4) */
  id: string;
  /** Server UUID PK — set after first successful push */
  server_id: string | null;
  tenant_id: string;
  /** ISO-8601 or epoch-ms of the server's last update — used for LWW */
  server_updated_at: number | null;
  /** Whether this row is locally pending sync */
  local_sync_status: SyncStatus;
  /** Soft-delete tombstone flag */
  is_deleted: boolean;
  /** The rest of the row's data (JSON-serializable, table-dependent) */
  data: Record<string, unknown>;
  /** Local timestamp for ordering / crash-recovery */
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Repository interface — implemented by WatermelonDB and by in-memory test DB
// ---------------------------------------------------------------------------

export interface SyncRepository {
  /** Read a single row by local ID (returns null if not found or soft-deleted) */
  findById(table: SyncTable, localId: string): Promise<SyncRow | null>;

  /** Find by server_id (for idempotent merge) */
  findByServerId(table: SyncTable, serverId: string): Promise<SyncRow | null>;

  /** Get all rows in a table with a given local_sync_status */
  findByStatus(table: SyncTable, status: SyncStatus): Promise<SyncRow[]>;

  /** Get all non-deleted rows with server_updated_at > since (for incremental pull merge) */
  findChangedSince(table: SyncTable, sinceEpochMs: number): Promise<SyncRow[]>;

  /** Insert a new local row with pending_create status. Returns the local ID. */
  insert(table: SyncTable, row: Partial<SyncRow> & { tenant_id: string }): Promise<string>;

  /** Update an existing local row. Bumps updated_at and sets pending_update (unless forced to synced). */
  update(table: SyncTable, localId: string, changes: Partial<SyncRow>): Promise<void>;

  /** Soft-delete a local row (set is_deleted + local_sync_status = pending_delete) */
  softDelete(table: SyncTable, localId: string): Promise<void>;

  /** Apply a remote row received during pull — insert or merge depending on conflict */
  upsertFromServer(table: SyncTable, serverRow: RemoteRow): Promise<UpsertResult>;

  /** Batch apply multiple remote rows (used in pull) */
  upsertBatchFromServer(table: SyncTable, rows: RemoteRow[]): Promise<UpsertResult[]>;

  /** Mark a local row as synced after successful push */
  markSynced(table: SyncTable, localId: string, serverId: string, serverUpdatedAt: number): Promise<void>;

  /** Delete locally (after successful server-side delete) */
  deleteLocal(table: SyncTable, localId: string): Promise<void>;

  /** Count pending items in a table */
  countPending(table: SyncTable): Promise<number>;

  /** Get last pull timestamp for a table */
  getLastPullAt(table: SyncTable): Promise<number | null>;
  setLastPullAt(table: SyncTable, ts: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Remote row (from Supabase pull)
// ---------------------------------------------------------------------------

export interface RemoteRow {
  id: string; // server UUID PK
  tenant_id: string;
  updated_at: string | number; // ISO-8601 or epoch
  deleted_at?: string | number | null; // soft-delete on server
  [key: string]: unknown;
}

export interface UpsertResult {
  action: 'inserted' | 'merged' | 'skipped' | 'conflict';
  localId: string;
  serverId: string;
}

// ---------------------------------------------------------------------------
// Sync metadata store (persisted per-table sync cursors)
// ---------------------------------------------------------------------------

export interface SyncMetaStore {
  get(key: string): Promise<number | null>;
  set(key: string, value: number): Promise<void>;
}
