import { assertEquals } from 'jsr:@std/assert';
Deno.test('generate-pdf rejects unauthenticated requests', async () => {
  const res = await fetch('http://localhost:54321/functions/v1/generate-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assertEquals(res.status, 401);
});
