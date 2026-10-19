import { describe, it, expect, vi } from 'vitest';

// Mock must be at the module top level — Vitest hoists vi.mock calls and
// warns (soon errors) on nested mocks.
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'resident-1' } }, error: null })) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: 'p1', tenant_id: 't1', role: 'resident', tenants: { slug: 'test-tenant' } }, error: null })),
        })),
      })),
    })),
  })),
}));

// `@/lib/logger` imports `@sentry/nextjs`, which costs ~17s to transform and
// evaluate under the jsdom pool. No assertion here reads log output, so stub
// the seam rather than paying that cost on the first route import. The full
// exported surface is kept so any transitive importer still resolves.
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  redactPHI: vi.fn((value: unknown) => value),
}));

// The rate limiter is downstream of the origin guard under test and only
// reachable once authorization has already passed. Always allow, so this suite
// can never pass — or fail — because of an unrelated 429.
vi.mock('@/lib/rate-limit-redis', async () => {
  const { NextResponse } = await import('next/server');
  return {
    checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
    rateLimitResponse: vi.fn((retryAfter: number) =>
      NextResponse.json(
        { error: 'Too many requests. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      ),
    ),
    isCredentialKey: vi.fn(() => false),
    resolveMode: vi.fn(() => 'single-instance' as const),
    rateLimiterHealth: vi.fn(() => ({ mode: 'single-instance' as const, redisDegraded: false, degradedSince: null })),
    __resetRateLimiterForTests: vi.fn(),
  };
});

// The service-role client drags in `@supabase/supabase-js` and `@elogbook/env`
// (~1.9s) and is constructed only after the admin check has already passed, so
// it is unreachable from a denial assertion.
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}));

const endpoints = ['sso', 'scim', 'webhooks', 'ai-config', 'payment-gateway', 'assign-role', 'invite'];

describe('admin endpoint role gating', () => {
  it.each(endpoints)('%s returns 403 for resident', async (endpoint) => {
    const mod = await import(`../${endpoint}/route.ts`);
    const req = new Request(`http://localhost/api/test-tenant/admin/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const res = await mod.POST(req, { params: { tenant: 'test-tenant' } });
    expect(res.status).toBe(403);
  }, 30000);
});
