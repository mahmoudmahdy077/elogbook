// apps/web/app/api/platform/email/__tests__/webhook.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

const mockUpsert = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: () => ({ upsert: mockUpsert }),
  }),
}));

import { POST } from '../webhook/route';

const SECRET = 'test-webhook-secret';
const BODY = { type: 'email.bounced', data: { to: ['a@x.com'] } };
const RAW = JSON.stringify(BODY);

function svixHeaders(raw: string, secret: string, timestamp: string) {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('base64');
  return { 'svix-signature': `v1,${sig}`, 'svix-timestamp': timestamp };
}

describe('email webhook', () => {
  const orig = process.env.RESEND_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    if (orig === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET = orig;
  });

  it('rejects missing signature with 401', async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    const res = await POST(new Request('http://x', { method: 'POST', body: RAW }));
    expect(res.status).toBe(401);
  });

  it('fails closed with 503 when secret not configured', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'svix-signature': 'v1,abc', 'svix-timestamp': '123' },
        body: RAW,
      }),
    );
    expect(res.status).toBe(503);
  });

  it('rejects invalid signature with 401', async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'svix-signature': 'v1,invalid', 'svix-timestamp': '123' },
        body: RAW,
      }),
    );
    expect(res.status).toBe(401);
  });

  it('accepts valid Svix signature and upserts suppression', async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    const ts = '1750000000';
    const headers = svixHeaders(RAW, SECRET, ts);
    const res = await POST(
      new Request('http://x', { method: 'POST', headers, body: RAW }),
    );
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      { email: 'a@x.com', reason: 'bounce' },
      { onConflict: 'email' },
    );
  });

  it('accepts valid resend-signature HMAC over raw body', async () => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    const sig = createHmac('sha256', SECRET).update(RAW).digest('hex');
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'resend-signature': sig },
        body: RAW,
      }),
    );
    expect(res.status).toBe(200);
  });
});
