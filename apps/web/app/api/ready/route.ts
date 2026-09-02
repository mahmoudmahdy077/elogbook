import { createServerSupabase } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { rateLimiterHealth } from '@/lib/rate-limit-redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Readiness probe — database + rate-limiter health.
 *
 * Exempt from rate limiting (proxy.ts) but reports readiness that includes
 * the limiter's degraded state so the orchestrator can pull the instance out
 * of rotation rather than serving denials indefinitely.
 *
 * - 200 when DB reachable and limiter not degraded
 * - 503 when DB unreachable OR limiter degraded (distributed mode Redis down)
 *
 * The deployment that consumes this is documented in docker-compose.yml and
 * LAUNCH_SCOPE.md. Compose healthcheck currently polls /api/health (liveness);
 * readiness is for traffic gating (Swarm/K8s). Both are exempt, both have
 * different consumers — conflating them (old /api/health with DB+503) would
 * restart healthy pods on a transient DB blip (D-6).
 */
export async function GET() {
  const t0 = Date.now();

  // Database probe — same minimal check as old health, but only for readiness.
  let db: 'ok' | 'error' = 'ok';
  let dbError: string | null = null;
  try {
    const supabase = await createServerSupabase();
    const { error } = await supabase.from('tenants').select('id').limit(1);
    if (error) {
      db = 'error';
      dbError = error.message;
    }
  } catch (e) {
    db = 'error';
    dbError = e instanceof Error ? e.message : String(e);
  }

  // Rate limiter health — reflects redisDegradedSince set by checkRateLimit
  let rateLimit: ReturnType<typeof rateLimiterHealth> | null = null;
  let rateLimitDegraded = false;
  try {
    rateLimit = rateLimiterHealth();
    rateLimitDegraded = rateLimit.redisDegraded;
  } catch (e) {
    // If resolveMode throws (e.g., RATE_LIMIT_MODE unset in prod), treat as
    // degraded — readiness should not be ready.
    rateLimitDegraded = true;
    dbError = dbError ?? (e instanceof Error ? e.message : String(e));
  }

  const durationMs = Date.now() - t0;
  const timestamp = new Date().toISOString();

  if (db === 'error' || rateLimitDegraded) {
    return NextResponse.json(
      {
        status: db === 'error' && rateLimitDegraded ? 'unready' : db === 'error' ? 'unready' : 'degraded',
        db,
        dbError,
        rateLimit,
        durationMs,
        timestamp,
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      status: 'ready',
      db,
      rateLimit,
      durationMs,
      timestamp,
    },
    { status: 200 },
  );
}
