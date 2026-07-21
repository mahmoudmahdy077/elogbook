import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handleWebhook } from './index.ts';

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
