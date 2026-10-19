import { assertEquals, assertRejects } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  assertDbResult,
  claimStripeEvent,
  handleWebhook,
  markStripeEventFailed,
  markStripeEventProcessed,
  MAX_WEBHOOK_BODY_BYTES,
  readBoundedBody,
  resolveTenantConfig,
} from './index.ts';

Deno.test('resolveTenantConfig returns null when tenant does not exist', async () => {
  const stubSupabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };
  const result = await resolveTenantConfig(stubSupabase as never, '00000000-0000-0000-0000-000000000000');
  assertEquals(result, null);
});

Deno.test('payment-webhook: accepts OPTIONS request', async () => {
  const res = await handleWebhook(new Request('https://x', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
});

Deno.test('payment-webhook: rejects missing signature', async () => {
  const res = await handleWebhook(new Request('https://x', { method: 'POST', body: '{}' }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'Missing stripe-signature header');
});

Deno.test('payment-webhook: rejects missing env vars', async () => {
  const res = await handleWebhook(
    new Request('https://x', {
      method: 'POST',
      headers: { 'stripe-signature': 'test_sig' },
      body: '{}',
    })
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, 'Server configuration error');
});

Deno.test('payment-webhook: returns 401 when tenant cannot be identified', async () => {
  const origUrl = Deno.env.get('SUPABASE_URL');
  const origKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  try {
    Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const res = await handleWebhook(
      new Request('https://x', {
        method: 'POST',
        headers: { 'stripe-signature': 'test_sig' },
        body: JSON.stringify({ type: 'checkout.session.completed' }),
      })
    );
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, 'Could not identify tenant from webhook');
  } finally {
    if (origUrl) Deno.env.set('SUPABASE_URL', origUrl);
    else Deno.env.delete('SUPABASE_URL');
    if (origKey) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', origKey);
    else Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  }
});

Deno.test('payment-webhook: rejects empty body', async () => {
  const origUrl = Deno.env.get('SUPABASE_URL');
  const origKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  try {
    Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const res = await handleWebhook(
      new Request('https://x', {
        method: 'POST',
        headers: { 'stripe-signature': 'test_sig' },
        body: '',
      })
    );
    assertEquals(res.status, 401);
  } finally {
    if (origUrl) Deno.env.set('SUPABASE_URL', origUrl);
    else Deno.env.delete('SUPABASE_URL');
    if (origKey) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', origKey);
    else Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  }
});

Deno.test('payment-webhook: rejects an oversized request before environment or signature work', async () => {
  const res = await handleWebhook(new Request('https://x', {
    method: 'POST',
    headers: { 'stripe-signature': 'test_sig' },
    body: 'x'.repeat(MAX_WEBHOOK_BODY_BYTES + 1),
  }));
  assertEquals(res.status, 413);
});

Deno.test('payment-webhook: bounds the body before any signature processing', async () => {
  const body = 'x'.repeat(32);
  const result = await readBoundedBody(new Request('https://x', { method: 'POST', body }), 16);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.status, 413);
});

Deno.test('payment-webhook: atomically claims a failed event for replay', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: { claimed: true, status: 'processing', claim_token: 'claim-1' }, error: null };
    },
  };
  const result = await claimStripeEvent(client as never, {
    eventId: 'evt_replay',
    eventType: 'invoice.paid',
    mode: 'test',
    livemode: false,
    tenantId: '00000000-0000-0000-0000-000000000000',
    eventCreated: 123,
    objectVersion: 4,
  });
  assertEquals(result.claimed, true);
  assertEquals(result.claimToken, 'claim-1');
  assertEquals(calls[0].name, 'claim_stripe_event');
  assertEquals(calls[0].args.p_payload, { event_created: 123, object_version: 4 });
});

Deno.test('payment-webhook: treats a processed claim as an idempotent duplicate', async () => {
  const client = {
    rpc: async () => ({ data: { claimed: false, status: 'processed' }, error: null }),
  };
  const result = await claimStripeEvent(client as never, {
    eventId: 'evt_duplicate',
    eventType: 'invoice.paid',
    mode: 'test',
    livemode: false,
    tenantId: '00000000-0000-0000-0000-000000000000',
  });
  assertEquals(result.claimed, false);
  assertEquals(result.duplicate, true);
});

Deno.test('payment-webhook: propagates claim DB errors', async () => {
  const client = {
    rpc: async () => ({ data: null, error: { message: 'claim failed' } }),
  };
  await assertRejects(
    () => claimStripeEvent(client as never, {
      eventId: 'evt_error',
      eventType: 'invoice.paid',
      mode: 'test',
      livemode: false,
      tenantId: '00000000-0000-0000-0000-000000000000',
    }),
    Error,
    'claim failed',
  );
});

Deno.test('payment-webhook: refuses to mark an event processed when the DB update fails', async () => {
  const client = {
    rpc: async () => ({ data: false, error: { message: 'completion failed' } }),
  };
  await assertRejects(
    () => markStripeEventProcessed(client as never, 'evt_error', 'claim-1'),
    Error,
    'completion failed',
  );
});

Deno.test('payment-webhook: refuses to release a failed claim when the DB update fails', async () => {
  const client = {
    rpc: async () => ({ data: false, error: null }),
  };
  await assertRejects(
    () => markStripeEventFailed(client as never, 'evt_error', 'claim-1', 'database_failure'),
    Error,
    'claim was not released',
  );
});

Deno.test('payment-webhook: assertDbResult rejects every database error result', () => {
  assertDbResult({ error: null }, 'read');
  assertRejects(async () => { assertDbResult({ error: { message: 'write failed' } }, 'write'); }, Error);
});

Deno.test('payment-webhook: rejects with Stripe-Account header for unknown tenant', async () => {
  const origUrl = Deno.env.get('SUPABASE_URL');
  const origKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  try {
    Deno.env.set('SUPABASE_URL', 'https://test.supabase.co');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const res = await handleWebhook(
      new Request('https://x', {
        method: 'POST',
        headers: {
          'stripe-signature': 'test_sig',
          'Stripe-Account': 'acct_unknown_tenant'
        },
        body: JSON.stringify({ type: 'checkout.session.completed' }),
      })
    );
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, 'Could not identify tenant from webhook');
  } finally {
    if (origUrl) Deno.env.set('SUPABASE_URL', origUrl);
    else Deno.env.delete('SUPABASE_URL');
    if (origKey) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', origKey);
    else Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  }
});
