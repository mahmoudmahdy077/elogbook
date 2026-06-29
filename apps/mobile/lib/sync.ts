import { useEffect } from 'react';
import { Q } from '@nozbe/watermelondb';
import { getDatabase } from './db/database';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
import {
  getDraftCases,
  getConflictedCases,
  updateSyncStatus,
  upsertCaseEntry,
  batchUpsertCaseEntries,
  batchUpsertTemplates,
  batchUpsertGoals,
  getLastSyncTimestamp,
  setLastSyncTimestamp,
} from './db/storage';
import { pickMaxServerUpdatedAt } from './sync-incremental';
import { computeRetryDelayMs, MAX_RETRY_DELAY_MS, RETRY_DELAYS_MS } from './sync-retry';

type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'synced';

type ConflictCallback = (residentId: string, entryId: string) => void;

type SupabaseLike = {
  auth: {
    onAuthStateChange: (cb: (event: string, session: { user?: { id: string } } | null) => void) => {
      data: { subscription: { unsubscribe: () => void } };
    };
  };
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        single: () => Promise<{ data: { tenant_id: string } | null; error: unknown }>;
      };
    };
  };
};

class SyncService {
  private status: SyncStatus = 'idle';
  private listeners: Set<(status: SyncStatus) => void> = new Set();
  private conflictCallbacks: Set<ConflictCallback> = new Set();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private netInfoUnsubscribe: (() => void) | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private retryDelays: readonly number[] = RETRY_DELAYS_MS;
  private retryIndex = 0;
  private retryCount = 0;
  private readonly MAX_RETRIES = 10;
  private pushMutex = false;
  private syncing = false;
  private tenantId: string | null = null;

  constructor() {
    this.initNetworkListener();
    this.initAppStateListener();
  }

  setTenantId(id: string | null | undefined) {
    this.tenantId = id ?? null;
  }

  getTenantId(): string | null {
    return this.tenantId;
  }

