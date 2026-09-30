/**
 * Tests for the HIPAA audit trail module.
 *
 * Covers:
 *   - Logging PHI access events with correct structure
 *   - Ring-buffer persistence and max-500 cap
 *   - getAuditLog() retrieval
 *   - exportAuditLog() JSON export
 *   - clearAuditLog() on logout
 *   - Flush to Supabase when online
 *   - canAccessPHI() role gating
 *   - SHA-256 hashing of accessed data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (must be defined before vi.mock calls due to hoisting)
// ---------------------------------------------------------------------------

const { storage, mockInsert, mockRpc, mockGetSession, mockGetRoleFromAuth } =
  vi.hoisted(() => ({
    storage: new Map<string, string>(),
    mockInsert: vi.fn().mockResolvedValue({ error: null }),
    mockRpc: vi.fn(),
    mockGetSession: vi.fn().mockResolvedValue({
      data: { session: { user: { id: 'user-123' } } },
      error: null,
    }),
    mockGetRoleFromAuth: vi.fn().mockResolvedValue({
      role: 'resident',
      fullName: 'Dr. Test',
      tenantId: 'tenant-1',
      profileId: 'profile-1',
    }),
  }));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// AsyncStorage in-memory mock
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
  },
}));

// Supabase mock
vi.mock('../../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: mockInsert,
    })),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      getSession: mockGetSession,
    },
  },
}));

// auth-guard mock — default returns a resident
vi.mock('../../auth-guard', () => ({
  getRoleFromAuth: (...args: unknown[]) => mockGetRoleFromAuth(...args),
}));

// sha256 — use real implementation for hash verification
import { sha256 as realSha256, bytesToHex } from '../../crypto/sha256';

vi.mock('../../crypto/sha256', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../crypto/sha256')>();
  return {
    sha256: actual.sha256,
    bytesToHex: actual.bytesToHex,
  };
});

// ---------------------------------------------------------------------------
// Import module under test (after mocks are in place)
// ---------------------------------------------------------------------------

import {
  logAuditEvent,
  getAuditLog,
  exportAuditLog,
  clearAuditLog,
  flushAuditLog,
  startAuditFlush,
  stopAuditFlush,
  canAccessPHI,
  logPhiRead,
  logPhiWrite,
  getAuditDeliveryStatus,
  auditBufferKey,
  type AuditEntry,
} from '../audit-trail';
import { setAccountContext, clearAccountContext } from '../../account-context';

// N1: the audit buffer is per-account scoped. The session is part of the key
// too, so a session can never overwrite the record of the one before it; the
// tests below read the key from the module rather than pinning its text.
let scopedAuditKey = '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashString(s: string): string {
  return bytesToHex(realSha256(new TextEncoder().encode(s)));
}

function hashJson(obj: unknown): string {
  return hashString(
    obj === null || obj === undefined ? 'null' : JSON.stringify(obj),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('audit-trail', () => {
  beforeEach(async () => {
    storage.clear();
    clearAccountContext();
    setAccountContext({ userId: 'user-123', tenantId: 'tenant-1', profileId: 'profile-1' });
    mockInsert.mockReset().mockResolvedValue({ error: null });
    mockRpc.mockReset().mockResolvedValue({ data: 'audit-row-1', error: null });
    mockGetSession.mockReset().mockResolvedValue({
      data: { session: { user: { id: 'user-123' } } },
      error: null,
    });
    mockGetRoleFromAuth.mockReset().mockResolvedValue({
      role: 'resident',
      fullName: 'Dr. Test',
      tenantId: 'tenant-1',
      profileId: 'profile-1',
    });
    // Reset the module's internal buffer state by clearing + reloading
    await clearAuditLog();
    scopedAuditKey = auditBufferKey();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopAuditFlush();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // 1. Logging events
  // -----------------------------------------------------------------------
  describe('logAuditEvent', () => {
    it('refuses to persist an audit event without an active account scope', async () => {
      clearAccountContext();
      await expect(
        logAuditEvent({
          userId: 'u1',
          action: 'read',
          table: 'case_entries',
          rowId: 'r1',
          data: 'x',
        }),
      ).rejects.toThrow(/account context|scope/i);
    });

    it('stores an entry with all required fields', async () => {
      await logAuditEvent({
        userId: 'user-abc',
        action: 'read',
        table: 'case_entries',
        rowId: 'row-1',
        data: { patient_mrn: 'MRN-001', patient_dob: '1990-01-01' },
      });

      const entries = await getAuditLog();
      expect(entries).toHaveLength(1);

      const e = entries[0]!;
      expect(e.user_id).toBe('user-123');
      expect(e.action).toBe('read');
      expect(e.table).toBe('case_entries');
      expect(e.row_id).toBe('row-1');
      expect(e.timestamp).toBeTruthy();
      // Verify timestamp is valid ISO-8601
      expect(new Date(e.timestamp).toISOString()).toBe(e.timestamp);
      // Verify hash matches SHA-256 of the data
      const expectedHash = hashJson({
        patient_mrn: 'MRN-001',
        patient_dob: '1990-01-01',
      });
      expect(e.data_hash).toBe(expectedHash);
      // PHI is NOT stored in plaintext
      expect(JSON.stringify(e)).not.toContain('MRN-001');
      expect(JSON.stringify(e)).not.toContain('1990-01-01');
    });

    it('hashes null data as "null"', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'delete',
        table: 'evaluation_forms',
        rowId: 'r9',
        data: null,
      });

      const entries = await getAuditLog();
      expect(entries[0]!.data_hash).toBe(hashString('null'));
    });

    it('hashes object data as JSON string', async () => {
      const phi = { patient_mrn: 'X', field_values: { dx: 'appendicitis' } };
      await logAuditEvent({
        userId: 'u1',
        action: 'create',
        table: 'case_entries',
        rowId: 'r1',
        data: phi,
      });

      const entries = await getAuditLog();
      expect(entries[0]!.data_hash).toBe(hashJson(phi));
    });

    it('hashes string data directly', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 'case_entries',
        rowId: 'r1',
        data: 'MRN-12345',
      });

      const entries = await getAuditLog();
      expect(entries[0]!.data_hash).toBe(hashString('MRN-12345'));
    });
  });

  // -----------------------------------------------------------------------
  // 2. Ring buffer (max 500)
  // -----------------------------------------------------------------------
  describe('ring buffer', () => {
    it('persists entries across loadBuffer calls', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data: 'a',
      });

      // Simulate module reload by clearing internal state
      await clearAuditLog();
      // Re-log
      await logAuditEvent({
        userId: 'u2',
        action: 'create',
        table: 't',
        rowId: 'r2',
        data: 'b',
      });

      const entries = await getAuditLog(10);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      // The second entry should be present
      const lastEntry = entries[entries.length - 1]!;
      expect(lastEntry.user_id).toBe('user-123');
    });

    it('caps buffer at 500 entries (ring-buffer eviction)', async () => {
      // Insert 499 entries to fill near capacity
      for (let i = 0; i < 499; i++) {
        await logAuditEvent({
          userId: 'u1',
          action: 'read',
          table: 't',
          rowId: `r-${i}`,
          data: i,
        });
      }

      // Buffer should have 499
      let entries = await getAuditLog(600);
      expect(entries).toHaveLength(499);

      // Insert 2 more → total 501, should evict 2 oldest
      await logAuditEvent({
        userId: 'u1',
        action: 'create',
        table: 't',
        rowId: 'r-500',
        data: 'new',
      });
      await logAuditEvent({
        userId: 'u1',
        action: 'update',
        table: 't',
        rowId: 'r-501',
        data: 'newer',
      });

      entries = await getAuditLog(600);
      expect(entries).toHaveLength(500);
      // Oldest entry (r-0) evicted; r-1 is now first
      expect(entries[0]!.row_id).toBe('r-1');
      // Newest entries should be present
      expect(entries[499]!.row_id).toBe('r-501');
      expect((await getAuditDeliveryStatus()).dropped).toBe(1);
    });

    it('keeps the persisted record byte-identical to the in-memory buffer', async () => {
      // The stored value is built incrementally while entries are appended,
      // so it has to stay exactly what a full re-serialization would produce.
      for (let i = 0; i < 12; i++) {
        await logAuditEvent({
          userId: 'u1',
          action: 'read',
          table: 't',
          rowId: `r-${i}`,
          data: { patient_mrn: `MRN-${i}`, patient_dob: '1990-01-01' },
        });
        expect(storage.get(scopedAuditKey)).toBe(JSON.stringify(await getAuditLog(600)));
      }
    });

    it('keeps the persisted record in sync across eviction', async () => {
      for (let i = 0; i < 500; i++) {
        await logAuditEvent({
          userId: 'u1',
          action: 'read',
          table: 't',
          rowId: `r-${i}`,
          data: i,
        });
      }
      // Full buffer, no eviction yet.
      expect(storage.get(scopedAuditKey)).toBe(JSON.stringify(await getAuditLog(600)));

      // Two more cross the cap, so the incremental text is dropped and
      // rebuilt across a shift.
      for (let i = 500; i < 502; i++) {
        await logAuditEvent({
          userId: 'u1',
          action: 'create',
          table: 't',
          rowId: `r-${i}`,
          data: 'new',
        });
      }
      const entries = await getAuditLog(600);
      expect(entries).toHaveLength(500);
      expect(entries[0]!.row_id).toBe('r-2');
      expect(storage.get(scopedAuditKey)).toBe(JSON.stringify(entries));
    });

    it('keeps the persisted record in sync after a flush removes delivered entries', async () => {
      for (let i = 0; i < 8; i++) {
        await logAuditEvent({
          userId: 'u1',
          action: 'read',
          table: 't',
          rowId: `r-${i}`,
          data: i,
        });
      }

      expect(await flushAuditLog()).toBe(8);

      expect(await getAuditLog()).toEqual([]);
      expect(storage.get(scopedAuditKey)).toBe('[]');
    });

    it('does not carry the previous account persisted record into a new scope', async () => {
      for (let i = 0; i < 3; i++) {
        await logAuditEvent({
          userId: 'user-123',
          action: 'read',
          table: 'case_entries',
          rowId: `a-${i}`,
          data: 'x',
        });
      }
      expect(storage.get(scopedAuditKey)).not.toBeUndefined();

      setAccountContext({ userId: 'user-456', tenantId: 'tenant-2', profileId: 'profile-2' });
      await logAuditEvent({
        userId: 'user-456',
        action: 'read',
        table: 'case_entries',
        rowId: 'b-1',
        data: 'y',
      });

      const nextKey = auditBufferKey();
      expect(nextKey).toContain('user-456:tenant-2:');
      const persisted = JSON.parse(storage.get(nextKey)!) as AuditEntry[];
      expect(persisted).toHaveLength(1);
      expect(persisted[0]!.row_id).toBe('b-1');
      expect(persisted[0]!.user_id).toBe('user-456');
      // The previous account's own record is untouched by the switch.
      expect(JSON.parse(storage.get(scopedAuditKey)!)).toHaveLength(3);
    });

    it('does not let a new session overwrite the previous session record', async () => {
      // An entry that never reached the server is the only copy of that access.
      // The buffer is a whole-value record, so a new session reading it and
      // finding none of its own entries used to write its first event straight
      // over the record, and the prior session's undelivered events were gone.
      // A relaunch or a re-authentication creates such a session; sign-out is
      // not the only way to reach one.
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 'case_entries',
        rowId: 'prior-session',
        data: 'x',
      });
      const priorKey = auditBufferKey();
      expect(JSON.parse(storage.get(priorKey)!) as AuditEntry[]).toHaveLength(1);

      clearAccountContext();
      setAccountContext({ userId: 'user-123', tenantId: 'tenant-1', profileId: 'profile-1' });
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 'case_entries',
        rowId: 'current-session',
        data: 'y',
      });

      // The new session sees only its own event -- no exposure across sessions.
      const visible = await getAuditLog();
      expect(visible).toHaveLength(1);
      expect(visible[0]!.row_id).toBe('current-session');
      expect(await exportAuditLog()).not.toContain('prior-session');

      // And the prior session's record is still there, undelivered, under a key
      // this session cannot write.
      expect(auditBufferKey()).not.toBe(priorKey);
      const preserved = JSON.parse(storage.get(priorKey)!) as AuditEntry[];
      expect(preserved).toHaveLength(1);
      expect(preserved[0]!.row_id).toBe('prior-session');
    });
  });

  // -----------------------------------------------------------------------
  // 3. getAuditLog
  // -----------------------------------------------------------------------
  describe('getAuditLog', () => {
    it('does not expose the previous account in-memory buffer after a switch', async () => {
      await logAuditEvent({
        userId: 'user-123',
        action: 'read',
        table: 'case_entries',
        rowId: 'r1',
        data: 'x',
      });
      setAccountContext({ userId: 'user-456', tenantId: 'tenant-2', profileId: 'profile-2' });
      await expect(getAuditLog()).resolves.toEqual([]);
    });

    it('returns empty array when no entries exist', async () => {
      const entries = await getAuditLog();
      expect(entries).toEqual([]);
    });

    it('returns most recent N entries', async () => {
      for (let i = 0; i < 10; i++) {
        await logAuditEvent({
          userId: 'u1',
          action: 'read',
          table: 't',
          rowId: `r-${i}`,
          data: i,
        });
      }

      const last5 = await getAuditLog(5);
      expect(last5).toHaveLength(5);
      expect(last5[0]!.row_id).toBe('r-5');
      expect(last5[4]!.row_id).toBe('r-9');
    });

    it('returns all entries when limit exceeds buffer size', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data: 'x',
      });

      const entries = await getAuditLog(100);
      expect(entries).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 4. exportAuditLog
  // -----------------------------------------------------------------------
  describe('exportAuditLog', () => {
    it('returns valid JSON string with all entries', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 'case_entries',
        rowId: 'r1',
        data: { patient_mrn: 'MRN-999' },
      });
      await logAuditEvent({
        userId: 'u2',
        action: 'update',
        table: 'case_entries',
        rowId: 'r1',
        data: { patient_dob: '1985-06-15' },
      });

      const json = await exportAuditLog();
      expect(typeof json).toBe('string');

      const parsed = JSON.parse(json) as AuditEntry[];
      expect(parsed).toHaveLength(2);
      expect(parsed[0]!.user_id).toBe('user-123');
      expect(parsed[1]!.user_id).toBe('user-123');
      // No raw PHI in the export
      expect(json).not.toContain('MRN-999');
      expect(json).not.toContain('1985-06-15');
    });

    it('returns empty JSON array when log is empty', async () => {
      const json = await exportAuditLog();
      expect(JSON.parse(json)).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 5. clearAuditLog
  // -----------------------------------------------------------------------
  describe('clearAuditLog', () => {
    it('removes all entries from storage', async () => {
      for (let i = 0; i < 5; i++) {
        await logAuditEvent({
          userId: 'u1',
          action: 'read',
          table: 't',
          rowId: `r-${i}`,
          data: i,
        });
      }

      expect(await getAuditLog()).toHaveLength(5);

      await clearAuditLog();

      expect(await getAuditLog()).toHaveLength(0);
      // AsyncStorage key should be removed
      expect(storage.has(scopedAuditKey)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 6. flushAuditLog
  // -----------------------------------------------------------------------
  describe('flushAuditLog', () => {
    it('delivers buffered entries through the trusted write_audit_event RPC', async () => {
      const ROW = '00000000-0000-4000-8000-0000000000a1';
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 'case_entries',
        rowId: ROW,
        data: { patient_mrn: 'MRN-100' },
      });
      await logAuditEvent({
        userId: 'u1',
        action: 'create',
        table: 'case_entries',
        rowId: ROW,
        data: { patient_dob: '2000-01-01' },
      });

      const count = await flushAuditLog();
      expect(count).toBe(2);

      // The audit_logs INSERT policy only admits trigger writes, so the flush
      // must go through the RPC rather than a direct table insert.
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockRpc).toHaveBeenCalledTimes(2);
      expect(mockRpc.mock.calls[0]![0]).toBe('write_audit_event');
      expect(mockRpc.mock.calls[0]![1]).toEqual({
        p_action: 'read',
        p_resource_type: 'case_entries',
        p_resource_id: ROW,
        p_changes: expect.objectContaining({ data_hash: expect.any(String) }),
        p_tenant_id: 'tenant-1',
      });
      // No PHI in the payload
      expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('MRN-100');
      expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('2000-01-01');

      // Buffer should be cleared after successful flush
      expect(await getAuditLog()).toHaveLength(0);
    });

    it('delivers a PHI-read event through the trusted path', async () => {
      const ROW = '00000000-0000-4000-8000-0000000000b2';
      await logPhiRead({
        userId: 'u1',
        table: 'case_entries',
        rowId: ROW,
        phiFields: { patient_mrn: 'MRN-777', patient_dob: '1977-07-07' },
      });

      expect(await flushAuditLog()).toBe(1);
      expect(mockRpc).toHaveBeenCalledTimes(1);
      const [name, args] = mockRpc.mock.calls[0]!;
      expect(name).toBe('write_audit_event');
      expect(args).toMatchObject({
        p_action: 'read',
        p_resource_type: 'case_entries',
        p_resource_id: ROW,
        p_tenant_id: 'tenant-1',
      });
      const serialized = JSON.stringify(args);
      expect(serialized).not.toContain('MRN-777');
      expect(serialized).not.toContain('1977-07-07');
      expect(serialized).toContain('data_hash');
    });

    it('uses the metadata-only resource type for a row id that is not a uuid', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 'case_entries',
        rowId: 'legacy-row-key',
        data: 'x',
      });

      expect(await flushAuditLog()).toBe(1);
      expect(mockRpc.mock.calls[0]![1]).toMatchObject({
        p_resource_type: 'mobile_buffer',
        p_resource_id: null,
      });
    });

    it('returns 0 when buffer is empty', async () => {
      const count = await flushAuditLog();
      expect(count).toBe(0);
      expect(mockRpc).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('keeps entries on network failure for retry', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data: 'x',
      });

      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'network error' } });

      const count = await flushAuditLog();
      expect(count).toBe(0);

      // Entries should still be in buffer
      const entries = await getAuditLog();
      expect(entries).toHaveLength(1);
      const status = await getAuditDeliveryStatus();
      expect(status.failed).toBe(1);
      expect(status.lastError).toMatch(/network/i);
    });

    it('keeps entries on Supabase error for retry', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'create',
        table: 't',
        rowId: 'r1',
        data: 'y',
      });

      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'relation "audit_logs" does not exist' },
      });

      const count = await flushAuditLog();
      expect(count).toBe(0);

      // Entries preserved for next attempt
      expect(await getAuditLog()).toHaveLength(1);
    });

    it('keeps entries when the RPC throws an exception', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'update',
        table: 't',
        rowId: 'r1',
        data: 'z',
      });

      mockRpc.mockRejectedValueOnce(new Error('connection refused'));

      const count = await flushAuditLog();
      expect(count).toBe(0);
      expect(await getAuditLog()).toHaveLength(1);
    });

    it('keeps an entry logged while the flush is still delivering', async () => {
      // The flush removes what it delivered from the buffer it read when it
      // started. If it writes that captured array back rather than the live one,
      // anything appended during the round trip is discarded -- and this entry
      // is the only copy of a real PHI access, so "discarded" means it is never
      // written to audit_logs at all.
      const ROW = '00000000-0000-4000-8000-0000000000d1';
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 'case_entries',
        rowId: ROW,
        data: { patient_mrn: 'MRN-200' },
      });

      let release!: (result: { data: string; error: null }) => void;
      let reachedRpc!: () => void;
      const inFlight = new Promise<void>((resolve) => { reachedRpc = resolve; });
      mockRpc.mockImplementation(() => new Promise((resolve) => {
        release = resolve;
        reachedRpc();
      }));

      const flush = flushAuditLog();
      await inFlight;

      // The account switches mid-flight, which is what replaces the buffer the
      // flush captured.
      setAccountContext({ userId: 'user-456', tenantId: 'tenant-2', profileId: 'profile-2' });
      await logAuditEvent({
        userId: 'user-456',
        action: 'read',
        table: 'case_entries',
        rowId: ROW,
        data: { patient_mrn: 'MRN-201' },
      });

      release({ data: 'audit-row-1', error: null });
      expect(await flush).toBe(1);

      // The one logged during the flush is still queued for delivery, under the
      // scope it was logged in.
      const otherKey = auditBufferKey();
      const preserved = JSON.parse(storage.get(otherKey)!) as AuditEntry[];
      expect(preserved).toHaveLength(1);
      expect(preserved[0]!.row_id).toBe(ROW);
    });
  });

  // -----------------------------------------------------------------------
  // 7. startAuditFlush / stopAuditFlush (periodic flush)
  // -----------------------------------------------------------------------
  describe('periodic flush', () => {
    it('calls flushAuditLog on interval', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data: 'x',
      });
      startAuditFlush();

      // Advance timer to trigger flush
      await vi.advanceTimersByTimeAsync(30_000);

      expect(mockRpc).toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('skips flush when not authenticated', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });

      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data: 'x',
      });

      startAuditFlush();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(mockRpc).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('stopAuditFlush cancels the timer', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data: 'x',
      });

      startAuditFlush();
      stopAuditFlush();
      mockRpc.mockClear();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('is safe to call startAuditFlush multiple times', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data: 'x',
      });

      startAuditFlush();
      startAuditFlush(); // no-op

      await vi.advanceTimersByTimeAsync(30_000);

      // Only one flush should occur per interval
      expect(mockRpc).toHaveBeenCalledTimes(1);

      stopAuditFlush();
    });
  });

  // -----------------------------------------------------------------------
  // 8. canAccessPHI
  // -----------------------------------------------------------------------
  describe('canAccessPHI', () => {
    it('allows resident role', async () => {
      mockGetRoleFromAuth.mockResolvedValueOnce({
        role: 'resident',
        fullName: 'Dr. Res',
        tenantId: 't1',
        profileId: 'p1',
      });

      const result = await canAccessPHI();
      expect(result.allowed).toBe(true);
      expect(result.role).toBe('resident');
    });

    it('allows supervisor role', async () => {
      mockGetRoleFromAuth.mockResolvedValueOnce({
        role: 'supervisor',
        fullName: 'Dr. Sup',
        tenantId: 't1',
        profileId: 'p2',
      });

      const result = await canAccessPHI();
      expect(result.allowed).toBe(true);
      expect(result.role).toBe('supervisor');
    });

    it('allows director role', async () => {
      mockGetRoleFromAuth.mockResolvedValueOnce({
        role: 'director',
        fullName: 'Dr. Dir',
        tenantId: 't1',
        profileId: 'p3',
      });

      const result = await canAccessPHI();
      expect(result.allowed).toBe(true);
      expect(result.role).toBe('director');
    });

    it('denies institution_admin role', async () => {
      mockGetRoleFromAuth.mockResolvedValueOnce({
        role: 'institution_admin',
        fullName: 'Admin',
        tenantId: 't1',
        profileId: 'p4',
      });

      const result = await canAccessPHI();
      expect(result.allowed).toBe(false);
      expect(result.role).toBe('institution_admin');
    });

    it('denies admin role', async () => {
      mockGetRoleFromAuth.mockResolvedValueOnce({
        role: 'admin',
        fullName: 'SysAdmin',
        tenantId: 't1',
        profileId: 'p5',
      });

      const result = await canAccessPHI();
      expect(result.allowed).toBe(false);
      expect(result.role).toBe('admin');
    });

    it('denies when no user is authenticated (role is null)', async () => {
      mockGetRoleFromAuth.mockResolvedValueOnce({
        role: null,
        fullName: null,
        tenantId: null,
        profileId: null,
      });

      const result = await canAccessPHI();
      expect(result.allowed).toBe(false);
      expect(result.role).toBeNull();
    });

    it('returns denied when getRoleFromAuth throws', async () => {
      mockGetRoleFromAuth.mockRejectedValueOnce(new Error('auth failure'));

      const result = await canAccessPHI();
      expect(result.allowed).toBe(false);
      expect(result.role).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 9. Convenience wrappers
  // -----------------------------------------------------------------------
  describe('logPhiRead / logPhiWrite', () => {
    it('logPhiRead logs a read event with PHI fields', async () => {
      await logPhiRead({
        userId: 'u1',
        table: 'case_entries',
        rowId: 'r1',
        phiFields: { patient_mrn: 'MRN-500', patient_dob: '1988-03-21' },
      });

      const entries = await getAuditLog();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.action).toBe('read');
      expect(entries[0]!.table).toBe('case_entries');
      expect(entries[0]!.row_id).toBe('r1');
      // PHI not stored plaintext
      expect(JSON.stringify(entries[0])).not.toContain('MRN-500');
    });

    it('logPhiWrite logs a create event', async () => {
      await logPhiWrite({
        userId: 'u1',
        action: 'create',
        table: 'case_entries',
        rowId: 'r1',
        phiFields: { field_values: { procedure: 'appendectomy' } },
      });

      const entries = await getAuditLog();
      expect(entries[0]!.action).toBe('create');
    });

    it('logPhiWrite logs an update event', async () => {
      await logPhiWrite({
        userId: 'u1',
        action: 'update',
        table: 'case_entries',
        rowId: 'r1',
        phiFields: { patient_dob: '1990-01-01' },
      });

      const entries = await getAuditLog();
      expect(entries[0]!.action).toBe('update');
    });

    it('logPhiWrite logs a delete event', async () => {
      await logPhiWrite({
        userId: 'u1',
        action: 'delete',
        table: 'evaluation_forms',
        rowId: 'r99',
        phiFields: { patient_context: '65yo male' },
      });

      const entries = await getAuditLog();
      expect(entries[0]!.action).toBe('delete');
      expect(entries[0]!.table).toBe('evaluation_forms');
    });
  });

  // -----------------------------------------------------------------------
  // 10. Hash determinism & one-way property
  // -----------------------------------------------------------------------
  describe('hash determinism', () => {
    it('same data produces same hash', async () => {
      const data = { patient_mrn: 'ABC-123', patient_dob: '1995-07-04' };

      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data,
      });
      await logAuditEvent({
        userId: 'u2',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data,
      });

      const entries = await getAuditLog(2);
      expect(entries[0]!.data_hash).toBe(entries[1]!.data_hash);
      expect(entries[0]!.data_hash).toBe(hashJson(data));
    });

    it('different data produces different hash', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data: { patient_mrn: 'A' },
      });
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data: { patient_mrn: 'B' },
      });

      const entries = await getAuditLog(2);
      expect(entries[0]!.data_hash).not.toBe(entries[1]!.data_hash);
    });
  });

  // -----------------------------------------------------------------------
  // 11. Storage key correctness
  // -----------------------------------------------------------------------
  describe('storage key', () => {
    it('uses the correct AsyncStorage key', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 't',
        rowId: 'r1',
        data: 'x',
      });

      expect(storage.has(scopedAuditKey)).toBe(true);
      const raw = storage.get(scopedAuditKey)!;
      const parsed = JSON.parse(raw) as AuditEntry[];
      expect(parsed).toHaveLength(1);
    });
  });
});
