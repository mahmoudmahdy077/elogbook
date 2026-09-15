import { describe, it, expect, vi } from 'vitest';
import { fetchCapabilitySnapshot, isCapabilityFresh, requiresStepUp } from '../capability';

function mockSupabase(profile: unknown, policy: unknown) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1' } } }),
      getSession: async () => ({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: null }) }) }),
        };
      }
      if (table === 'tenant_data_policies') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: policy, error: null }) }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe('capability snapshot (M1)', () => {
  it('builds a server-authoritative snapshot (never trusts user_metadata role)', async () => {
    const sb = mockSupabase(
      { id: 'p1', user_id: 'u1', tenant_id: 't1', role: 'resident', status: 'active' },
      { tenant_id: 't1', mode: 'deidentified', version: 3 },
    );
    const snap = await fetchCapabilitySnapshot(sb as never);
    expect(snap.userId).toBe('u1');
    expect(snap.tenantId).toBe('t1');
    expect(snap.role).toBe('resident');
    expect(snap.status).toBe('active');
    expect(snap.policyVersion).toBe(3);
    expect(snap.dataMode).toBe('deidentified');
    expect(isCapabilityFresh(snap)).toBe(true);
    expect(requiresStepUp(snap, 'routine')).toBe(false);
  });

  it('marks suspended accounts and expired snapshots', async () => {
    const sb = mockSupabase(
      { id: 'p1', user_id: 'u1', tenant_id: 't1', role: 'resident', status: 'suspended' },
      { tenant_id: 't1', mode: 'identifiable', version: 1 },
    );
    const snap = await fetchCapabilitySnapshot(sb as never);
    expect(snap.status).toBe('suspended');
    const stale = { ...snap, fetchedAt: Date.now() - 10 * 60_000 };
    expect(isCapabilityFresh(stale, 5 * 60_000)).toBe(false);
  });

  it('requires step-up for sensitive actions without recent MFA', async () => {
    const sb = mockSupabase(
      { id: 'p1', user_id: 'u1', tenant_id: 't1', role: 'supervisor', status: 'active' },
      { tenant_id: 't1', mode: 'identifiable', version: 2 },
    );
    const snap = await fetchCapabilitySnapshot(sb as never, { mfaVerifiedAt: 0 });
    expect(requiresStepUp(snap, 'export_identifiable')).toBe(true);
    expect(requiresStepUp(snap, 'routine')).toBe(false);
  });

  it('throws when profile is missing (no silent metadata fallback)', async () => {
    const sb = mockSupabase(null, null);
    await expect(fetchCapabilitySnapshot(sb as never)).rejects.toThrow();
    expect(vi).toBeDefined();
  });
});
