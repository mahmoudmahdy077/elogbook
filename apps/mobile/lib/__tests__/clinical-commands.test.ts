import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
vi.mock('../supabase', () => ({ supabase: {} }));

import { setAccountContext, clearAccountContext } from '../account-context';
import { readDurableQueue } from '../durable-queue';
import { createCaseOperationSubmit, newCaseCommandRequestId } from '../clinical-commands';
import { editCaseAndResubmit, createCaseDraftAndSubmit } from '../clinical-commands';
import type { CapabilitySnapshot } from '../capability';

function cap(over: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    userId: 'u1', tenantId: 't1', profileId: 'p1', role: 'resident', status: 'active', tenantStatus: 'active',
    policyVersion: 3, dataMode: 'deidentified', aal: 'aal2',
    expiresAt: Date.now() + 3600_000, fetchedAt: Date.now(), ...over,
  };
}

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function fakeSupabase(responses: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }>) {
  const calls: RpcCall[] = [];
  const supabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const responder = responses[fn];
      if (!responder) throw new Error(`unexpected rpc ${fn}`);
      return responder(args);
    },
  };
  return { supabase, calls };
}

const CAP = cap();
const STALE = cap({ fetchedAt: Date.now() - 30 * 60_000 });

const CONTENT = {
  templateId: 'tmpl-1',
  patientMrn: '',
  patientDob: '',
  patientAge: '34',
  caseDate: '2026-09-30',
  fieldValues: { procedure: 'appendectomy' },
  isDeidentified: true,
  patientHash: null,
};

function operationOk(args: Record<string, unknown>) {
  return {
    data: { success: true, id: 'case-server-1', op_id: args.p_op_id },
    error: null,
  };
}

/** The screen's submit_case_command caller, so every test uses the real wire names. */
function commandVia(client: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }) {
  return async (args: { caseId: string; requestId: string; expectedStatus: string }) => {
    const res = await client.rpc('submit_case_command', {
      p_case_id: args.caseId,
      p_request_id: args.requestId,
      p_expected_status: args.expectedStatus,
    });
    return { data: res.data as never, error: res.error };
  };
}

beforeEach(async () => {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.clear();
  clearAccountContext();
  setAccountContext({ userId: 'u1', tenantId: 't1', profileId: 'p1' });
});

