import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock next/server
// ---------------------------------------------------------------------------
vi.mock('next/server', () => {
  class MockNextResponse {
    readonly status: number;
    private readonly _body: unknown;
    readonly headers: Headers;
    constructor(body: unknown, init?: ResponseInit) {
      this.status = init?.status ?? 200;
      this._body = body;
      this.headers = new Headers(init?.headers);
    }
    async json() { return this._body; }
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

// ---------------------------------------------------------------------------
// Mock rate limiter
// ---------------------------------------------------------------------------
vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
  rateLimitResponse: vi.fn((retryAfter: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (NextResponse as any).json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } })),
}));

import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const USER_ID = 'user-1-uuid';
const PROFILE_ID = 'profile-1-uuid';
const TENANT_ID = 'tenant-1-uuid';
const CASE_ID = 'case-1-uuid';
const CASE_ID_B = 'case-2-uuid';

type Row = Record<string, unknown>;

let profilesRow: Row | null = {
  id: PROFILE_ID,
  tenant_id: TENANT_ID,
  role: 'resident',
  tenants: { slug: 'tenant-a' },
};

let caseRows: Row[] = [
  {
    id: CASE_ID,
    tenant_id: TENANT_ID,
    resident_id: PROFILE_ID,
    is_deidentified: false,
    patient_mrn: 'MRN-998877',
    patient_dob: '1990-01-02',
  },
];

let auditInserts: Row[] = [];
let auditInsertError: { message: string } | null = null;
let unauthenticated = false;

// ---------------------------------------------------------------------------
// Mock server supabase (RLS-bound client)
// ---------------------------------------------------------------------------
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => mockServerSupabase()),
}));

function mockServerSupabase() {
  return {
    auth: {
      getUser: vi.fn(async () =>
        unauthenticated
          ? { data: { user: null }, error: new Error('no session') }
          : { data: { user: { id: USER_ID } }, error: null }
      ),
    },
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({ data: profilesRow, error: profilesRow ? null : new Error('no profile') })),
            })),
          })),
        };
      }
      if (table === 'case_entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((col: string, val: unknown) => ({
              single: vi.fn(async () => {
                const row = caseRows.find((r) => (col === 'id' ? r.id === val : false)) ?? null;
                return { data: row, error: row ? null : new Error('not found') };
              }),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

// ---------------------------------------------------------------------------
// Mock service-role client (audit writer)
// ---------------------------------------------------------------------------
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table !== 'audit_logs') throw new Error(`unexpected table: ${table}`);
      return {
        insert: vi.fn(async (row: Row) => {
          if (auditInsertError) return { error: auditInsertError };
          auditInserts.push(row);
          return { error: null };
        }),
      };
    }),
  })),
}));

import { POST } from '../route';

function call(tenant: string, id: string) {
  return POST(new Request('http://localhost/x', { method: 'POST' }), {
    params: Promise.resolve({ tenant, id }),
  });
}

describe('POST /api/[tenant]/cases/[id]/phi-reveal', () => {
  beforeEach(() => {
    profilesRow = {
      id: PROFILE_ID,
      tenant_id: TENANT_ID,
      role: 'resident',
      tenants: { slug: 'tenant-a' },
    };
    caseRows = [
      {
        id: CASE_ID,
        tenant_id: TENANT_ID,
        resident_id: PROFILE_ID,
        is_deidentified: false,
        patient_mrn: 'MRN-998877',
        patient_dob: '1990-01-02',
      },
    ];
    auditInserts = [];
    auditInsertError = null;
    unauthenticated = false;
  });

  it('returns masked-null data and writes a phi_view audit row for a resident viewing their own case', async () => {
    const res = await call('tenant-a', CASE_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ mrn: 'MRN-998877', dob: '1990-01-02', revealed: true });
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]).toMatchObject({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      action: 'phi_view',
      resource_type: 'case_entry',
      resource_id: CASE_ID,
    });
  });

  it('returns 404 when the case does not exist (RLS-scoped read)', async () => {
    const res = await call('tenant-a', 'missing-uuid');
    expect(res.status).toBe(404);
    expect(auditInserts).toHaveLength(0);
  });

  it('returns 404 when a resident probes another resident\u2019s case', async () => {
    caseRows = [
      { id: CASE_ID_B, tenant_id: TENANT_ID, resident_id: 'other-profile-uuid', is_deidentified: false, patient_mrn: 'X', patient_dob: '1991-02-03' },
    ];
    const res = await call('tenant-a', CASE_ID_B);
    expect(res.status).toBe(404);
    expect(auditInserts).toHaveLength(0);
  });

  it('returns 403 on tenant slug mismatch', async () => {
    const res = await call('tenant-b', CASE_ID);
    expect(res.status).toBe(403);
    expect(auditInserts).toHaveLength(0);
  });

  it('returns nulls without an audit row for de-identified cases', async () => {
    caseRows = [
      { id: CASE_ID, tenant_id: TENANT_ID, resident_id: PROFILE_ID, is_deidentified: true, patient_mrn: null, patient_dob: null },
    ];
    const res = await call('tenant-a', CASE_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mrn: null, dob: null, revealed: false });
    expect(auditInserts).toHaveLength(0);
  });

  it('returns 500 without leaking PHI when the audit write fails', async () => {
    auditInsertError = { message: 'db down' };
    const res = await call('tenant-a', CASE_ID);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.mrn).toBeUndefined();
    expect(body.dob).toBeUndefined();
  });

  it('returns 401 when not authenticated', async () => {
    unauthenticated = true;
    const res = await call('tenant-a', CASE_ID);
    expect(res.status).toBe(401);
    expect(auditInserts).toHaveLength(0);
  });
});
