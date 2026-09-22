// apps/web/app/api/platform/email/__tests__/process.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => ({
  queueRows: [
    { id: 'q1', template_key: 'digest.weekly', to_email: 'a@x.com', to_name: 'A', payload: {}, attempts: 0, priority: 0, created_at: new Date().toISOString() },
  ] as Array<Record<string, unknown>>,
  updates: [] as Array<{ table: string; values: Record<string, unknown>; col: string; val: unknown }>,
  logs: [] as Array<Record<string, unknown>>,
  template: { subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' } as Record<string, unknown> | null,
  suppressed: null as Record<string, unknown> | null,
  lockResult: true as boolean | null, // true = acquired, false = locked, null = rpc error (no lock fn)
}));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    rpc: async (fn: string) => {
      if (fn === 'pg_try_advisory_lock') {
        if (mockState.lockResult === null) return { data: null, error: { message: 'function missing' } };
        return { data: mockState.lockResult, error: null };
      }
      return { data: true, error: null };
    },
    from: (table: string) => {
      if (table === 'email_queue') {
        return {
          select: () => {
            const b: Record<string, unknown> = {};
            b.in = () => b;
            b.eq = () => b;
            b.lte = () => b;
            b.order = () => b;
            b.limit = async () => ({ data: mockState.queueRows, error: null });
            b.maybeSingle = async () => ({ data: mockState.queueRows[0] ?? null, error: null });
            return b;
          },
          update: (values: Record<string, unknown>) => ({
            eq: async (col: string, val: unknown) => {
              mockState.updates.push({ table, values, col, val });
              return { error: null };
            },
          }),
        };
      }
      if (table === 'email_suppressions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockState.suppressed, error: null }),
              limit: async () => ({ data: mockState.suppressed ? [mockState.suppressed] : [], error: null }),
            }),
          }),
        };
      }
      if (table === 'email_templates') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: mockState.template, error: null }),
                limit: async () => ({ data: mockState.template ? [mockState.template] : [], error: null }),
              }),
              maybeSingle: async () => ({ data: mockState.template, error: null }),
            }),
          }),
        };
      }
      // email_logs + fallback
      return {
        insert: async (row: Record<string, unknown>) => {
          mockState.logs.push(row);
          return { error: null };
        },
        select: () => ({ limit: async () => ({ data: [], error: null }) }),
      };
    },
  }),
}));

vi.mock('@elogbook/shared/email/send', () => ({
  sendWithFailover: vi.fn(async () => ({ id: 'msg-1', via: 'resend' })),
}));

describe('process route', () => {
  beforeEach(() => {
    mockState.queueRows = [
      { id: 'q1', template_key: 'digest.weekly', to_email: 'a@x.com', to_name: 'A', payload: {}, attempts: 0, priority: 0, created_at: new Date().toISOString() },
    ];
    mockState.updates = [];
    mockState.logs = [];
    mockState.template = { subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };
    mockState.suppressed = null;
    mockState.lockResult = true;
    process.env.EMAIL_CRON_SECRET = 'test-secret';
    process.env.EMAIL_FROM = 'Test <test@example.com>';
    process.env.RESEND_API_KEY = 're_test';
    vi.clearAllMocks();
  });

  it('requires cron secret', async () => {
    const { POST } = await import('../process/route');
    const res = await POST(new Request('http://x', { method: 'POST', headers: {} }));
    expect(res.status).toBe(401);
  });

  it('drains pending row to sent with log', async () => {
    const { POST } = await import('../process/route');
    const res = await POST(
      new Request('http://x', { method: 'POST', headers: { 'x-cron-secret': 'test-secret' } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; processed: number; sent: number; failed: number };
    expect(body.success).toBe(true);
    expect(body.processed).toBe(1);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(mockState.updates.some((u) => u.table === 'email_queue' && u.values.status === 'sent')).toBe(true);
    expect(mockState.logs.some((l) => l.status === 'sent' && l.provider === 'resend')).toBe(true);
  });
});
