import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CaseEntry } from '../../lib/db/models/CaseEntry';

const mockGetDraftCases = vi.fn();
const mockUpdateSyncStatus = vi.fn();
const mockMarkCaseAsConflict = vi.fn();
const mockUpsertCaseEntry = vi.fn();

vi.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: () => () => undefined,
    fetch: async () => ({ isConnected: true }),
  },
}));

vi.mock('../db/database', () => ({ getDatabase: () => ({}) }));
vi.mock('../db/storage', () => ({
  getDraftCases: () => mockGetDraftCases(),
  getConflictedCases: async () => [],
  updateSyncStatus: (...args: unknown[]) => mockUpdateSyncStatus(...args),
  markCaseAsConflict: (...args: unknown[]) => mockMarkCaseAsConflict(...args),
  upsertCaseEntry: (...args: unknown[]) => mockUpsertCaseEntry(...args),
  batchUpsertCaseEntries: async () => undefined,
  batchUpsertTemplates: async () => undefined,
  batchUpsertGoals: async () => undefined,
  getLastSyncTimestamp: async () => null,
  setLastSyncTimestamp: async () => undefined,
}));

interface SupabaseCall {
  type: 'insert' | 'update' | 'upsert';
  payload: Record<string, unknown> | Record<string, unknown>[];
  targetId?: string;
}

const calls: SupabaseCall[] = [];

const mockChain: {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
} = {
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
};

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    from: (table: string) => {
      if (table !== 'case_entries') throw new Error(`Unexpected table ${table}`);
      mockChain.select.mockImplementation(() => mockChain);
      mockChain.eq.mockImplementation(() => mockChain);
      mockChain.insert.mockImplementation((payload: Record<string, unknown>) => {
        calls.push({ type: 'insert', payload });
        return mockChain;
      });
      mockChain.upsert.mockImplementation((payload: Record<string, unknown>[]) => {
        calls.push({ type: 'upsert', payload });
        return mockChain;
      });
      mockChain.update.mockImplementation((payload: Record<string, unknown>) => {
        const entry: SupabaseCall = { type: 'update', payload };
        const originalEq = mockChain.eq.getMockImplementation();
        mockChain.eq.mockImplementation((_col: string, val: string) => {
          entry.targetId = val;
          mockChain.eq.mockImplementation(originalEq!);
          return mockChain;
        });
        calls.push(entry);
        return mockChain;
      });
      return mockChain;
    },
  },
}));

import { syncService } from '../sync';

function makeDraft(overrides: Partial<CaseEntry> = {}): CaseEntry {
  return {
    id: 'local-uuid-1',
    serverId: null,
    tenantId: 't-1',
    residentId: 'r-1',
    templateId: 'tmpl-1',
    patientMrn: null,
    patientDob: null,
    patientAgeYears: 30,
    patientHash: null,
    caseDate: '2026-06-29',
    fieldValues: {},
    accreditationMappings: [],
    isDeidentified: true,
    status: 'draft',
    localSyncStatus: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
    _raw: { field_values: '{}', accreditation_mappings: '[]' },
    ...overrides,
  } as unknown as CaseEntry;
}

beforeEach(() => {
  calls.length = 0;
  mockGetDraftCases.mockReset();
  mockUpdateSyncStatus.mockReset();
  mockMarkCaseAsConflict.mockReset();
  mockUpsertCaseEntry.mockReset();
  Object.values(mockChain).forEach((fn) => {
    if (typeof fn.mockReset === 'function') fn.mockReset();
  });
  // Default: upsert returns a server id; updates return ok
  mockChain.select.mockImplementation(() => mockChain);
  mockChain.eq.mockImplementation(() => mockChain);
  mockChain.insert.mockImplementation((payload: Record<string, unknown>) => {
    calls.push({ type: 'insert', payload });
    return mockChain;
  });
  mockChain.upsert.mockImplementation((payload: Record<string, unknown>[]) => {
    calls.push({ type: 'upsert', payload });
    return mockChain;
  });
  mockChain.update.mockImplementation((payload: Record<string, unknown>) => {
    const entry: SupabaseCall = { type: 'update', payload };
    const originalEq = mockChain.eq.getMockImplementation();
    mockChain.eq.mockImplementation((_col: string, val: string) => {
      entry.targetId = val;
      mockChain.eq.mockImplementation(originalEq!);
      return mockChain;
    });
    calls.push(entry);
    return mockChain;
  });
  mockChain.single.mockResolvedValue({ data: { id: 'server-uuid-99' }, error: null });
  syncService.cleanup();
  syncService.setTenantId('t-1');
});

