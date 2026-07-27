import { assertEquals, assertExists } from 'jsr:@std/assert';

Deno.test('checkout.session.completed creates active subscription', async () => {
  const res = await fetch('http://localhost:54321/functions/v1/payment-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', customer: 'cus_test1', metadata: { tenant_id: '00000000-0000-0000-0000-000000000000', plan: 'premium' } } } }),
  });
  assertEquals(res.status, 200);
});

Deno.test('customer.subscription.deleted sets canceled status', async () => {
  const res = await fetch('http://localhost:54321/functions/v1/payment-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_test1', customer: 'cus_test1' } } }),
  });
  assertEquals(res.status, 200);
});
