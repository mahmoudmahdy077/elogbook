import { supabase } from './supabase';
import { getDraftCases, removeDraftCase } from './db/storage';

type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

class SyncService {
  private status: SyncStatus = 'idle';
  private listeners: Set<(status: SyncStatus) => void> = new Set();

  private setStatus(status: SyncStatus) {
    this.status = status;
    this.listeners.forEach((fn) => fn(status));
  }

  onStatusChange(fn: (status: SyncStatus) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async pushPendingCases() {
    this.setStatus('syncing');
    try {
      const drafts = await getDraftCases();
      for (const draft of drafts) {
        const { _key, ...caseData } = draft;
        const { error } = await supabase.from('case_entries').insert(caseData);
        if (!error) {
          await removeDraftCase(_key);
        }
      }
      this.setStatus('idle');
    } catch (err) {
      console.error('Sync error:', err);
      this.setStatus('error');
    }
  }

  async pullTemplates(tenantId: string) {
    const { data } = await supabase
      .from('case_templates')
      .select('*')
      .eq('tenant_id', tenantId);
    return data;
  }

  getStatus(): SyncStatus {
    return this.status;
  }
}

export const syncService = new SyncService();
