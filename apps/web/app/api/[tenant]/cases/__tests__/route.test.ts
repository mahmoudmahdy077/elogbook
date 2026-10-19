import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => {
  class MockNextResponse {
    readonly status: number;
    private readonly body: unknown;
    readonly headers: Headers;
    constructor(body: unknown, init?: ResponseInit) {
      this.status = init?.status ?? 200;
      this.body = body;
      this.headers = new Headers(init?.headers);
    }
    async json() { return this.body; }
    static json(body: unknown, init?: ResponseInit) { return new MockNextResponse(body, init); }
  }
  return { NextResponse: MockNextResponse };
});

const mockValidateOrigin = vi.fn().mockReturnValue(null);
vi.mock('@/lib/csrf', () => ({
  validateOrigin: () => mockValidateOrigin(),
  defaultTrustedOrigins: () => ['https://app.elogbook.dev'],
}));

const mockCheckRateLimit = vi.fn().mockReturnValue({ allowed: true, retryAfter: 0 });
vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: (key: string) => mockCheckRateLimit(key),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));

const { mockFrom, mockRpc, mockSupabase, mockGetSecurityContext } = vi.hoisted(() => {
  const from = vi.fn();
  const rpc = vi.fn();
  return {
    mockFrom: from,
    mockRpc: rpc,
    mockSupabase: { from, rpc, auth: { getUser: vi.fn() } },
    mockGetSecurityContext: vi.fn(),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => Promise.resolve(mockSupabase),
}));
vi.mock('@/lib/supabase/security-context', () => ({
  getSecurityContext: mockGetSecurityContext,
}));

import { POST } from '../route';

const params = Promise.resolve({ tenant: 'demo' });
const validPayload = {
  request_id: 'draft-1',
  template_id: '40000000-0000-4000-8000-000000003231',
  case_date: '2026-09-23',
  field_values: { procedure_name: 'Appendectomy', witnessed: true },
  accreditation_mappings: [],
  is_deidentified: true,
  patient_age_years: 30,
};

function request(body: unknown): Request {
  return new Request('https://app.elogbook.dev/api/demo/cases', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://app.elogbook.dev',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/[tenant]/cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateOrigin.mockReturnValue(null);
    mockCheckRateLimit.mockReturnValue({ allowed: true, retryAfter: 0 });
    mockRpc.mockResolvedValue({
      data: { success: true, case_id: 'case-1', status: 'draft' },
      error: null,
    });
    mockGetSecurityContext.mockResolvedValue({
      ok: true,
      context: {
        user: { id: 'u-1' },
        profile: { id: 'p-1', tenant_id: 't-1', role: 'resident', status: 'active', full_name: 'Resident' },
        tenant: { id: 't-1', slug: 'demo', status: 'active' },
        aal: 'aal1',
      },
    });
  });

  it('creates a draft through save_case_draft_command', async () => {
    const res = await POST(request(validPayload), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, case_id: 'case-1', status: 'draft' });
    expect(mockRpc).toHaveBeenCalledWith('save_case_draft_command', {
      p_request_id: 'draft-1',
      p_payload: {
        template_id: validPayload.template_id,
        case_date: validPayload.case_date,
        field_values: validPayload.field_values,
        accreditation_mappings: [],
        is_deidentified: true,
        patient_age_years: 30,
      },
    });
  });

  it('never inserts case_entries directly', async () => {
    await POST(request(validPayload), { params });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('rejects a missing request_id', async () => {
    const { request_id: _requestId, ...withoutId } = validPayload;
    const res = await POST(request(withoutId), { params });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects identifiable or unknown fields before the RPC', async () => {
    const res = await POST(request({ ...validPayload, patient_mrn: 'MRN-1' }), { params });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps required template fields to 422', async () => {
    mockRpc.mockResolvedValue({
      data: {
        success: false,
        error: 'required fields are missing',
        code: 'required_field_missing',
        missing_fields: ['supervision_level'],
      },
      error: null,
    });

    const res = await POST(request(validPayload), { params });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'required_field_missing',
      missing_fields: ['supervision_level'],
    });
  });

  it('maps policy denial to 403 and idempotency reuse to 409', async () => {
    mockRpc.mockResolvedValueOnce({ data: { success: false, code: 'policy_denied' }, error: null });
    expect((await POST(request(validPayload), { params })).status).toBe(403);

    mockRpc.mockResolvedValueOnce({ data: { success: false, code: 'idempotency_conflict' }, error: null });
    expect((await POST(request(validPayload), { params })).status).toBe(409);
  });

  it('rejects a tenant slug mismatch before the RPC', async () => {
    const res = await POST(request(validPayload), { params: Promise.resolve({ tenant: 'other' }) });
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
