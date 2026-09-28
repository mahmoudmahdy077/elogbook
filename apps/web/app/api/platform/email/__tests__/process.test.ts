// apps/web/app/api/platform/email/__tests__/process.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboundMessage } from '@elogbook/shared/email/types';

const mockState = vi.hoisted(() => ({
  queueRows: [
    { id: 'q1', lease_token: 'lease-1', template_key: 'digest.weekly', to_email: 'a@x.com', to_name: 'A', payload: {}, attempts: 0, priority: 0, created_at: new Date().toISOString() },
  ] as Array<Record<string, unknown>>,
  updates: [] as Array<{ table: string; values: Record<string, unknown>; filters: Array<{ column: string; value: unknown }> }>,
  logs: [] as Array<Record<string, unknown>>,
  sendAudit: [] as Array<Record<string, unknown>>,
  template: { subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' } as Record<string, unknown> | null,
  suppressed: null as Record<string, unknown> | null,
  suppressionError: null as { message: string } | null,
  sendAuditError: null as { message: string } | null,
  claimError: false,
  claimThrows: false,
  claimCalls: 0,
  claimed: false,
  sendError: null as { status?: number; message: string } | null,
  sendWithFailover: vi.fn(async (_message: OutboundMessage, _transports: unknown) => ({ id: 'msg-1', via: 'resend' as const })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    rpc: async (fn: string) => {
      if (fn === 'claim_email_queue') {
        mockState.claimCalls += 1;
        if (mockState.claimThrows) throw new Error('claim transport failed');
        if (mockState.claimError) return { data: null, error: { message: 'function missing' } };
        if (mockState.claimed) return { data: [], error: null };
        mockState.claimed = true;
        return { data: mockState.queueRows, error: null };
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
          update: (values: Record<string, unknown>) => {
            const filters: Array<{ column: string; value: unknown }> = [];
            const builder: Record<string, unknown> = {};
            builder.eq = (column: string, value: unknown) => {
              filters.push({ column, value });
              return builder;
            };
            builder.then = (
              resolve: (value: { data: null; error: null }) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => {
              mockState.updates.push({ table, values, filters });
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            };
            return builder;
          },
        };
      }
      if (table === 'email_suppressions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockState.suppressed, error: mockState.suppressionError }),
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
      if (table === 'email_unsubscribe_preferences') {
        return {
          select: () => {
            const builder: Record<string, unknown> = {};
            builder.eq = () => builder;
            builder.is = () => builder;
            builder.maybeSingle = async () => ({ data: null, error: null });
            return builder;
          },
        };
      }
      if (table === 'email_send_audit') {
        return {
          insert: async (row: Record<string, unknown>) => {
            mockState.sendAudit.push(row);
            return { data: null, error: mockState.sendAuditError };
          },
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
  sendWithFailover: mockState.sendWithFailover,
}));

describe('process route', () => {
  beforeEach(() => {
    mockState.queueRows = [
      { id: 'q1', lease_token: 'lease-1', template_key: 'digest.weekly', to_email: 'a@x.com', to_name: 'A', payload: {}, attempts: 0, priority: 0, created_at: new Date().toISOString() },
    ];
    mockState.updates = [];
    mockState.logs = [];
    mockState.sendAudit = [];
    mockState.template = { subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };
    mockState.suppressed = null;
    mockState.suppressionError = null;
    mockState.sendAuditError = null;
    mockState.claimError = false;
    mockState.claimThrows = false;
    mockState.claimCalls = 0;
    mockState.claimed = false;
    mockState.sendError = null;
    mockState.sendWithFailover.mockReset();
    mockState.sendWithFailover.mockResolvedValue({ id: 'msg-1', via: 'resend' });
    process.env.EMAIL_CRON_SECRET = 'test-secret-with-at-least-32-characters';
    process.env.EMAIL_TOKEN_SIGNING_SECRET = 'token-secret-with-at-least-32-characters';
    process.env.EMAIL_LOOKUP_HMAC_KEY = 'lookup-secret-with-at-least-32-characters';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.test';
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
      new Request('http://x', { method: 'POST', headers: { 'x-cron-secret': 'test-secret-with-at-least-32-characters' } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; processed: number; sent: number; failed: number };
    expect(body.success).toBe(true);
    expect(body.processed).toBe(1);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(mockState.claimCalls).toBe(1);
    expect(mockState.updates.some((u) => u.table === 'email_queue' && u.values.status === 'sent')).toBe(true);
    expect(mockState.updates.some((u) => u.filters.some((filter) => filter.column === 'lease_token' && filter.value === 'lease-1'))).toBe(true);
    expect(mockState.logs.some((l) => l.status === 'sent' && l.provider === 'resend')).toBe(true);
  });

  it('adds List-Unsubscribe headers to transactional template sends', async () => {
    mockState.queueRows[0] = {
      id: 'q1',
      lease_token: 'lease-1',
      template_key: 'case.approved',
      to_email: 'a@x.com',
      to_name: 'A',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      payload: { case_url: 'https://app.example.test/tenant/case/id' },
      attempts: 0,
      priority: 0,
      created_at: new Date().toISOString(),
    };
    const { POST } = await import('../process/route');

    const response = await POST(new Request('https://app.example.test', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret-with-at-least-32-characters' },
    }));

    expect(response.status).toBe(200);
    const message = mockState.sendWithFailover.mock.calls[0]?.[0];
    expect(message).toBeDefined();
    expect(message?.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/app\.example\.test\/api\/email\/unsubscribe\?token=/);
    expect(message?.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('rejects sensitive queue payloads without sending', async () => {
    mockState.queueRows[0].payload = { message: 'sensitive body' };
    const { POST } = await import('../process/route');

    const response = await POST(new Request('http://x', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret-with-at-least-32-characters' },
    }));

    expect(response.status).toBe(200);
    expect(mockState.sendWithFailover).not.toHaveBeenCalled();
    expect(mockState.updates.some((item) => item.values.last_error === 'invalid_queue_payload')).toBe(true);
  });

  it('does not send when the mandatory audit intent cannot be recorded', async () => {
    mockState.sendAuditError = { message: 'audit unavailable' };
    const { POST } = await import('../process/route');

    const response = await POST(new Request('http://x', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret-with-at-least-32-characters' },
    }));

    expect(response.status).toBe(200);
    expect(mockState.sendWithFailover).not.toHaveBeenCalled();
    expect(mockState.updates.some((item) => item.values.last_error === 'audit_unavailable')).toBe(true);
  });

  it('stores only sanitized provider error codes', async () => {
    const rawProviderBody = 'raw provider body with patient@example.test';
    mockState.sendWithFailover.mockRejectedValueOnce(Object.assign(new Error(rawProviderBody), { status: 502 }));
    const { POST } = await import('../process/route');

    const response = await POST(new Request('http://x', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret-with-at-least-32-characters' },
    }));

    expect(response.status).toBe(200);
    const persisted = JSON.stringify({ updates: mockState.updates, audits: mockState.sendAudit, logs: mockState.logs });
    expect(persisted).not.toContain(rawProviderBody);
    expect(persisted).toContain('provider_http_502');
  });

  it('fails closed when suppression lookup is unavailable', async () => {
    mockState.suppressionError = { message: 'database unavailable' };
    const { POST } = await import('../process/route');

    const response = await POST(new Request('http://x', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret-with-at-least-32-characters' },
    }));

    expect(response.status).toBe(200);
    expect(mockState.sendWithFailover).not.toHaveBeenCalled();
    expect(mockState.updates.some((item) => item.values.last_error === 'suppression_check_failed')).toBe(true);
  });

  it('fails closed when the atomic claim RPC is unavailable', async () => {
    mockState.claimError = true;
    const { POST } = await import('../process/route');

    const response = await POST(
      new Request('http://x', { method: 'POST', headers: { 'x-cron-secret': 'test-secret-with-at-least-32-characters' } }),
    );

    expect(response.status).toBe(503);
    expect(mockState.sendWithFailover).not.toHaveBeenCalled();
  });

  it('fails closed when the atomic claim RPC throws', async () => {
    mockState.claimThrows = true;
    const { POST } = await import('../process/route');

    const response = await POST(
      new Request('http://x', { method: 'POST', headers: { 'x-cron-secret': 'test-secret-with-at-least-32-characters' } }),
    );

    expect(response.status).toBe(503);
    expect(mockState.sendWithFailover).not.toHaveBeenCalled();
  });

  it('allows only one concurrent worker to send a claimed row', async () => {
    const { POST } = await import('../process/route');
    const makeRequest = () => new Request('http://x', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-secret-with-at-least-32-characters' },
    });

    await Promise.all([POST(makeRequest()), POST(makeRequest())]);

    expect(mockState.claimCalls).toBe(2);
    expect(mockState.sendWithFailover).toHaveBeenCalledTimes(1);
  });
});
