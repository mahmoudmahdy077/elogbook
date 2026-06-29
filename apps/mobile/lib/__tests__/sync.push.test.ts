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
  type: 'insert' | 'update';
  payload: Record<string, unknown>;
  targetId?: string;
}

const calls: SupabaseCall[] = [];

const mockChain: {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} = {
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
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
  Object.values(mockChain).forEach((fn) => fn.mockReset());
  syncService.cleanup();
  syncService.setTenantId('t-1');
});

describe('pushCases — server id + conflict handling', () => {
  it('inserts new drafts and writes the server id back to the local row', async () => {
    const draft = makeDraft();
    mockGetDraftCases.mockResolvedValueOnce([draft]);
    mockChain.single.mockResolvedValueOnce({ data: { id: 'server-uuid-99' }, error: null });

    await syncService.pushCases();

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('insert');
    expect(mockUpdateSyncStatus).toHaveBeenCalledWith(draft, 'synced', 'server-uuid-99');
  });

  it('targets server id (not local uuid) for `modified` updates', async () => {
    const draft = makeDraft({ localSyncStatus: 'modified', serverId: 'server-uuid-99' });
    mockGetDraftCases.mockResolvedValueOnce([draft]);
    mockChain.single.mockResolvedValueOnce({ data: { id: 'server-uuid-99' }, error: null });

    await syncService.pushCases();

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('update');
    expect(calls[0].targetId).toBe('server-uuid-99');
  });

  it('marks the row as conflict and fires the conflict callback on 409', async () => {
    const draft = makeDraft();
    mockGetDraftCases.mockResolvedValueOnce([draft]);
    mockChain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '409', message: 'conflict' },
    });
    const conflictListener = vi.fn();
    const unsub = syncService.setConflictCallback(conflictListener);

    await syncService.pushCases();
    unsub();

    expect(mockMarkCaseAsConflict).toHaveBeenCalledWith(draft);
    expect(conflictListener).toHaveBeenCalledWith(draft.residentId, draft.id);
  });

  it('does NOT fire the conflict callback on a 500 / generic error', async () => {
    const draft = makeDraft();
    mockGetDraftCases.mockResolvedValueOnce([draft]);
    mockChain.single.mockResolvedValueOnce({
      data: null,
      error: { code: '500', message: 'internal' },
    });
    const conflictListener = vi.fn();
    const unsub = syncService.setConflictCallback(conflictListener);

    await syncService.pushCases();
    unsub();

    expect(mockMarkCaseAsConflict).not.toHaveBeenCalled();
    expect(conflictListener).not.toHaveBeenCalled();
  });
});
