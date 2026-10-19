import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    async text() { return typeof this._body === 'string' ? this._body : JSON.stringify(this._body); }
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: () => ({ allowed: true, retryAfter: 0 }),
  rateLimitResponse: vi.fn(),
}));
vi.mock('@/lib/client-ip', () => ({ getClientIp: () => '127.0.0.1' }));

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockSupabase = { from: mockFrom, rpc: mockRpc };
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => Promise.resolve(mockSupabase) }));
vi.mock('@/lib/supabase/security-context', () => ({ getSecurityContext: vi.fn() }));

const { mockLoggerError } = vi.hoisted(() => ({ mockLoggerError: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => mockLoggerError(...a), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
import { getSecurityContext } from '@/lib/supabase/security-context';
import { GET as dutyHours } from '../duty-hours.csv/route';
import { GET as evaluations } from '../evaluations.csv/route';
import { GET as specialty } from '../specialty.csv/route';
import { GET as status } from '../status.csv/route';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const params = Promise.resolve({ tenant: 'demo' });

type RouteHandler = (request: Request, ctx: { params: Promise<{ tenant: string }> }) => Promise<Response>;

const ROUTES = [
  { name: 'duty-hours.csv', handler: dutyHours as unknown as RouteHandler, table: 'duty_periods', action: 'report_duty_hours' },
  { name: 'evaluations.csv', handler: evaluations as unknown as RouteHandler, table: 'faculty_evaluations', action: 'report_evaluations' },
  { name: 'specialty.csv', handler: specialty as unknown as RouteHandler, table: 'case_entries', action: 'report_specialty' },
  { name: 'status.csv', handler: status as unknown as RouteHandler, table: 'case_entries', action: 'report_status' },
] as const;

function context(role = 'director') {
  return {
    ok: true as const,
    context: {
      user: { id: 'u-1' },
      profile: { id: '33333333-3333-4333-8333-333333333333', tenant_id: TENANT_ID, role, status: 'active' },
      tenant: { id: TENANT_ID, slug: 'demo', status: 'active' },
      aal: 'aal2',
    },
  };
}

function queryChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'limit', 'order', 'in', 'is']) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve(Promise.resolve({ data: rows, error: null }));
  return chain;
}

type NextRequestLike = Request & { nextUrl: URL };

function req(path: string): NextRequestLike {
  const request = new Request(`https://app.elogbook.dev${path}`) as NextRequestLike;
  Object.defineProperty(request, 'nextUrl', { value: new URL(request.url), configurable: true });
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSecurityContext).mockResolvedValue(context() as never);
  mockRpc.mockReset().mockResolvedValue({ data: 'audit-row-1', error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'case_entries' && ROUTES.some((r) => r.table === table)) {
      return queryChain([{ status: 'approved', case_templates: [{ specialty: 'surgery' }] }]);
    }
    if (table === 'duty_periods') {
      return queryChain([{ resident_id: ENTRY_ID, shift_date: '2026-01-01', hours_worked: 12, shift_type: 'day', comments: '' }]);
    }
    if (table === 'faculty_evaluations') {
      return queryChain([{
        resident_id: ENTRY_ID,
        evaluator_id: ENTRY_ID,
        evaluation_date: '2026-01-01',
        clinical_skills: 5,
        professionalism: 5,
        procedures: 3,
        comments: '=cmd()',
      }]);
    }
    return queryChain([]);
  });
});

describe.each(ROUTES)('$name', ({ handler, action }) => {
  it('writes a required audit event through the trusted RPC', async () => {
    const res = await handler(req('/api/demo/reports/x.csv'), { params });

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('write_audit_event', expect.objectContaining({
      p_action: action,
      p_resource_type: 'tenant',
      p_resource_id: null,
      p_tenant_id: TENANT_ID,
    }));
  });

  it('marks the response no-store', async () => {
    const res = await handler(req('/api/demo/reports/x.csv'), { params });

    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('fails closed when the required audit write fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'permission denied for table audit_logs' } });

    const res = await handler(req('/api/demo/reports/x.csv'), { params });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Could not record the export. Please try again.');
    expect(JSON.stringify(body)).not.toContain('permission denied');
  });

  it('rejects a resident', async () => {
    vi.mocked(getSecurityContext).mockResolvedValue(context('resident') as never);

    const res = await handler(req('/api/demo/reports/x.csv'), { params });

    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('evaluations.csv sanitizer', () => {
  it('escapes a formula in a free-text cell', async () => {
    const res = await (evaluations as unknown as RouteHandler)(req('/api/demo/reports/evaluations.csv'), { params });

    const text = await res.text();
    expect(text).toContain("'=cmd()");
    expect(text).not.toMatch(/^.*,=cmd\(\)/m);
  });
});
