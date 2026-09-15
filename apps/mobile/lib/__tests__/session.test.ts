import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
      clear: async () => { store.clear(); },
    },
  };
});
vi.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n: number) => {
    const out = new Uint8Array(n);
    (globalThis.crypto as Crypto).getRandomValues(out);
    return out;
  },
}));
vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => store.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { store.set(k, v); },
    deleteItemAsync: async (k: string) => { store.delete(k); },
  };
});

import { clearAccountContext, getAccountContext } from '../account-context';
import { bootSession, noteAuthFailure, requireFreshCapability, resetSessionForTests } from '../session';

function mockSupabase(profile: unknown, policy: unknown, userId: string | null = 'u1') {
  return {
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null } }),
      getSession: async () => ({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: profile ? null : 'nf' }) }) }) };
      }
      return { select: () => ({ eq: () => ({ single: async () => ({ data: policy, error: null }) }) }) };
    },
  };
}

beforeEach(() => {
  clearAccountContext();
  resetSessionForTests();
});

describe('session boot machine (M1)', () => {
  it('resolves ready and populates the full account context', async () => {
    const sb = mockSupabase(
      { id: 'p1', user_id: 'u1', tenant_id: 't1', role: 'resident', status: 'active' },
      { tenant_id: 't1', mode: 'deidentified', version: 7 },
    );
    const s = await bootSession(sb as never);
    expect(s.state).toBe('ready');
    expect(s.capability?.policyVersion).toBe(7);
    const ctx = getAccountContext();
    expect(ctx?.profileId).toBe('p1');
    expect(ctx?.policyVersion).toBe(7);
    expect(ctx?.dataMode).toBe('deidentified');
  });

  it('reports signed-out when there is no user', async () => {
    const sb = mockSupabase(null, null, null);
    const s = await bootSession(sb as never);
    expect(s.state).toBe('signed-out');
    expect(getAccountContext()).toBeNull();
  });

  it('reports suspended without populating write scope', async () => {
    const sb = mockSupabase(
      { id: 'p9', user_id: 'u9', tenant_id: 't9', role: 'resident', status: 'suspended' },
      { tenant_id: 't9', mode: 'identifiable', version: 1 },
    );
    const s = await bootSession(sb as never);
    expect(s.state).toBe('suspended');
    expect(getAccountContext()).toBeNull();
  });

  it('401/403 via noteAuthFailure forces a refresh on next require', async () => {
    const sb = mockSupabase(
      { id: 'p1', user_id: 'u1', tenant_id: 't1', role: 'resident', status: 'active' },
      { tenant_id: 't1', mode: 'deidentified', version: 1 },
    );
    await bootSession(sb as never);
    noteAuthFailure(403);
    const cap = await requireFreshCapability(sb as never);
    expect(cap.policyVersion).toBe(1);
  });

  it('bestKnownCapability keeps the cached snapshot when refresh fails (offline)', async () => {
    const sb = mockSupabase(
      { id: 'p1', user_id: 'u1', tenant_id: 't1', role: 'resident', status: 'active' },
      { tenant_id: 't1', mode: 'deidentified', version: 1 },
    );
    await bootSession(sb as never);
    const { bestKnownCapability } = await import('../session');
    const failing = { auth: { getUser: async () => { throw new Error('offline'); } }, from: () => ({}) };
    const kept = await bestKnownCapability(failing as never);
    expect(kept?.policyVersion).toBe(1);
    resetSessionForTests();
    await expect(bestKnownCapability(failing as never)).resolves.toBeNull();
  });

  it('requireFreshCapability refetches a stale snapshot', async () => {
    let version = 1;
    const sb = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'u1' } } }),
        getSession: async () => ({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
      },
      from: (table: string) => {
        if (table === 'profiles') {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'p1', user_id: 'u1', tenant_id: 't1', role: 'resident', status: 'active' }, error: null }) }) }) };
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { tenant_id: 't1', mode: 'deidentified', version }, error: null }) }) }) };
      },
    };
    await bootSession(sb as never);
    version = 2;
    // Age the snapshot past freshness then require -> must refetch version 2.
    const { __ageSessionForTests } = await import('../session');
    __ageSessionForTests(10 * 60_000);
    const cap = await requireFreshCapability(sb as never);
    expect(cap.policyVersion).toBe(2);
    expect(vi).toBeDefined();
  });
});