describe('pushCases — server id + conflict handling', () => {
  it('inserts new drafts in a batch and writes the server id back to the local row', async () => {
    const draft = makeDraft();
    mockGetDraftCases.mockResolvedValueOnce([draft]);
    // upsert().select('id') resolves directly to a data array (not .single())
    mockChain.select.mockImplementationOnce(() => ({
      ...mockChain,
      // override the thenable: we want the chain itself to resolve
      // the awaiter does `await supabase.from(...).upsert(...).select('id')`
      // and the destructured { data, error } comes from this object
    }));
    // Simpler: make the chain a thenable
    (mockChain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: [{ id: 'server-uuid-99' }], error: null }).then(resolve);

    await syncService.pushCases();

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('upsert');
    expect(mockUpdateSyncStatus).toHaveBeenCalledWith(draft, 'synced', draft.id);
  });

  it('targets server id (not local uuid) for `modified` updates', async () => {
    const draft = makeDraft({ localSyncStatus: 'modified', serverId: 'server-uuid-99' });
    mockGetDraftCases.mockResolvedValueOnce([draft]);

    await syncService.pushCases();

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('update');
    expect(calls[0].targetId).toBe('server-uuid-99');
  });

  it('marks the row as conflict and fires the conflict callback on batch 409', async () => {
    const draft = makeDraft();
    mockGetDraftCases.mockResolvedValueOnce([draft]);
    (mockChain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) =>
      Promise.resolve({
        data: null,
        error: { code: '409', message: 'conflict detected' },
      }).then(resolve);

    const conflictListener = vi.fn();
    const unsub = syncService.setConflictCallback(conflictListener);

    await syncService.pushCases();
    unsub();

    expect(mockMarkCaseAsConflict).toHaveBeenCalledWith(draft);
    expect(conflictListener).toHaveBeenCalledWith(draft.residentId, draft.id);
  });

  it('does NOT mark conflict on a generic 500 batch error', async () => {
    const draft = makeDraft();
    mockGetDraftCases.mockResolvedValueOnce([draft]);
    (mockChain as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) =>
      Promise.resolve({
        data: null,
        error: { code: '500', message: 'internal' },
      }).then(resolve);

    const conflictListener = vi.fn();
    const unsub = syncService.setConflictCallback(conflictListener);

    await syncService.pushCases();
    unsub();

    expect(mockMarkCaseAsConflict).not.toHaveBeenCalled();
    expect(conflictListener).not.toHaveBeenCalled();
  });

  it('surfaces a partial-failure message when one of the modified updates 409s', async () => {
    const draft1 = makeDraft({ id: 'd-1', localSyncStatus: 'modified', serverId: 's-1' });
    const draft2 = makeDraft({ id: 'd-2', localSyncStatus: 'modified', serverId: 's-2' });
    mockGetDraftCases.mockResolvedValueOnce([draft1, draft2]);
    // first update ok, second update 409s
    mockChain.single
      .mockResolvedValueOnce({ data: { id: 's-1', updated_at: '2026-06-29T10:00:00.000Z' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '409', message: 'conflict' } });

    const partialListener = vi.fn();
    const unsub = syncService.onPartialFailure(partialListener);
    syncService.consumePartialFailure();
    // before sync there is nothing pending
    expect(partialListener).not.toHaveBeenCalled();

    await syncService.pushCases();
    syncService.consumePartialFailure();
    unsub();

    expect(partialListener).toHaveBeenCalledWith('1 of 2 cases failed to sync');
  });

  it('sends modified drafts to the upsert path as a batch of size 1', async () => {
    const draft = makeDraft({ localSyncStatus: 'modified', serverId: 's-1' });
    mockGetDraftCases.mockResolvedValueOnce([draft]);

    await syncService.pushCases();

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('update');
    expect(calls[0].targetId).toBe('s-1');
  });
});
