import { describe, it, expect, vi, beforeEach } from 'vitest';

// M5.1: the disabled UXM-001 stub APIs are removed. The SyncService facade
// owns one push path (durable per-account outbox). These tests prove the
// facade contract at the real boundary (no native needed).

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: () => () => undefined,
    fetch: async () => ({ isConnected: true }),
  },
}));

const { mockFlushDurable, mockDurableCounts, mockMigrateLegacy, mockLegacyFlush, mockNoteAuthFailure } = vi.hoisted(() => ({
  mockFlushDurable: vi.fn(),
  mockDurableCounts: vi.fn(),
  mockMigrateLegacy: vi.fn(),
  mockLegacyFlush: vi.fn(),
  mockNoteAuthFailure: vi.fn(),
}));
// Facade tests stub the queue boundary; the real classifier + flush are
// covered by durable-queue.test.ts. The stub mirrors auth-vs-other only.
vi.mock('../durable-queue', () => ({
  flushDurableQueue: (...args: unknown[]) => mockFlushDurable(...args),
  getDurableCounts: (...args: unknown[]) => mockDurableCounts(...args),
  classifyQueueError: (m: string) => (/jwt|expired|unauthorized|401|403/i.test(m) ? 'auth' : 'transient'),
}));
vi.mock('../legacy-migration', () => ({
  migrateLegacyQueueOnce: (...args: unknown[]) => mockMigrateLegacy(...args),
}));

vi.mock('../offline-queue', () => ({
  flushQueue: (...args: unknown[]) => mockLegacyFlush(...args),
}));

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    from: () => ({ upsert: async () => ({ error: null }) }),
  },
}));

vi.mock('../session', () => ({
  noteAuthFailure: (...args: unknown[]) => mockNoteAuthFailure(...args),
}));

import { syncService } from '../sync';

beforeEach(() => {
  vi.clearAllMocks();
  mockFlushDurable.mockResolvedValue({ synced: 1, transient: 0, quarantined: 0, skippedForeign: 0, lastError: null });
  mockDurableCounts.mockResolvedValue({ queued: 0, quarantined: 0, total: 0 });
  mockMigrateLegacy.mockResolvedValue(0);
  syncService.cleanup();
});

describe('SyncService facade — single durable queue (M5.1)', () => {
  it('flushes the durable outbox on initSync and reports synced', async () => {
    await syncService.initSync('t1');
    expect(mockFlushDurable).toHaveBeenCalledTimes(1);
    expect(syncService.getStatus()).toBe('synced');
  });

  it('never submits through the legacy global queue', async () => {
    await syncService.initSync('t1');
    expect(mockLegacyFlush).not.toHaveBeenCalled();
  });

  it('surfaces quarantine as a partial failure (never silent)', async () => {
    mockFlushDurable.mockResolvedValue({
      synced: 0, transient: 0, quarantined: 1, skippedForeign: 0, lastError: 'policy: revoked',
    });
    const seen: string[] = [];
    const off = syncService.onPartialFailure((m) => seen.push(m));
    await syncService.initSync('t1');
    off();
    expect(seen).toEqual(['policy: revoked']);
  });

  it('flags auth-class quarantine for capability refresh', async () => {
    mockFlushDurable.mockResolvedValue({
      synced: 0, transient: 0, quarantined: 1, skippedForeign: 0, lastError: 'JWT expired',
    });
    await syncService.initSync('t1');
    expect(mockNoteAuthFailure).toHaveBeenCalledWith(401);
  });

  it('removed disabled stub APIs do not exist', () => {
    const svc = syncService as unknown as Record<string, unknown>;
    for (const name of [
      'pullCases', 'pullTemplates', 'pullGoals', 'pullRotations', 'pullMilestones',
      'pullEvaluations', 'pullComments', 'pullAllData', 'pushCases', 'handleConflicts',
      'getConflictDrafts',
    ]) {
      expect(svc[name], name).toBeUndefined();
    }
  });
});
