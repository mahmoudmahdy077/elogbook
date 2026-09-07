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

  it('returns 503 promptly when the DB ping hangs (timeout-bound)', async () => {
    process.env.READINESS_DB_TIMEOUT_MS = '50';
    try {
      vi.mocked(createServerSupabase).mockResolvedValue({
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            limit: vi.fn(() => new Promise(() => {})),
          })),
        })),
      } as unknown as Awaited<ReturnType<typeof createServerSupabase>>);
      vi.mocked(rateLimiterHealth).mockReturnValue({
        mode: 'single-instance' as const,
        redisDegraded: false,
        degradedSince: null,
      });

      const t0 = Date.now();
      const res = await GET();
      const elapsed = Date.now() - t0;
      expect(res.status).toBe(503);
      // Must not hang with the query: bounded well under the 5s default.
      expect(elapsed).toBeLessThan(4000);
      const body = await res.json();
      expect(body.db).toBe('error');
    } finally {
      delete process.env.READINESS_DB_TIMEOUT_MS;
    }
  });

  it('never exposes internal database details to anonymous callers', async () => {
    const secret = 'password authentication failed for user "postgres" at 10.0.0.9';
    supabaseReturns({ message: secret });
    vi.mocked(rateLimiterHealth).mockReturnValue({
      mode: 'single-instance' as const,
      redisDegraded: false,
      degradedSince: null,
    });

    const res = await GET();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('postgres');
    expect(text).not.toContain('10.0.0.9');
  });

  it('reports ready again after the database recovers (no latch)', async () => {
    supabaseReturns({ message: 'transient blip' });
    vi.mocked(rateLimiterHealth).mockReturnValue({
      mode: 'single-instance' as const,
      redisDegraded: false,
      degradedSince: null,
    });
    expect((await GET()).status).toBe(503);

    supabaseReturns(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ready');
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
      } catch {
        // ignore missing candidate
      }
    }
    expect(proxySrc).toMatch(/\/api\/ready/);
    expect(proxySrc).toMatch(/isHealthProbe|health.*ready/i);
  });
});
