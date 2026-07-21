import { describe, it, expect, vi } from 'vitest';
import { POST } from '../route';

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

describe('csp-violation — SEC-005', () => {
  it('rejects bodies larger than 4 KB', async () => {
    const big = 'x'.repeat(5000);
    const req = new Request('https://x/api/csp-violation', {
      method: 'POST', body: big,
    });
    const res = await POST(req as any);
    expect(res.status).toBe(413);
  });

  it('rejects non-JSON bodies', async () => {
    const req = new Request('https://x/api/csp-violation', {
      method: 'POST', body: 'not json',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('accepts a valid csp-report', async () => {
    const body = JSON.stringify({ 'csp-report': { 'document-uri': 'https://x/y' } });
    const req = new Request('https://x/api/csp-violation', {
      method: 'POST', body,
    });
    const res = await POST(req as any);
    expect(res.status).toBe(204);
  });
});
