/**
 * In-memory implementation of SyncRepository for unit tests.
 * No WatermelonDB, no native deps — pure in-memory Maps.
 */

import type {
  SyncRepository,
  SyncTable,
  SyncRow,
  SyncStatus,
  RemoteRow,
  UpsertResult,
} from './repository';

const TABLES: SyncTable[] = [
  'case_entries', 'case_templates', 'program_goals', 'rotations',
  'milestones', 'evaluation_forms', 'comments', 'shifts',
];

function uuidv4(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseEpoch(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return new Date(val).getTime();
  return 0;
}

export class InMemorySyncRepository implements SyncRepository {
  private tables: Map<SyncTable, Map<string, SyncRow>> = new Map();
  private pullCursors: Map<string, number> = new Map();

  constructor() {
    for (const t of TABLES) this.tables.set(t, new Map());
  }

  async findById(table: SyncTable, localId: string): Promise<SyncRow | null> {
    const row = this.tables.get(table)!.get(localId);
    if (!row || row.is_deleted) return null;
    return row;
  }

  async findByServerId(table: SyncTable, serverId: string): Promise<SyncRow | null> {
    for (const row of this.tables.get(table)!.values()) {
      if (row.server_id === serverId && !row.is_deleted) return row;
    }
    return null;
  }

  async findByStatus(table: SyncTable, status: SyncStatus): Promise<SyncRow[]> {
    const result: SyncRow[] = [];
    for (const row of this.tables.get(table)!.values()) {
      if (row.local_sync_status === status) result.push(row);
    }
    return result;
  }

  async findChangedSince(table: SyncTable, sinceEpochMs: number): Promise<SyncRow[]> {
    const result: SyncRow[] = [];
    for (const row of this.tables.get(table)!.values()) {
      const ts = row.server_updated_at ?? row.updated_at;
      if (ts > sinceEpochMs && !row.is_deleted) result.push(row);
    }
    return result;
  }

  async insert(table: SyncTable, row: Partial<SyncRow> & { tenant_id: string }): Promise<string> {
    const now = Date.now();
    const id = row.id ?? uuidv4();
    const full: SyncRow = {
      id,
      server_id: row.server_id ?? null,
      tenant_id: row.tenant_id,
      server_updated_at: row.server_updated_at ?? null,
      local_sync_status: row.local_sync_status ?? 'pending_create',
      is_deleted: row.is_deleted ?? false,
      data: row.data ?? {},
      created_at: row.created_at ?? now,
      updated_at: row.updated_at ?? now,
    };
    this.tables.get(table)!.set(id, full);
    return id;
  }

  async update(table: SyncTable, localId: string, changes: Partial<SyncRow>): Promise<void> {
    const row = this.tables.get(table)!.get(localId);
    if (!row) throw new Error(`Row ${localId} not found in ${table}`);
    Object.assign(row, changes, { updated_at: Date.now() });
    // Any user-initiated edit marks the row as needing sync
    // (unless caller explicitly sets local_sync_status in changes)
    if (!('local_sync_status' in changes)) {
      row.local_sync_status = 'pending_update';
    }
  }

  async softDelete(table: SyncTable, localId: string): Promise<void> {
    const row = this.tables.get(table)!.get(localId);
    if (!row) throw new Error(`Row ${localId} not found in ${table}`);
    row.is_deleted = true;
    row.local_sync_status = 'pending_delete';
    row.updated_at = Date.now();
  }

  async upsertFromServer(table: SyncTable, serverRow: RemoteRow): Promise<UpsertResult> {
    const serverId = serverRow.id;
    const serverUpdatedAt = parseEpoch(serverRow.updated_at);
    const isDeleted = !!(serverRow.deleted_at);

    // Check if we already have this server row locally
    const existing = await this.findByServerId(table, serverId);

    if (!existing) {
      // New row from server — insert locally
      if (isDeleted) return { action: 'skipped', localId: '', serverId };
      const now = Date.now();
      const localId = uuidv4();
      const row: SyncRow = {
        id: localId,
        server_id: serverId,
        tenant_id: serverRow.tenant_id,
        server_updated_at: serverUpdatedAt,
        local_sync_status: 'synced',
        is_deleted: false,
        data: { ...serverRow },
        created_at: now,
        updated_at: now,
      };
      this.tables.get(table)!.set(localId, row);
      return { action: 'inserted', localId, serverId };
    }

    // Existing local row — LWW conflict resolution
    if (isDeleted) {
      existing.is_deleted = true;
      existing.local_sync_status = 'synced';
      existing.server_updated_at = serverUpdatedAt;
      return { action: 'merged', localId: existing.id, serverId };
    }

    // Remote is newer → merge (server wins for LWW)
    if (serverUpdatedAt > (existing.server_updated_at ?? 0)) {
      const wasLocalPending = existing.local_sync_status !== 'synced';
      existing.data = { ...serverRow };
      existing.server_updated_at = serverUpdatedAt;
      existing.is_deleted = false;
      existing.local_sync_status = 'synced';
      return { action: wasLocalPending ? 'conflict' : 'merged', localId: existing.id, serverId };
    }

    // Local is same or newer → skip (keep local version)
    return { action: 'skipped', localId: existing.id, serverId };
  }

  async upsertBatchFromServer(table: SyncTable, rows: RemoteRow[]): Promise<UpsertResult[]> {
    const results: UpsertResult[] = [];
    for (const row of rows) {
      results.push(await this.upsertFromServer(table, row));
    }
    return results;
  }

  async markSynced(table: SyncTable, localId: string, serverId: string, serverUpdatedAt: number): Promise<void> {
    const row = this.tables.get(table)!.get(localId);
    if (!row) throw new Error(`Row ${localId} not found in ${table}`);
    row.server_id = serverId;
    row.server_updated_at = serverUpdatedAt;
    row.local_sync_status = 'synced';
    row.updated_at = Date.now();
  }

  async deleteLocal(table: SyncTable, localId: string): Promise<void> {
    this.tables.get(table)!.delete(localId);
  }

  async countPending(table: SyncTable): Promise<number> {
    let count = 0;
    for (const row of this.tables.get(table)!.values()) {
      if (row.local_sync_status !== 'synced') count++;
    }
    return count;
  }

  async getLastPullAt(table: SyncTable): Promise<number | null> {
    return this.pullCursors.get(`pull:${table}`) ?? null;
  }

  async setLastPullAt(table: SyncTable, ts: number): Promise<void> {
    this.pullCursors.set(`pull:${table}`, ts);
  }

  // Helper for tests
  clear(): void {
    for (const t of TABLES) this.tables.get(t)!.clear();
    this.pullCursors.clear();
  }

  /** Insert a pre-built SyncRow directly (for seeding tests) */
  seed(table: SyncTable, row: SyncRow): void {
    this.tables.get(table)!.set(row.id, { ...row });
  }

  /** Get all rows (for assertions) */
  all(table: SyncTable): SyncRow[] {
    return Array.from(this.tables.get(table)!.values());
  }
}
