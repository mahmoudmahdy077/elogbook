import { describe, it, expect, vi, beforeEach } from 'vitest';

// Liveness must perform NO I/O — DB or Redis failures must not affect it.
// We mock those modules to throw if they are ever imported/called, and assert
// health still returns 200.

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => {
    throw new Error('health should not call supabase');
  }),
}));

vi.mock('@/lib/rate-limit-redis', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit-redis')>('@/lib/rate-limit-redis');
  return {
    ...actual,
    rateLimiterHealth: vi.fn(() => {
      throw new Error('health should not call rateLimiterHealth');
    }),
  };
});

const { GET } = await import('../route');

describe('GET /api/health — liveness (TICKET-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 healthy with timestamp, no DB dependency', async () => {
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(typeof body.timestamp).toBe('string');
    // liveness must not expose db fields
    expect(body.db).toBeUndefined();
    expect(body.rateLimit).toBeUndefined();
  });

  it('still returns 200 even when supabase would throw (no I/O assertion)', async () => {
    // The mock above makes createServerSupabase throw — health must not call it.
    const res = await GET();
    expect(res.status).toBe(200);
    const { createServerSupabase } = await import('@/lib/supabase/server');
    expect(createServerSupabase).not.toHaveBeenCalled();
  });

  it('returns valid ISO timestamp', async () => {
    const res = await GET();
    const body = await res.json();
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});
