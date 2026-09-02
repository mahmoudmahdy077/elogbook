import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(),
}));

vi.mock('@/lib/rate-limit-redis', () => ({
  rateLimiterHealth: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  resolveMode: vi.fn(),
  isCredentialKey: vi.fn(),
  __resetRateLimiterForTests: vi.fn(),
}));

import { createServerSupabase } from '@/lib/supabase/server';
import { rateLimiterHealth } from '@/lib/rate-limit-redis';
import { GET } from '../route';

function supabaseReturns(error: unknown | null) {
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      limit: vi.fn(async () => ({ data: error ? null : [], error })),
    })),
  }));
  vi.mocked(createServerSupabase).mockResolvedValue({
    from,
  } as unknown as Awaited<ReturnType<typeof createServerSupabase>>);
}

describe('GET /api/ready — readiness (TICKET-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 ready when DB ok and limiter not degraded', async () => {
    supabaseReturns(null);
    vi.mocked(rateLimiterHealth).mockReturnValue({
      mode: 'single-instance' as const,
      redisDegraded: false,
      degradedSince: null,
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.db).toBe('ok');
    expect(body.rateLimit.redisDegraded).toBe(false);
  });

  it('returns 503 unready when DB errors', async () => {
    supabaseReturns({ message: 'db error' });
    vi.mocked(rateLimiterHealth).mockReturnValue({
      mode: 'single-instance' as const,
      redisDegraded: false,
      degradedSince: null,
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.status).toBe('unready');
    expect(body.db).toBe('error');
  });

  it('returns 503 degraded when limiter degraded (distributed Redis down)', async () => {
    supabaseReturns(null);
    vi.mocked(rateLimiterHealth).mockReturnValue({
      mode: 'distributed' as const,
      redisDegraded: true,
      degradedSince: new Date().toISOString(),
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.rateLimit.redisDegraded).toBe(true);
  });

  it('returns 503 unready when both DB and limiter degraded', async () => {
    supabaseReturns({ message: 'db error' });
    vi.mocked(rateLimiterHealth).mockReturnValue({
      mode: 'distributed' as const,
      redisDegraded: true,
      degradedSince: new Date().toISOString(),
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(['unready', 'degraded']).toContain(body.status);
  });

  it('returns 503 when DB throws', async () => {
    vi.mocked(createServerSupabase).mockRejectedValue(new Error('db unreachable'));
    vi.mocked(rateLimiterHealth).mockReturnValue({
      mode: 'single-instance' as const,
      redisDegraded: false,
      degradedSince: null,
    });

    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.db).toBe('error');
  });

  it('returns 503 when limiter throws (e.g., RATE_LIMIT_MODE unset in prod)', async () => {
    supabaseReturns(null);
    vi.mocked(rateLimiterHealth).mockImplementation(() => {
      throw new Error('mode not set');
    });

    const res = await GET();
    expect(res.status).toBe(503);
  });

  it('is exempt from rate limiting (proxy check by inspection)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const candidates = [
      join(process.cwd(), 'proxy.ts'),
      join(process.cwd(), 'apps/web/proxy.ts'),
      join(process.cwd(), '../proxy.ts'),
    ];
    let proxySrc = '';
    for (const p of candidates) {
      try {
        proxySrc = readFileSync(p, 'utf8');
        break;
      } catch {}
    }
    expect(proxySrc).toMatch(/\/api\/ready/);
    expect(proxySrc).toMatch(/isHealthProbe|health.*ready/i);
  });
});