describe('clinical-commands — the mobile command adapter', () => {
  it('mints a distinct request id per attempt and never reuses one', () => {
    const ids = new Set([newCaseCommandRequestId(), newCaseCommandRequestId(), newCaseCommandRequestId()]);
    expect(ids.size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('edits a draft through the operation RPC and then submits the command', async () => {
    const { supabase, calls } = fakeSupabase({
      submit_case_operation: operationOk,
      submit_case_command: (args) => ({
        data: { success: true, case_id: args.p_case_id, status: 'pending' },
        error: null,
      }),
    });

    const out = await editCaseAndResubmit(
      {
        capability: CAP,
        submit: createCaseOperationSubmit(supabase as never, CAP),
        submitCommand: commandVia(supabase),
      },
      { caseId: 'case-1', status: 'draft', content: CONTENT, requestId: 'req-1' },
    );

    expect(out).toEqual({ kind: 'submitted', caseId: 'case-1' });
    expect(calls.map((c) => c.fn)).toEqual(['submit_case_operation', 'submit_case_command']);
  });

  it('never writes a pending status: the edit carries draft and only content columns', async () => {
    const { supabase, calls } = fakeSupabase({
      submit_case_operation: operationOk,
      submit_case_command: () => ({ data: { success: true, status: 'pending' }, error: null }),
    });

    await editCaseAndResubmit(
      {
        capability: CAP,
        submit: createCaseOperationSubmit(supabase as never, CAP),
        submitCommand: commandVia(supabase),
      },
      { caseId: 'case-1', status: 'draft', content: CONTENT, requestId: 'req-1' },
    );

    const update = calls.find((c) => c.fn === 'submit_case_operation')!;
    expect(update.args.p_action).toBe('update');
    expect(update.args.p_row_id).toBe('case-1');
    const payload = update.args.p_payload as Record<string, unknown>;
    expect(payload.status).toBe('draft');
    expect(JSON.stringify(payload)).not.toMatch(/pending|approved/);
    // Identity and server-managed columns are never client-supplied.
    expect(Object.keys(payload).sort()).toEqual([
      'case_date',
      'field_values',
      'is_deidentified',
      'patient_age_years',
      'patient_dob',
      'patient_mrn',
      'status',
      'template_id',
    ]);
    expect(payload).not.toHaveProperty('tenant_id');
    expect(payload).not.toHaveProperty('resident_id');
    expect(payload).not.toHaveProperty('patient_hash');
    expect(payload).not.toHaveProperty('client_operation_id');
  });

  it('carries a stable client operation id so the online write and the queue share it', async () => {
    const { supabase, calls } = fakeSupabase({
      submit_case_operation: operationOk,
      submit_case_command: () => ({ data: { success: true }, error: null }),
    });

    await editCaseAndResubmit(
      {
        capability: CAP,
        submit: createCaseOperationSubmit(supabase as never, CAP),
        submitCommand: commandVia(supabase),
      },
      { caseId: 'case-1', status: 'draft', content: CONTENT, requestId: 'req-1' },
    );

    expect(typeof calls[0].args.p_op_id).toBe('string');
    expect(String(calls[0].args.p_op_id).length).toBeGreaterThan(8);
  });

  it('returns a rejected case to draft before resubmitting it', async () => {
    const { supabase, calls } = fakeSupabase({
      submit_case_operation: operationOk,
      submit_case_command: () => ({ data: { success: true, status: 'pending' }, error: null }),
    });

    const out = await editCaseAndResubmit(
      {
        capability: CAP,
        submit: createCaseOperationSubmit(supabase as never, CAP),
        submitCommand: commandVia(supabase),
      },
      { caseId: 'case-7', status: 'rejected', content: CONTENT, requestId: 'req-2' },
    );

    expect(out).toEqual({ kind: 'submitted', caseId: 'case-7' });
    const update = calls.find((c) => c.fn === 'submit_case_operation')!;
    // R2/R3: rejected -> draft is the documented resident hop, and the command
    // owns draft -> pending.
    expect((update.args.p_payload as Record<string, unknown>).status).toBe('draft');
    expect(calls.at(-1)!.args.p_expected_status).toBe('draft');
  });

  it('replays the stored decision when the same request id is retried', async () => {
    const seen: string[] = [];
    const { supabase } = fakeSupabase({
      submit_case_operation: operationOk,
      submit_case_command: (args) => {
        seen.push(String(args.p_request_id));
        return { data: { success: true, status: 'pending' }, error: null };
      },
    });

    const deps = {
      capability: CAP,
      submit: createCaseOperationSubmit(supabase as never, CAP),
      submitCommand: commandVia(supabase),
    };
    const input = { caseId: 'case-1', status: 'draft' as const, content: CONTENT, requestId: 'req-stable' };

    const first = await editCaseAndResubmit(deps, input);
    const second = await editCaseAndResubmit(deps, input);

    expect(first.kind).toBe('submitted');
    expect(second.kind).toBe('submitted');
    expect(seen).toEqual(['req-stable', 'req-stable']);
  });

  it('reports a saved draft with the code when the tenant has no eligible reviewer', async () => {
    const { supabase } = fakeSupabase({
      submit_case_operation: operationOk,
      submit_case_command: () => ({
        data: { success: false, error: 'no_eligible_reviewer', code: 'no_eligible_reviewer' },
        error: null,
      }),
    });

    const out = await editCaseAndResubmit(
      {
        capability: CAP,
        submit: createCaseOperationSubmit(supabase as never, CAP),
        submitCommand: commandVia(supabase),
      },
      { caseId: 'case-1', status: 'draft', content: CONTENT, requestId: 'req-3' },
    );

    expect(out).toEqual({ kind: 'draft-saved', caseId: 'case-1', code: 'no_eligible_reviewer' });
  });

  it('reports a state conflict from the command instead of claiming a submission', async () => {
    const { supabase } = fakeSupabase({
      submit_case_operation: operationOk,
      submit_case_command: () => ({
        data: { success: false, error: 'state_conflict', code: 'state_conflict' },
        error: null,
      }),
    });

    const out = await editCaseAndResubmit(
      {
        capability: CAP,
        submit: createCaseOperationSubmit(supabase as never, CAP),
        submitCommand: commandVia(supabase),
      },
      { caseId: 'case-1', status: 'draft', content: CONTENT, requestId: 'req-4' },
    );

    expect(out).toEqual({ kind: 'draft-saved', caseId: 'case-1', code: 'state_conflict' });
  });

  it('never reaches the submit command when the content edit is refused', async () => {
    const { supabase, calls } = fakeSupabase({
      submit_case_operation: () => ({
        data: { success: false, error: 'policy: forbidden', code: 'forbidden' },
        error: null,
      }),
    });

    const out = await editCaseAndResubmit(
      {
        capability: CAP,
        submit: createCaseOperationSubmit(supabase as never, CAP),
        submitCommand: async () => ({ data: { success: true }, error: null }),
      },
      { caseId: 'case-1', status: 'draft', content: CONTENT, requestId: 'req-5' },
    );

    expect(out.kind).toBe('rejected');
    expect(calls.filter((c) => c.fn === 'submit_case_command')).toHaveLength(0);
    expect(await readDurableQueue()).toHaveLength(0);
  });

  it('says saved-on-device, never submitted, when the edit is queued offline', async () => {
    const { supabase, calls } = fakeSupabase({
      submit_case_operation: operationOk,
      submit_case_command: () => ({ data: { success: true }, error: null }),
    });
    const out = await editCaseAndResubmit(
      {
        capability: STALE,
        submit: createCaseOperationSubmit(supabase as never, STALE),
        submitCommand: async () => ({ data: { success: true }, error: null }),
      },
      { caseId: 'case-1', status: 'draft', content: CONTENT, requestId: 'req-6' },
    );

    expect(out.kind).toBe('queued-locally');
    expect(calls).toHaveLength(0);
    expect(await readDurableQueue()).toHaveLength(1);
  });

  it('fails closed with no verified session and writes nothing', async () => {
    const { supabase, calls } = fakeSupabase({ submit_case_operation: operationOk });

    const out = await editCaseAndResubmit(
      {
        capability: null,
        submit: createCaseOperationSubmit(supabase as never, CAP),
        submitCommand: async () => ({ data: { success: true }, error: null }),
      },
      { caseId: 'case-1', status: 'draft', content: CONTENT, requestId: 'req-7' },
    );

    expect(out.kind).toBe('rejected');
    expect(calls).toHaveLength(0);
  });

  it('creates a new case as a draft and then submits it', async () => {
    const { supabase, calls } = fakeSupabase({
      submit_case_operation: operationOk,
      submit_case_command: (args) => ({ data: { success: true, case_id: args.p_case_id }, error: null }),
    });

    const out = await createCaseDraftAndSubmit(
      {
        capability: CAP,
        submit: createCaseOperationSubmit(supabase as never, CAP),
        submitCommand: commandVia(supabase),
      },
      { content: CONTENT, requestId: 'req-new' },
    );

    expect(out).toEqual({ kind: 'submitted', caseId: 'case-server-1' });
    const insert = calls.find((c) => c.fn === 'submit_case_operation')!;
    expect(insert.args.p_action).toBe('insert');
    expect(insert.args.p_row_id).toBeNull();
    expect((insert.args.p_payload as Record<string, unknown>).status).toBe('draft');
    expect(JSON.stringify(insert.args.p_payload)).not.toMatch(/pending|approved/);
    expect(calls.at(-1)!.args.p_expected_status).toBe('draft');
  });

  it('never claims a new case was submitted when the tenant has no reviewer', async () => {
    const { supabase } = fakeSupabase({
      submit_case_operation: operationOk,
      submit_case_command: () => ({
        data: { success: false, error: 'no_eligible_reviewer', code: 'no_eligible_reviewer' },
        error: null,
      }),
    });

    const out = await createCaseDraftAndSubmit(
      {
        capability: CAP,
        submit: createCaseOperationSubmit(supabase as never, CAP),
        submitCommand: commandVia(supabase),
      },
      { content: CONTENT, requestId: 'req-new-2' },
    );

    expect(out).toEqual({ kind: 'draft-saved', caseId: 'case-server-1', code: 'no_eligible_reviewer' });
  });

  it('rejects a new case whose draft could not be created', async () => {
    const { supabase } = fakeSupabase({
      submit_case_operation: () => ({ data: { success: false, error: 'policy: forbidden' }, error: null }),
    });

    const out = await createCaseDraftAndSubmit(
      {
        capability: CAP,
        submit: createCaseOperationSubmit(supabase as never, CAP),
        submitCommand: async () => ({ data: { success: true }, error: null }),
      },
      { content: CONTENT, requestId: 'req-new-3' },
    );

    expect(out.kind).toBe('rejected');
  });
});

describe('clinical-commands — the log-case screen', () => {
  const screen = readFileSync(resolve(process.cwd(), 'app/(tabs)/log-case.tsx'), 'utf8');

  it('never names a clinical status other than draft', () => {
    // `pending` is submit_case_command's transition and `approved` is
    // decide_case_command's. A screen that writes either is reaching past the
    // command boundary, and the resident content-edit policy refuses it.
    expect(screen).not.toMatch(/status:\s*'pending'/);
    expect(screen).not.toMatch(/status:\s*'approved'/);
    expect(screen).not.toContain("'pending'");
  });

  it('has no direct case_entries write: the adapter owns both paths', () => {
    expect(screen).not.toMatch(/from\('case_entries'\)\.(insert|update|upsert|delete)/);
    expect(screen).toContain('editCaseAndResubmit');
    expect(screen).toContain('createCaseDraftAndSubmit');
  });

  it('submits through the command with an idempotency request id', () => {
    expect(screen).toContain('submit_case_command');
    expect(screen).toContain('p_request_id');
    expect(screen).toContain('p_expected_status');
    expect(screen).toContain('newCaseCommandRequestId');
  });

  it('refuses to edit a case that is not draft or rejected', () => {
    expect(screen).toMatch(/data\.status !== 'draft' && data\.status !== 'rejected'/);
  });
});
