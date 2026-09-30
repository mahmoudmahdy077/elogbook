import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';

const mockState = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcResult: { replayed: false, tenant_id: null, template_key: null } as Record<string, unknown>,
  rpcError: null as { code?: string; message: string } | null,
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 60 })),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      mockState.rpcCalls.push({ name, args });
      return { data: mockState.rpcResult, error: mockState.rpcError };
    },
  }),
}));

import { POST } from '../webhook/route';

const secret = 'webhook-secret-with-at-least-32-characters';
const lookupSecret = 'lookup-secret-with-at-least-32-characters';
const tenantId = '00000000-0000-0000-0000-000000000001';

function body(type: string, recipients: string[], createdAt = new Date().toISOString()) {
  return JSON.stringify({
    type,
    created_at: createdAt,
    data: { email_id: 'provider-message-1', to: recipients },
  });
}

function signedRequest(raw: string, options: { id?: string; timestamp?: string | null; type?: string } = {}) {
  const timestamp = options.timestamp === null ? null : options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'svix-id': options.id ?? 'event-1',
  };
  if (timestamp !== null) {
    headers['svix-timestamp'] = timestamp;
    headers['svix-signature'] = `v1,${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('base64')}`;
  }
  return new Request('https://app.example.test/api/platform/email/webhook', {
    method: 'POST',
    headers,
    body: raw,
  });
}

describe('email webhook', () => {
  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = secret;
    process.env.EMAIL_LOOKUP_HMAC_KEY = lookupSecret;
    mockState.rpcCalls = [];
    mockState.rpcResult = { replayed: false, tenant_id: null, template_key: null };
    mockState.rpcError = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.EMAIL_LOOKUP_HMAC_KEY;
  });

  it('fails closed when webhook verification material is missing', async () => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const response = await POST(signedRequest(body('email.delivered', ['a@example.test'])));
    expect(response.status).toBe(503);
  });

  it('rejects missing IDs, invalid signatures, and stale timestamps', async () => {
    const raw = body('email.delivered', ['a@example.test']);
    expect((await POST(signedRequest(raw, { id: '' }))).status).toBe(401);
    expect((await POST(signedRequest(raw, { timestamp: '1' }))).status).toBe(401);
    const missingTimestamp = signedRequest(raw, { timestamp: null });
    expect((await POST(missingTimestamp)).status).toBe(401);
  });

  it('records delivery events without suppressing recipients', async () => {
    const response = await POST(signedRequest(body('email.delivered', ['a@example.test', 'b@example.test'])));

    expect(response.status).toBe(200);
    expect(mockState.rpcCalls).toHaveLength(1);
    expect(mockState.rpcCalls[0]).toMatchObject({
      name: 'record_email_delivery_event',
      args: expect.objectContaining({ p_provider_event_id: 'event-1', p_event_type: 'delivered' }),
    });
    expect(mockState.rpcCalls[0].args.p_recipients).toEqual([
      expect.objectContaining({ email: 'a@example.test' }),
      expect.objectContaining({ email: 'b@example.test' }),
    ]);
  });

  it('treats a unique provider event conflict as an idempotent replay', async () => {
    mockState.rpcResult = { replayed: true, tenant_id: null, template_key: null };
    const response = await POST(signedRequest(body('email.bounced', ['a@example.test'])));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, replayed: true });
  });

  it('suppresses every hard-bounce recipient and ignores unknown event types', async () => {
    const response = await POST(signedRequest(body('email.bounced', ['a@example.test', 'b@example.test'])));
    expect(response.status).toBe(200);
    expect(mockState.rpcCalls[0].args.p_recipients).toEqual([
      expect.objectContaining({ email: 'a@example.test' }),
      expect.objectContaining({ email: 'b@example.test' }),
    ]);

    const unsupported = await POST(signedRequest(body('email.opened', ['a@example.test']), { id: 'event-2' }));
    expect(unsupported.status).toBe(400);
  });

  it('resolves tenant and template scope before processing unsubscribe events', async () => {
    mockState.rpcResult = { replayed: false, tenant_id: tenantId, template_key: 'digest.weekly' };
    const response = await POST(signedRequest(body('email.unsubscribed', ['a@example.test']), { id: 'event-3' }));

    expect(response.status).toBe(200);
    const recipients = mockState.rpcCalls[0]?.args.p_recipients;
    expect(Array.isArray(recipients)).toBe(true);
    if (!Array.isArray(recipients)) throw new Error('expected recipient metadata');
    expect(recipients[0]).toMatchObject({
      email: 'a@example.test',
      recipient_hmac: createHmac('sha256', lookupSecret).update('a@example.test').digest('hex'),
    });
  });

  it('rejects an unsubscribe event that cannot be scoped to one tenant template', async () => {
    mockState.rpcError = { code: 'P0001', message: 'webhook scope is ambiguous' };
    const response = await POST(signedRequest(body('email.unsubscribed', ['a@example.test']), { id: 'event-4' }));
    expect(response.status).toBe(409);
    expect(mockState.rpcCalls).toHaveLength(1);
  });
});
