import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
import { RETRY_DELAYS_MS } from './sync-retry';

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
  private partialFailureMessage: string | null = null;
  private partialFailureListeners: Set<(msg: string) => void> = new Set();

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

  onPartialFailure(fn: (msg: string) => void) {
    this.partialFailureListeners.add(fn);
    return () => {
      this.partialFailureListeners.delete(fn);
    };
  }

  consumePartialFailure() {
    const msg = this.partialFailureMessage;
    this.partialFailureMessage = null;
    if (msg) {
      this.partialFailureListeners.forEach((fn) => fn(msg));
    }
  }

  async pullCases(_tenantId: string) {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
  }

  async pullTemplates(_tenantId: string) {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
  }

  async pullGoals(_tenantId: string) {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
  }

  async pullRotations(_tenantId: string) {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
  }

  async pullMilestones(_tenantId: string) {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
  }

  async pullEvaluations(_tenantId: string) {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
  }

  async pullComments(_tenantId: string) {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
  }

  async pullAllData(_tenantId: string) {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
  }

  async pushCases() {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
  }

  async handleConflicts() {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
  }

  async initSync(_tenantId?: string) {
    console.warn('Sync disabled in v1 (UXM-001). Use Supabase directly.');
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
    return [];
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
