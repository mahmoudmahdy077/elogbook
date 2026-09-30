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
    userId: 'u1', tenantId: 't1', profileId: 'p1', role: 'supervisor', status: 'active', tenantStatus: 'active',
    policyVersion: 3, dataMode: 'deidentified', aal: 'aal2',
    expiresAt: Date.now() + 3600_000, fetchedAt: Date.now(), ...over,
  };
}

/** A typed stand-in for the Supabase rpc adapter, so the call is inspectable. */
function mockRpc() {
  return vi.fn(
    async (_fn: string, _args: Record<string, unknown>) => ({
      data: { success: true } as { success?: unknown; error?: unknown } | null,
      error: null as { message: string } | null,
    }),
  );
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

  it('submitApproval routes the decision through the AAL2 command with the approver gate', async () => {
    const rpc = mockRpc();
    const ok = await submitApproval({ capability: cap(), entryId: 'e1', action: 'approve', rpc });
    expect(ok).toEqual({ kind: 'confirmed' });
    // decide_case_command, not the retired approve_case: the command resolves
    // one locked approval request with the status change and carries the
    // idempotency key a retried tap needs.
    expect(rpc).toHaveBeenCalledWith(
      'decide_case_command',
      expect.objectContaining({ p_case_id: 'e1', p_decision: 'approve' }),
    );
    const args = rpc.mock.calls[0]?.[1] ?? {};
    expect(args.p_request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const denied = await submitApproval({
      capability: cap({ role: 'resident' }), entryId: 'e1', action: 'approve', rpc,
    });
    expect(denied.kind).toBe('denied');
  });

  it('submitApproval rejects a case through the same command', async () => {
    const rpc = mockRpc();
    await submitApproval({
      capability: cap(), entryId: 'e1', action: 'reject', comment: 'needs rework', rpc,
    });
    expect(rpc).toHaveBeenCalledWith(
      'decide_case_command',
      expect.objectContaining({ p_case_id: 'e1', p_decision: 'reject', p_reason: 'needs rework' }),
    );
  });

  it('never calls a retired approval RPC', async () => {
    const rpc = mockRpc();
    await submitApproval({ capability: cap(), entryId: 'e1', action: 'approve', rpc });
    expect(rpc.mock.calls.length).toBeGreaterThan(0);
    for (const call of rpc.mock.calls) {
      expect(call[0]).not.toBe('approve_case');
      expect(call[0]).not.toBe('reject_case');
    }
  });

  it('rejects stale approval results returned inside a successful RPC envelope', async () => {
    const rpc = vi.fn(async () => ({
      data: { success: false, error: 'Case already reviewed' },
      error: null,
    }));
    const outcome = await submitApproval({ capability: cap(), entryId: 'e1', action: 'approve', rpc });
    expect(outcome.kind).toBe('terminal');
  });

  it('submitEvaluation/submitDutyHours confirm through their writers', async () => {
    const w = vi.fn(async () => undefined);
    expect(await submitEvaluation({ capability: cap({ role: 'resident' }), write: w })).toEqual({ kind: 'confirmed' });
    expect(await submitDutyHours({ capability: cap({ role: 'resident' }), write: w })).toEqual({ kind: 'confirmed' });
    expect(w).toHaveBeenCalledTimes(2);
  });
});
