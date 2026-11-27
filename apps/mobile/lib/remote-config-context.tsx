/**
 * App-wide remote config provider. Loads the web-controlled settings on boot,
 * on every foreground, and after sign-in/tenant change, and keeps the last
 * cached snapshot when the network is down.
 *
 * Consumers: the control gate (maintenance / forced update), the tab layout
 * and side menu (module toggles), and the dashboard announcement banner.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import type { MobileRemoteConfig } from '@elogbook/shared';
import {
  EMPTY_REMOTE_CONFIG,
  currentTenantId,
  fetchRemoteConfig,
  loadCachedRemoteConfig,
  type RemoteConfigSnapshot,
} from './remote-config';
import { supabase } from './supabase';
import { logWarn } from './logger';

export type RemoteConfigStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface RemoteConfigContextValue {
  config: MobileRemoteConfig;
  institutionName: string | null;
  primaryColor: string | null;
  tenantId: string | null;
  status: RemoteConfigStatus;
  fetchedAt: number;
  appVersion: string;
  refresh: () => Promise<void>;
}

const DEFAULT_VALUE: RemoteConfigContextValue = {
  config: EMPTY_REMOTE_CONFIG.config,
  institutionName: null,
  primaryColor: null,
  tenantId: null,
  status: 'idle',
  fetchedAt: 0,
  appVersion: '0.0.0',
  refresh: async () => undefined,
};

const RemoteConfigContext = createContext<RemoteConfigContextValue>(DEFAULT_VALUE);

function installedVersion(): string {
  const version = Constants.expoConfig?.version;
  return typeof version === 'string' && version ? version : '0.0.0';
}

export function RemoteConfigProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<RemoteConfigSnapshot>(EMPTY_REMOTE_CONFIG);
  const [status, setStatus] = useState<RemoteConfigStatus>('idle');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const tenantId = await currentTenantId();
    if (!tenantId) {
      if (!mounted.current) return;
      setSnapshot(EMPTY_REMOTE_CONFIG);
      setStatus('ready');
      return;
    }

    // Show the cached controls immediately, then refresh from the server.
    const cached = await loadCachedRemoteConfig(tenantId);
    if (cached && mounted.current) {
      setSnapshot(cached);
      setStatus('ready');
    } else if (mounted.current) {
      setStatus('loading');
    }

    try {
      const fresh = await fetchRemoteConfig(tenantId);
      if (!mounted.current) return;
      setSnapshot(fresh);
      setStatus('ready');
    } catch {
      logWarn('remote-config.refresh-failed');
      if (!mounted.current) return;
      setStatus(cached ? 'ready' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        void load();
      }
    });
    return () => subscription?.unsubscribe?.();
  }, [load]);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === 'active') void load();
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [load]);

  const value = useMemo<RemoteConfigContextValue>(
    () => ({
      config: snapshot.config,
      institutionName: snapshot.institutionName,
      primaryColor: snapshot.primaryColor,
      tenantId: snapshot.tenantId,
      status,
      fetchedAt: snapshot.fetchedAt,
      appVersion: installedVersion(),
      refresh: load,
    }),
    [snapshot, status, load],
  );

  return (
    <RemoteConfigContext.Provider value={value}>{children}</RemoteConfigContext.Provider>
  );
}

export function useRemoteConfig(): RemoteConfigContextValue {
  return useContext(RemoteConfigContext);
}
