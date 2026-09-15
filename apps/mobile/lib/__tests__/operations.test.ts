import { describe, it, expect, vi } from 'vitest';

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
import { runGuardedMutation, submitApproval, submitEvaluation, submitDutyHours } from '../operations';
import type { CapabilitySnapshot } from '../capability';

function cap(over: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    userId: 'u1', tenantId: 't1', profileId: 'p1', role: 'supervisor', status: 'active',
    policyVersion: 3, dataMode: 'deidentified', mfaVerifiedAt: Date.now(),
    expiresAt: Date.now() + 3600_000, fetchedAt: Date.now(), ...over,
  };
}

describe('guarded operations (N2 typed adapters)', () => {
  it('confirms on success and never leaks raw errors to UI', async () => {
    const out = await runGuardedMutation({
      capability: cap(), action: 'case:approve', write: async () => undefined,
    });
    expect(out).toEqual({ kind: 'confirmed' });
  });

  it('denies without calling the server when the gate fails', async () => {
    const write = vi.fn();
    const out = await runGuardedMutation({
      capability: cap({ status: 'suspended' }), action: 'case:approve', write,
    });
    expect(out.kind).toBe('denied');
    expect(write).not.toHaveBeenCalled();
  });

  it('maps transport failures to transient retry (stable copy key)', async () => {
    const out = await runGuardedMutation({
      capability: cap(), action: 'case:approve',
      write: async () => { throw new Error('fetch failed'); },
    });
    expect(out).toEqual({ kind: 'transient' });
  });

  it('maps server refusals to terminal without raw text', async () => {
    const out = await runGuardedMutation({
      capability: cap(), action: 'case:approve',
      write: async () => { throw new Error('RLS policy violation on secret table xyz'); },
    });
    expect(out.kind).toBe('terminal');
    if (out.kind === 'terminal') expect(out.copy).not.toContain('xyz');
  });

  it('submitApproval routes approve/reject RPCs with the approver gate', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const ok = await submitApproval({ capability: cap(), entryId: 'e1', action: 'approve', rpc });
    expect(ok).toEqual({ kind: 'confirmed' });
    expect(rpc).toHaveBeenCalledWith('approve_case', expect.objectContaining({ p_entry_id: 'e1' }));
    const denied = await submitApproval({
      capability: cap({ role: 'resident' }), entryId: 'e1', action: 'approve', rpc,
    });
    expect(denied.kind).toBe('denied');
  });

  it('submitEvaluation/submitDutyHours confirm through their writers', async () => {
    const w = vi.fn(async () => undefined);
    expect(await submitEvaluation({ capability: cap({ role: 'resident' }), write: w })).toEqual({ kind: 'confirmed' });
    expect(await submitDutyHours({ capability: cap({ role: 'resident' }), write: w })).toEqual({ kind: 'confirmed' });
    expect(w).toHaveBeenCalledTimes(2);
  });
});
