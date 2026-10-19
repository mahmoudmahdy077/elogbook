import { beforeEach, describe, expect, it, vi } from 'vitest';

type AuthCallback = (event: string, session: { user?: { id: string } } | null) => Promise<void> | void;

const mockUnsubscribe = vi.fn();
let capturedCallback: AuthCallback | null = null;
const mockFrom = vi.fn();
const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
let activeUserId = 'user-1';
let activeTenantId = 'tenant-abc';
let tenantStatus = 'active';
let profileError: unknown = null;

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: () => ({ remove: () => undefined }),
  },
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: () => () => undefined,
    fetch: async () => ({ isConnected: true }),
  },
}));

vi.mock('../db/database', () => ({
  getDatabase: () => ({}),
}));

vi.mock('../offline-queue', () => ({
  flushQueue: async () => ({ synced: 0, failed: 0, lastError: null }),
}));

vi.mock('../legacy-migration', () => ({
  migrateLegacyQueueOnce: async () => 0,
}));

vi.mock('../session', () => ({
  noteAuthFailure: () => undefined,
}));

vi.mock('../db/storage', () => ({
  getDraftCases: async () => [],
  getConflictedCases: async () => [],
  updateSyncStatus: async () => undefined,
  upsertCaseEntry: async () => undefined,
  batchUpsertCaseEntries: async () => undefined,
  batchUpsertTemplates: async () => undefined,
  batchUpsertGoals: async () => undefined,
  getLastSyncTimestamp: async () => null,
  setLastSyncTimestamp: async () => undefined,
}));

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: activeUserId } } }),
      getSession: async () => ({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2' }, error: null }),
      },
      onAuthStateChange: (cb: AuthCallback) => {
        capturedCallback = async (event, session) => {
          if (session?.user) {
            activeUserId = session.user.id;
          }
          return cb(event, session);
        };
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      },
    },
    from: (table: string) => {
      mockFrom(table);
      return {
        select: (columns: string) => {
          mockSelect(columns);
          return {
            eq: (column: string, value: string) => {
              mockEq(column, value);
              return {
                single: async () => {
                  if (table === 'profiles') {
                    if (profileError) return { data: null, error: profileError };
                    return {
                      data: {
                        id: 'profile-1',
                        user_id: activeUserId,
                        tenant_id: activeTenantId,
                        role: 'resident',
                        status: 'active',
                      },
                      error: null,
                    };
                  }
                  if (table === 'tenants') {
                    return { data: { id: activeTenantId, status: tenantStatus }, error: null };
                  }
                  return { data: { tenant_id: activeTenantId, mode: 'deidentified', version: 1 }, error: null };
                },
              };
            },
          };
        },
      };
    },
  },
}));

import { attachSyncAuthListener, syncService } from '../sync';

const resetSupabaseMocks = () => {
  capturedCallback = null;
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
  mockSingle.mockReset();
  mockUnsubscribe.mockReset();
  activeUserId = 'user-1';
  activeTenantId = 'tenant-abc';
  tenantStatus = 'active';
  profileError = null;
};

describe('attachSyncAuthListener', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetSupabaseMocks();
    syncService.setTenantId(null);
    syncService.cleanup();
  });

  it('returns an unsubscribe function from supabase', () => {
    const unsubscribe = attachSyncAuthListener();
    expect(unsubscribe).toBe(mockUnsubscribe);
  });

  it('sets tenantId and starts periodic sync on a fresh sign-in', async () => {
    activeTenantId = 'tenant-abc';
    attachSyncAuthListener();
    expect(capturedCallback).not.toBeNull();

    await capturedCallback!('SIGNED_IN', { user: { id: 'user-1' } });

    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockFrom).toHaveBeenCalledWith('tenants');
    expect(mockSelect).toHaveBeenCalledWith('id,user_id,tenant_id,role,status');
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(syncService.getTenantId()).toBe('tenant-abc');
  });

  it('also wires on INITIAL_SESSION so a deep link / cold start works', async () => {
    activeTenantId = 'tenant-cold';
    attachSyncAuthListener();
    await capturedCallback!('INITIAL_SESSION', { user: { id: 'user-2' } });

    expect(syncService.getTenantId()).toBe('tenant-cold');
  });

  it('clears tenantId and cleans up on SIGNED_OUT', async () => {
    syncService.setTenantId('tenant-abc');
    const setTenantIdSpy = vi.spyOn(syncService, 'setTenantId');
    const cleanupSpy = vi.spyOn(syncService, 'cleanup');

    attachSyncAuthListener();
    await capturedCallback!('SIGNED_OUT', null);

    expect(setTenantIdSpy).toHaveBeenCalledWith(null);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('does not start sync when the tenant is suspended', async () => {
    tenantStatus = 'suspended';
    attachSyncAuthListener();
    await capturedCallback!('SIGNED_IN', { user: { id: 'user-4' } });

    expect(syncService.getTenantId()).toBeNull();
  });

  it('does not set tenantId when the server capability lookup fails', async () => {
    profileError = { message: 'not found' };
    attachSyncAuthListener();
    await capturedCallback!('SIGNED_IN', { user: { id: 'user-3' } });

    expect(syncService.getTenantId()).toBeNull();
  });

  it('does nothing for events without a user session', async () => {
    const setTenantIdSpy = vi.spyOn(syncService, 'setTenantId');
    attachSyncAuthListener();
    await capturedCallback!('TOKEN_REFRESHED', null);

    expect(setTenantIdSpy).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
