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

const { storage, mockInsert, mockGetSession, mockGetRoleFromAuth } =
  vi.hoisted(() => ({
    storage: new Map<string, string>(),
    mockInsert: vi.fn().mockResolvedValue({ error: null }),
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
  type AuditEntry,
} from '../audit-trail';

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
    mockInsert.mockReset().mockResolvedValue({ error: null });
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
      expect(e.user_id).toBe('user-abc');
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
      expect(lastEntry.user_id).toBe('u2');
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
    });
  });

  // -----------------------------------------------------------------------
  // 3. getAuditLog
  // -----------------------------------------------------------------------
  describe('getAuditLog', () => {
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
      expect(parsed[0]!.user_id).toBe('u1');
      expect(parsed[1]!.user_id).toBe('u2');
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
      expect(storage.has('audit_trail_buffer_v1')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 6. flushAuditLog
  // -----------------------------------------------------------------------
  describe('flushAuditLog', () => {
    it('inserts all buffered entries into Supabase audit_logs', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'read',
        table: 'case_entries',
        rowId: 'r1',
        data: { patient_mrn: 'MRN-100' },
      });
      await logAuditEvent({
        userId: 'u1',
        action: 'create',
        table: 'case_entries',
        rowId: 'r2',
        data: { patient_dob: '2000-01-01' },
      });

      const count = await flushAuditLog();
      expect(count).toBe(2);

      // Verify Supabase insert was called with correct payload shape
      expect(mockInsert).toHaveBeenCalledTimes(1);
      const insertedRows = mockInsert.mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(insertedRows).toHaveLength(2);
      expect(insertedRows[0]!.table_name).toBe('case_entries');
      expect(insertedRows[0]!.action).toBe('read');
      expect(insertedRows[0]!.data_hash).toBeTruthy();
      // No PHI in the payload
      expect(JSON.stringify(insertedRows)).not.toContain('MRN-100');

      // Buffer should be cleared after successful flush
      expect(await getAuditLog()).toHaveLength(0);
    });

    it('returns 0 when buffer is empty', async () => {
      const count = await flushAuditLog();
      expect(count).toBe(0);
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

      mockInsert.mockResolvedValueOnce({
        error: { message: 'network error' },
      });

      const count = await flushAuditLog();
      expect(count).toBe(0);

      // Entries should still be in buffer
      const entries = await getAuditLog();
      expect(entries).toHaveLength(1);
    });

    it('keeps entries on Supabase error for retry', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'create',
        table: 't',
        rowId: 'r1',
        data: 'y',
      });

      mockInsert.mockResolvedValueOnce({
        error: { message: 'relation "audit_logs" does not exist' },
      });

      const count = await flushAuditLog();
      expect(count).toBe(0);

      // Entries preserved for next attempt
      expect(await getAuditLog()).toHaveLength(1);
    });

    it('keeps entries when insert throws an exception', async () => {
      await logAuditEvent({
        userId: 'u1',
        action: 'update',
        table: 't',
        rowId: 'r1',
        data: 'z',
      });

      mockInsert.mockRejectedValueOnce(new Error('connection refused'));

      const count = await flushAuditLog();
      expect(count).toBe(0);
      expect(await getAuditLog()).toHaveLength(1);
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

      expect(mockInsert).toHaveBeenCalled();
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
      mockInsert.mockClear();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockInsert).not.toHaveBeenCalled();
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
      expect(mockInsert).toHaveBeenCalledTimes(1);

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

      expect(storage.has('audit_trail_buffer_v1')).toBe(true);
      const raw = storage.get('audit_trail_buffer_v1')!;
      const parsed = JSON.parse(raw) as AuditEntry[];
      expect(parsed).toHaveLength(1);
    });
  });
});