  private initNetworkListener() {
    this.netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected === true && this.status === 'offline') {
        // Reconnect: reset retry bookkeeping so we start fresh instead of
        // inheriting an exhausted backoff from the offline window.
        this.retryCount = 0;
        this.retryIndex = 0;
        this.status = 'idle';
        this.initSync(this.tenantId ?? undefined);
      } else if (state.isConnected !== true) {
        this.status = 'offline';
        this.emitStatus();
      }
    });
  }

  private initAppStateListener() {
    this.appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        this.startPeriodicSync(60000);
        this.initSync(this.tenantId ?? undefined);
      } else if (nextState === 'background') {
        this.stopPeriodicSync();
      }
    });
  }

  private emitStatus() {
    this.listeners.forEach((fn) => fn(this.status));
  }

  private setStatus(status: SyncStatus) {
    this.status = status;
    this.emitStatus();
  }

  onStatusChange(fn: (status: SyncStatus) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  setConflictCallback(fn: ConflictCallback) {
    this.conflictCallbacks.add(fn);
    return () => {
      this.conflictCallbacks.delete(fn);
    };
  }

  async pullCases(tenantId: string) {
    const lastSync = await getLastSyncTimestamp();
    let query = supabase
      .from('case_entries')
      .select('*')
      .eq('tenant_id', tenantId);

    if (lastSync) {
      // Use gt (not gte) to avoid re-pulling the boundary row on the next sync.
      // We track the max(updated_at) we just saw and only fetch strictly newer rows.
      query = query.gt('updated_at', new Date(lastSync).toISOString());
    }

    const { data, error } = await query;
    if (error) {
      console.error('Pull cases error:', error);
      return;
    }

    if (data && data.length > 0) {
      await batchUpsertCaseEntries(data as Record<string, unknown>[]);
    }

    // Advance the cursor to the max server-side updated_at we just observed
    // (not Date.now(), which can be ahead of the server clock and miss rows).
    // If nothing was returned, leave the cursor untouched so we don't lose progress.
    const maxUpdated = pickMaxServerUpdatedAt((data ?? []) as Record<string, unknown>[]);
    if (maxUpdated > 0) {
      await setLastSyncTimestamp(maxUpdated);
    }
  }

  async pullTemplates(tenantId: string) {
    const { data, error } = await supabase
      .from('case_templates')
      .select('*')
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Pull templates error:', error);
      return;
    }

    if (data) {
      await batchUpsertTemplates(data as Record<string, unknown>[]);
    }
  }

  async pullGoals(tenantId: string) {
    const { data: programGoals, error } = await supabase
      .from('program_goals')
      .select('id, title, target_count, specialty, resident_id, tenant_id, current_count, created_at, updated_at')
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Pull goals error:', error);
      return;
    }

    if (programGoals) {
      await batchUpsertGoals(programGoals as Record<string, unknown>[]);
    }
  }

  async pushCases() {
    if (this.pushMutex) return;
    this.pushMutex = true;

    try {
      const drafts = await getDraftCases();
      if (drafts.length === 0) {
        return;
      }

      for (const draft of drafts) {
        if (draft.localSyncStatus !== 'draft' && draft.localSyncStatus !== 'modified') continue;

        const casePayload: Record<string, unknown> = {
          tenant_id: draft.tenantId,
          resident_id: draft.residentId,
          template_id: draft.templateId,
          patient_mrn: draft.patientMrn,
          patient_dob: draft.patientDob,
          patient_age_years: draft.patientAgeYears,
          patient_hash: draft.patientHash,
          case_date: draft.caseDate,
          field_values: (draft._raw as Record<string, unknown>).field_values,
          accreditation_mappings: (draft._raw as Record<string, unknown>).accreditation_mappings,
          is_deidentified: draft.isDeidentified,
          status: draft.status,
        };

        const isNew = draft.localSyncStatus === 'draft';
        // For an existing-on-server row, target the server-assigned id (not the
        // local UUID). The server id is captured the first time we successfully
        // push a new draft and is then re-used for every subsequent update.
        const targetId = isNew ? draft.id : draft.serverId ?? draft.id;
        let result;

        if (isNew) {
          result = await supabase.from('case_entries').insert(casePayload).select('id').single();
        } else {
          result = await supabase
            .from('case_entries')
            .update(casePayload)
            .eq('id', targetId)
            .select('id, updated_at')
            .single();
        }

        if (!result.error) {
          const serverId = isNew ? (result.data as { id?: string } | null)?.id : targetId;
          await updateSyncStatus(draft, 'synced', serverId);
          this.retryIndex = 0;
          this.retryCount = 0;
        } else {
          const err = result.error as { code?: string; message?: string; details?: string };
          console.error('Push case error:', err);
        }
      }
    } finally {
      this.pushMutex = false;
    }
  }

  async handleConflicts() {
    const conflicts = await getConflictedCases();
    for (const entry of conflicts) {
      const { data: serverCase } = await supabase
        .from('case_entries')
        .select('updated_at')
        .eq('id', entry.id)
        .single();

      if (serverCase) {
        const serverUpdated = new Date(serverCase.updated_at).getTime();
        const localUpdated = entry.updatedAt.getTime();

        if (serverUpdated > localUpdated) {
          const { data: fullCase } = await supabase
            .from('case_entries')
            .select('*')
            .eq('id', entry.id)
            .single();

          if (fullCase) {
            await upsertCaseEntry(fullCase as Record<string, unknown>);
            continue;
          }
        }
      }

      this.conflictCallbacks.forEach((fn) => fn(entry.residentId, entry.id));
    }
  }

  async initSync(tenantId?: string) {
    if (this.syncing) return;
    this.syncing = true;

    if (this.retryCount >= this.MAX_RETRIES) {
      console.error('Sync failed after max retries. Stopping automatic retry.');
      this.setStatus('error');
      this.retryCount = 0;
      this.syncing = false;
      return;
    }

    const tid = tenantId ?? this.tenantId;
    if (!tid) {
      this.syncing = false;
      return;
    }

    const netState = await NetInfo.fetch();
    if (netState.isConnected !== true) {
      this.setStatus('offline');
      this.syncing = false;
      return;
    }

    this.setStatus('syncing');
    try {
      await Promise.all([
        this.pullCases(tid),
        this.pullTemplates(tid),
        this.pullGoals(tid),
      ]);
      await this.pushCases();
      await this.handleConflicts();
      this.setStatus('synced');
      this.retryCount = 0;
      this.retryIndex = 0;
      setTimeout(() => {
        if (this.status === 'synced') this.setStatus('idle');
      }, 3000);
    } catch (err) {
      console.error('Sync error:', err);
      this.setStatus('error');
      this.retryCount++;
      const delay = computeRetryDelayMs(this.retryIndex);
      this.retryIndex++;
      setTimeout(() => this.initSync(tid), delay);
    } finally {
      this.syncing = false;
    }
  }

  startPeriodicSync(intervalMs = 60000) {
    this.stopPeriodicSync();
    this.intervalId = setInterval(() => {
      this.initSync();
    }, intervalMs);
  }

  stopPeriodicSync() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  async getConflictDrafts() {
    const conflicts = await getConflictedCases();
    return conflicts.map((c) => ({
      entryId: c.id,
      residentId: c.residentId,
      timestamp: c.updatedAt.getTime(),
    }));
  }

  cleanup() {
    this.stopPeriodicSync();
    if (this.netInfoUnsubscribe) {
      this.netInfoUnsubscribe();
      this.netInfoUnsubscribe = null;
    }
    if (this.appStateSub) {
      this.appStateSub.remove();
      this.appStateSub = null;
    }
  }
}

export const syncService = new SyncService();

export function attachSyncAuthListener(
  sb: SupabaseLike = supabase as unknown as SupabaseLike,
  svc: SyncService = syncService,
): () => void {
  const { data: { subscription } } = sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user) {
      if (event === 'SIGNED_OUT') {
        svc.setTenantId(null);
        svc.cleanup();
      }
      return;
    }
    try {
      const { data: profile } = await sb
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', session.user.id)
        .single();
      const tenantId = profile?.tenant_id;
      if (tenantId) {
        svc.setTenantId(tenantId);
        svc.startPeriodicSync();
      }
    } catch (err) {
      console.error('attachSyncAuthListener: failed to resolve tenant', err);
    }
  });
  return subscription?.unsubscribe ?? (() => undefined);
}

export function useSyncInit(): void {
  useEffect(() => {
    return attachSyncAuthListener();
  }, []);
}
