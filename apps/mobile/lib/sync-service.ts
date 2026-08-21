/**
 * SyncService v2 — offline-first sync orchestrator.
 *
 * Replaces the v1 stubs with the real SyncEngine. Integrates with:
 * - NetInfo for connectivity detection
 * - AppState for foreground/background lifecycle
 * - Exponential backoff for retry
 * - Real-time status emission for UI
 *
 * This is the React-layer adapter between the pure-TS SyncEngine and
 * the React Native app lifecycle.
 */

import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
import { SyncEngine, type SyncProgress } from './sync/engine';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'synced';
export type ConflictCallback = (residentId: string, entryId: string) => void;

/**
 * Incremental backoff for sync retries.
 */
const RETRY_DELAYS = [10_000, 30_000, 60_000, 120_000, 300_000];
const MAX_RETRIES = 5;

/**
 * OnlineSyncService — the production sync orchestrator.
 *
 * Usage:
 *   const svc = OnlineSyncService.getInstance();
 *   svc.setTenantId(tenantId);
 *   // Automatically syncs on reconnect / app foreground / periodic interval.
 */
export class OnlineSyncService {
  private static instance: OnlineSyncService | null = null;

  private status: SyncStatus = 'idle';
  private listeners: Set<(status: SyncStatus) => void> = new Set();
  private progressListeners: Set<(progress: SyncProgress) => void> = new Set();
  private conflictCallbacks: Set<ConflictCallback> = new Set();
  private netInfoUnsubscribe: (() => void) | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private retryIndex = 0;
  private retryCount = 0;
  private readonly MAX_RETRIES = MAX_RETRIES;
  private tenantId: string | null = null;
  private engine: SyncEngine | null = null;

  static getInstance(): OnlineSyncService {
    if (!OnlineSyncService.instance) {
      OnlineSyncService.instance = new OnlineSyncService();
    }
    return OnlineSyncService.instance;
  }

  private constructor() {
    this.initNetworkListener();
    this.initAppStateListener();
  }

  /**
   * Set the sync engine (injected after database init).
   */
  setEngine(engine: SyncEngine): void {
    this.engine = engine;
  }

  setTenantId(id: string | null | undefined): void {
    this.tenantId = id ?? null;
  }

  getTenantId(): string | null {
    return this.tenantId;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  onStatusChange(fn: (status: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  onProgress(fn: (progress: SyncProgress) => void): () => void {
    this.progressListeners.add(fn);
    return () => { this.progressListeners.delete(fn); };
  }

  setConflictCallback(fn: ConflictCallback): () => void {
    this.conflictCallbacks.add(fn);
    return () => { this.conflictCallbacks.delete(fn); };
  }

  /**
   * Initialize sync: called on auth state change to set up the tenant and
   * trigger an initial pull.
   */
  async initSync(tenantId?: string): Promise<void> {
    if (tenantId) this.tenantId = tenantId;
    if (!this.tenantId || !this.engine) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await this.runSync();
    } catch {
      // transient — next tick retries
    }
  }

  /**
   * Run a full sync cycle (pull + push).
   */
  async runSync(): Promise<SyncProgress | null> {
    if (!this.tenantId || !this.engine) return null;

    this.setStatus('syncing');

    try {
      const progress = await this.engine.sync(this.tenantId);
      this.progressListeners.forEach((fn) => fn(progress));

      if (progress.phase === 'synced') {
        this.retryIndex = 0;
        this.retryCount = 0;
        this.setStatus('synced');
      } else if (progress.phase === 'error') {
        this.handleError(progress);
      }

      return progress;
    } catch {
      this.handleError(null);
      return null;
    }
  }

  private handleError(progress: SyncProgress | null): void {
    if (this.retryCount < this.MAX_RETRIES) {
      this.retryCount++;
      const delay = RETRY_DELAYS[Math.min(this.retryIndex, RETRY_DELAYS.length - 1)] ?? 300_000;
      this.retryIndex++;
      this.setStatus('error');
      setTimeout(() => this.runSync(), delay);
    } else {
      this.setStatus('error');
      this.retryCount = 0;
      this.retryIndex = 0;
    }
  }

  startPeriodicSync(intervalMs = 60_000): void {
    this.stopPeriodicSync();
    this.intervalId = setInterval(() => this.runSync(), intervalMs);
  }

  stopPeriodicSync(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  cleanup(): void {
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

  private initNetworkListener(): void {
    this.netInfoUnsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected === true && this.status === 'offline') {
        this.retryCount = 0;
        this.retryIndex = 0;
        this.setStatus('idle');
        this.runSync();
      } else if (state.isConnected !== true) {
        this.setStatus('offline');
      }
    });
  }

  private initAppStateListener(): void {
    this.appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        this.startPeriodicSync(60_000);
        this.runSync();
      } else if (nextState === 'background') {
        this.stopPeriodicSync();
      }
    });
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    this.listeners.forEach((fn) => fn(status));
  }
}

/**
 * React hook to initialize sync on mount.
 */
export function useSyncInit(): void {
  useEffect(() => {
    const svc = OnlineSyncService.getInstance();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session?.user) {
        if (event === 'SIGNED_OUT') {
          svc.setTenantId(null);
          svc.cleanup();
        }
        return;
      }
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('user_id', session.user.id)
          .single();
        if (profile?.tenant_id) {
          svc.setTenantId(profile.tenant_id);
          svc.initSync(profile.tenant_id);
        }
      } catch (err) {
        console.error('[SyncService] failed to resolve tenant', err);
      }
    });
    return () => subscription?.unsubscribe?.();
  }, []);
}
