import { describe, it, expect } from 'vitest';

const { GET } = await import('../route');

describe('GET /api/health', () => {
  it('returns 200 with status healthy', async () => {
    const res = await GET(new Request('http://app.elogbook.dev/api/health'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(typeof body.timestamp).toBe('string');
  });

  it('returns valid JSON with timestamp', async () => {
    const res = await GET(new Request('http://app.elogbook.dev/api/health'));
    const body = await res.json();

    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(body.timestamp).toBeDefined();
  });
});
