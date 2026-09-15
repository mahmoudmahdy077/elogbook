import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
import { migrateLegacyQueueOnce } from './legacy-migration';
import { RETRY_DELAYS_MS } from './sync-retry';
import { clearAccountContext, setAccountContext } from './account-context';
import { noteAuthFailure } from './session';
import { logInfo, logError } from './logger';

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
        single: () => Promise<{ data: { id?: string; tenant_id: string } | null; error: unknown }>;
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
  /** Timestamp of the last successful queue flush / sync completion. */
  private lastSyncedAt: number | null = null;

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

  async initSync(_tenantId?: string) {
    // M5 single-queue sync: the durable per-account outbox is the ONLY push
    // path (push-only retry is the documented qualified-release sync mode;
    // the full SyncEngine pull/push lives in lib/sync/ and is test-only
    // unless FULL_SYNC_ENABLED is set — see feature-flags.ts).
    const started = Date.now();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { flushDurableQueue, getDurableCounts, classifyQueueError } = await import('./durable-queue');
      const result = await flushDurableQueue(supabase as never);
      // One-time upgrade migration: move legacy global-queue items into the
      // durable outbox, then delete the legacy key (never submit both formats).
      const migrated = await migrateLegacyQueueOnce().catch(() => 0);
      const counts = await getDurableCounts().catch(() => ({ queued: 0, quarantined: 0, total: 0 }));
      logInfo('sync.flush', {
        queueDepth: counts.queued,
        quarantined: counts.quarantined,
        latencyMs: Date.now() - started,
        retryClass: result.quarantined > 0 ? 'policy' : result.transient > 0 ? 'transient' : 'none',
        migrated,
      });
      if (result.synced > 0) {
        this.lastSyncedAt = Date.now();
        this.setStatus('synced');
        this.emitStatus();
      }
      if ((result.transient > 0 || result.quarantined > 0) && result.lastError) {
        // M1/M5: auth-class failures force a capability refresh (expiry/revocation).
        if (classifyQueueError(result.lastError) === 'auth') noteAuthFailure(401);
        this.partialFailureMessage = result.lastError;
        this.consumePartialFailure();
      }
    } catch (err) {
      logError('sync.init', err);
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

  /** Epoch ms of the last successful sync, or null if never synced. */
  getLastSyncedAt(): number | null {
    return this.lastSyncedAt;
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
        // M1: stop workers + drop account scope so old drafts/queue rows
        // are not queryable after sign-out. Callers wipe/quarantine
        // context-scoped AsyncStorage keys via scopedKey().
        clearAccountContext();
      }
      return;
    }
    try {
      const { data: profile } = await sb
        .from('profiles')
        .select('id,tenant_id')
        .eq('user_id', session.user.id)
        .single();
      const tenantId = profile?.tenant_id;
      if (tenantId) {
        svc.setTenantId(tenantId);
        // M1: bind the full account scope (incl. profile id) before sync work.
        setAccountContext({ userId: session.user.id, tenantId, profileId: profile?.id ?? '' });
        svc.startPeriodicSync();
      }
    } catch (err) {
      logError('sync.tenant-resolve', err);
    }
  });
  return subscription?.unsubscribe ?? (() => undefined);
}

export function useSyncInit(): void {
  useEffect(() => {
    return attachSyncAuthListener();
  }, []);
}
