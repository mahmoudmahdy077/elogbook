import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
import {
  getDraftCases,
  getConflictedCases,
  updateSyncStatus,
  removeDraft,
  upsertCaseEntry,
  upsertTemplate,
  upsertProgramGoal,
  getLastSyncTimestamp,
  setLastSyncTimestamp,
} from './db/storage';

type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'synced';

type ConflictCallback = (residentId: string, entryId: string) => void;

class SyncService {
  private status: SyncStatus = 'idle';
  private listeners: Set<(status: SyncStatus) => void> = new Set();
  private conflictCallbacks: Set<ConflictCallback> = new Set();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private netInfoUnsubscribe: (() => void) | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private retryDelays = [30000, 60000, 120000, 300000];
  private retryIndex = 0;
  private pushMutex = false;
  private tenantId: string | null = null;

  constructor() {
    this.initNetworkListener();
    this.initAppStateListener();
  }

  setTenantId(id: string) {
    this.tenantId = id;
  }

  private initNetworkListener() {
    this.netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && this.status === 'offline') {
        this.initSync(this.tenantId ?? undefined);
        this.status = 'idle';
      } else if (!state.isConnected) {
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
      query = query.gt('updated_at', new Date(lastSync).toISOString());
    }

    const { data, error } = await query;
    if (error) {
      console.error('Pull cases error:', error);
      return;
    }

    if (data && data.length > 0) {
      for (const row of data) {
        await upsertCaseEntry(row as Record<string, unknown>);
      }
    }

    const now = Date.now();
    await setLastSyncTimestamp(now);
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
      for (const row of data) {
        await upsertTemplate(row as Record<string, unknown>);
      }
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
      for (const g of programGoals) {
        await upsertProgramGoal(g as Record<string, unknown>);
      }
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
        let result;

        if (isNew) {
          result = await supabase.from('case_entries').insert(casePayload).select('id').single();
        } else {
          result = await supabase
            .from('case_entries')
            .update(casePayload)
            .eq('id', draft.id)
            .select('id, updated_at')
            .single();
        }

        if (!result.error) {
          await updateSyncStatus(draft, 'synced');
          this.retryIndex = 0;
        } else if (
          typeof result.error === 'object' &&
          result.error &&
          'code' in result.error &&
          (result.error as { code: string }).code === '409'
        ) {
          await this.handleConflict(draft);
        } else {
          console.error('Push case error:', result.error);
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

  private async handleConflict(draft: import('./db/models/CaseEntry').CaseEntry) {
    const { data: serverCase } = await supabase
      .from('case_entries')
      .select('updated_at')
      .eq('id', draft.id)
      .single();

    if (serverCase) {
      const serverUpdated = new Date(serverCase.updated_at).getTime();
      const localUpdated = draft.updatedAt.getTime();

      if (serverUpdated > localUpdated) {
        await updateSyncStatus(draft, 'conflict');
        this.conflictCallbacks.forEach((fn) => fn(draft.residentId, draft.id));
        return;
      }
    }

    await updateSyncStatus(draft, 'conflict');
    this.conflictCallbacks.forEach((fn) => fn(draft.residentId, draft.id));
  }

  async initSync(tenantId?: string) {
    const tid = tenantId ?? this.tenantId;
    if (!tid) return;

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      this.setStatus('offline');
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
      setTimeout(() => {
        if (this.status === 'synced') this.setStatus('idle');
      }, 3000);
    } catch (err) {
      console.error('Sync error:', err);
      this.setStatus('error');
      const delay = this.retryDelays[Math.min(this.retryIndex, this.retryDelays.length - 1)];
      this.retryIndex++;
      setTimeout(() => this.initSync(tid), delay);
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