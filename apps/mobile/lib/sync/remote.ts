/**
 * Supabase-backed remote adapter for the sync engine.
 *
 * Pulls remote changes via incremental queries (updated_at > since)
 * and pushes local outbox items via batched upserts.
 *
 * SECURITY: all queries go through RLS (no service-role bypass).
 * The sync endpoint uses SECURITY DEFINER RPCs for performance.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncTable, RemoteRow } from './repository';

export interface SyncRemote {
  pullChanges(table: SyncTable, tenantId: string, sinceEpochMs: number, limit: number): Promise<RemoteRow[]>;
  pushBatch(table: SyncTable, rows: Record<string, unknown>[]): Promise<{ inserted: number; errors: string[] }>;
}

const PAGE_SIZE = 500;

/**
 * Convert epoch-ms to ISO-8601 for the updated_at > $1 query.
 */
function epochToISO(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * The column set for each table used in SELECT * (all columns for full sync).
 * We select everything to support full hydration on first pull.
 */
export class SupabaseSyncRemote implements SyncRemote {
  constructor(private supabase: SupabaseClient) {}

  async pullChanges(
    table: SyncTable,
    tenantId: string,
    sinceEpochMs: number,
    limit: number = PAGE_SIZE,
  ): Promise<RemoteRow[]> {
    const sinceISO = epochToISO(sinceEpochMs);

    // Use RLS: the Supabase client's JWT scopes the query to the correct tenant.
    // We fetch rows updated since the cursor, including soft-deleted rows
    // (deleted_at IS NOT NULL) so the client can mirror deletes.
    const { data, error } = await this.supabase
      .from(table)
      .select('*')
      .eq('tenant_id', tenantId)
      .gt('updated_at', sinceISO)
      .order('updated_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error(`[SyncRemote] pull ${table} failed:`, error.message);
      return [];
    }
    return (data as RemoteRow[]) ?? [];
  }

  async pushBatch(
    table: SyncTable,
    rows: Record<string, unknown>[],
  ): Promise<{ inserted: number; errors: string[] }> {
    if (rows.length === 0) return { inserted: 0, errors: [] };

    const errors: string[] = [];
    let inserted = 0;

    // Supabase supports batch upsert (max 1000 rows per call)
    for (let i = 0; i < rows.length; i += 1000) {
      const batch = rows.slice(i, i + 1000);
      const { data, error } = await this.supabase
        .from(table)
        .upsert(batch, { onConflict: 'id', ignoreDuplicates: false });

      if (error) {
        errors.push(`batch ${i}-${i + batch.length}: ${error.message}`);
      } else {
        inserted += batch.length;
      }
    }

    return { inserted, errors };
  }
}
