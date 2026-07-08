import { NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60_000;

/**
 * In-memory sliding window rate limiter (single-instance).
 *
 * ⚠️ For multi-instance deployments (Vercel, multiple serverless functions),
 *    use the Redis-backed version instead:
 *
 *    1. Set env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 *       (Upstash free tier: https://console.upstash.com/redis)
 *    2. Change imports from '@/lib/rate-limit' to '@/lib/rate-limit-redis'
 *    3. Await the async `checkRateLimit()` calls — signature is identical
 *
 *    The Redis version automatically falls back to local in-memory if
 *    Redis is unreachable, so the migration is safe to deploy incrementally.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number = 30,
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfter: 0 };
  }

  if (entry.count >= maxRequests) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count++;
  return { allowed: true, retryAfter: 0 };
}

export function rateLimitResponse(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please wait before trying again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}
