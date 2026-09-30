import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUnsubscribeToken } from '@elogbook/shared/email/safety';

const insert = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: () => ({ insert }),
  }),
}));

import { GET, POST } from '../unsubscribe/route';

const secret = 'token-secret-with-at-least-32-characters';
const token = createUnsubscribeToken({
  recipientHmac: 'c'.repeat(64),
  templateKey: 'digest.weekly',
  tenantId: '00000000-0000-0000-0000-000000000001',
  expiresAt: 4_000_000_000,
}, secret);

function request(method: 'GET' | 'POST') {
  const url = `https://app.example.test/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
  if (method === 'GET') return new Request(url);
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
}

describe('email unsubscribe endpoint', () => {
  beforeEach(() => {
    process.env.EMAIL_TOKEN_SIGNING_SECRET = secret;
    insert.mockResolvedValue({ data: null, error: null });
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.EMAIL_TOKEN_SIGNING_SECRET;
  });

  it('keeps GET read-only and returns a POST confirmation form', async () => {
    const response = await GET(request('GET'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(insert).not.toHaveBeenCalled();
    expect(await response.text()).toContain('method="post"');
  });

  it('persists only the signed recipient HMAC and template scope', async () => {
    const response = await POST(request('POST'));

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith({
      scope_key: `00000000-0000-0000-0000-000000000001:${'c'.repeat(64)}:digest.weekly`,
      recipient_hmac: 'c'.repeat(64),
      tenant_id: '00000000-0000-0000-0000-000000000001',
      template_key: 'digest.weekly',
    });
    expect(JSON.stringify(insert.mock.calls)).not.toContain('@');
  });

  it('treats a repeated one-click unsubscribe as idempotent', async () => {
    insert.mockResolvedValueOnce({ data: null, error: { code: '23505' } });

    const response = await POST(request('POST'));

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('rejects tampered tokens and fails closed when signing is unavailable', async () => {
    const tampered = new Request(`https://app.example.test/api/email/unsubscribe?token=${token}x`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    expect((await POST(tampered)).status).toBe(400);

    delete process.env.EMAIL_TOKEN_SIGNING_SECRET;
    expect((await POST(request('POST'))).status).toBe(503);
    expect(insert).not.toHaveBeenCalled();
  });
});
