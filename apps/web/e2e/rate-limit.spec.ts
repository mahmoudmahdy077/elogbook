import { test, expect } from '@playwright/test';
test.describe('rate limiting', () => {
  test('31st login attempt returns 429', async ({ request }) => {
    for (let i = 0; i < 31; i++) {
      const res = await request.post('/login', { data: { email: `test${i}@test.com`, password: 'wrong' } });
      if (i === 30) {
        expect(res.status()).toBe(429);
        expect(res.headers()['retry-after']).toBeDefined();
      }
    }
  });
});
