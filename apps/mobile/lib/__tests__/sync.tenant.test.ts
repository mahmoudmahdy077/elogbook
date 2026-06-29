import { describe, it, expect, vi, beforeEach } from 'vitest';

type AuthCallback = (event: string, session: { user?: { id: string } } | null) => Promise<void> | void;

const mockUnsubscribe = vi.fn();
let capturedCallback: AuthCallback | null = null;
const mockFrom = vi.fn();
const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();

// react-native is a peer of sync.ts (AppState/NetInfo paths) and ships Flow
// syntax that the bundler used by vitest cannot parse. Mocking the surface
// we actually touch keeps the test focused on the auth-wiring behavior.
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
      onAuthStateChange: (cb: AuthCallback) => {
        capturedCallback = cb;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
      },
    },
    from: (table: string) => {
      mockFrom(table);
      return { select: mockSelect };
    },
  },
}));

// Import after the mock so the module picks up the mocked supabase.
import { attachSyncAuthListener, syncService } from '../sync';

const resetSupabaseMocks = () => {
  capturedCallback = null;
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
  mockSingle.mockReset();
  mockUnsubscribe.mockReset();
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ single: mockSingle });
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
    syncService.setTenantId(null);
    mockSingle.mockResolvedValueOnce({ data: { tenant_id: 'tenant-abc' }, error: null });

    attachSyncAuthListener();
    expect(capturedCallback).not.toBeNull();

    await capturedCallback!('SIGNED_IN', { user: { id: 'user-1' } });

    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockSelect).toHaveBeenCalledWith('tenant_id');
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(syncService.getTenantId()).toBe('tenant-abc');
  });

  it('also wires on INITIAL_SESSION so a deep link / cold start works', async () => {
    mockSingle.mockResolvedValueOnce({ data: { tenant_id: 'tenant-cold' }, error: null });

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

  it('does not set tenantId when the profile lookup fails', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

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
