import { describe, it, expect } from 'vitest';
import { canPerform, type SensitiveAction } from '../authorization';
import type { CapabilitySnapshot } from '../capability';

function snap(over: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    userId: 'u1',
    tenantId: 't1',
    profileId: 'p1',
    role: 'resident',
    status: 'active',
    policyVersion: 3,
    dataMode: 'deidentified',
    mfaVerifiedAt: Date.now(),
    expiresAt: Date.now() + 3600_000,
    fetchedAt: Date.now(),
    ...over,
  };
}

describe('authorization adapters (M1.4)', () => {
  it('allows resident case create/edit with a fresh active capability', () => {
    expect(canPerform(snap(), 'case:create').ok).toBe(true);
    expect(canPerform(snap(), 'case:edit').ok).toBe(true);
  });

  it('denies everything when suspended', () => {
    const s = snap({ status: 'suspended' });
    for (const a of ['case:create', 'case:approve', 'export:identifiable', 'admin:tenant'] as SensitiveAction[]) {
      expect(canPerform(s, a).ok).toBe(false);
    }
  });

  it('denies sensitive actions on stale snapshots', () => {
    const s = snap({ fetchedAt: Date.now() - 30 * 60_000 });
    expect(canPerform(s, 'case:approve').ok).toBe(false);
    expect(canPerform(s, 'case:create').ok).toBe(true);
  });

  it('requires identifiable mode + fresh step-up for identifiable export', () => {
    expect(canPerform(snap(), 'export:identifiable').ok).toBe(false);
    const s = snap({ dataMode: 'identifiable' });
    expect(canPerform(s, 'export:identifiable').ok).toBe(true);
    expect(canPerform(snap({ dataMode: 'identifiable', mfaVerifiedAt: 0 }), 'export:identifiable').ok).toBe(false);
  });

  it('restricts approval to supervisor roles (server still authoritative)', () => {
    expect(canPerform(snap({ role: 'supervisor' }), 'case:approve').ok).toBe(true);
    expect(canPerform(snap({ role: 'resident' }), 'case:approve').ok).toBe(false);
  });
});
