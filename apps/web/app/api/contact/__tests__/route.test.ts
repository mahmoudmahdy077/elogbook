import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../route';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit-redis';

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: (retryAfter: number) => new Response('Rate limited', { status: 429, headers: { 'retry-after': String(retryAfter) } }),
}));

const insertMock = vi.fn();

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfter: 0 });
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: () => ({ insert: insertMock }),
  } as never);
  insertMock.mockReset();
});

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/contact', () => {
  it('stores a valid submission', async () => {
    insertMock.mockResolvedValue({ error: null });
    const res = await POST(makeRequest({ name: 'Dr A', email: 'a@example.com', message: 'hello' }));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledWith({ name: 'Dr A', email: 'a@example.com', message: 'hello' });
  });
  it('rejects missing fields', async () => {
    const res = await POST(makeRequest({ name: '', email: '', message: '' }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });
  it('rejects invalid email', async () => {
    const res = await POST(makeRequest({ name: 'Dr A', email: 'nope', message: 'x' }));
    expect(res.status).toBe(400);
  });
  it('rate limits by IP', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfter: 60 });
    const res = await POST(makeRequest({ name: 'Dr A', email: 'a@example.com', message: 'x' }));
    expect(res.status).toBe(429);
  });
});
