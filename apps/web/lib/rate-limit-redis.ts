/**
 * Redis-backed rate limiter for multi-instance deployments.
 *
 * Uses Upstash Redis REST API (no npm package needed — pure fetch).
 * Falls back to the local in-memory limiter (rate-limit.ts) when
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set.
 *
 * Usage:
 *   import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
 *   // Same API as rate-limit.ts
 */

import { NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const localStore = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60_000;

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = !!(UPSTASH_URL && UPSTASH_TOKEN);
const isProd = process.env.NODE_ENV === 'production';
const REQUIRE_REDIS_IN_PROD =
  process.env.REQUIRE_REDIS_IN_PROD === 'true' || isProd;

function isAuthKey(key: string): boolean {
  return key.startsWith('login:') || key.startsWith('auth-cb:') || key.startsWith('api:') || key.startsWith('assign-role:') || key.startsWith('invite:');
}

/**
 * Execute a Redis command via Upstash REST API
 */
async function redisCommand(command: string, ...args: string[]): Promise<string | null> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error('Redis not configured');
  const res = await fetch(`${UPSTASH_URL}/${command}/${args.join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Redis error: ${res.status}`);
  return res.json();
}

/**
 * Sliding window rate limiter.
 *
 * Redis mode: Uses an EXPIRE-based sliding window per key.
 *   Keys: ratelimit:{key}:count, ratelimit:{key}:window
 * Local mode: In-memory Map (single-instance only).
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number = 30,
): Promise<{ allowed: boolean; retryAfter: number }> {
  if (useRedis) {
    try {
      const now = Date.now();
      const windowKey = `ratelimit:${key}:window`;
      const countKey = `ratelimit:${key}:count`;

      // Get or create window
      const windowStart = await redisCommand('GET', windowKey);
      const currentWindow = windowStart ? parseInt(windowStart, 10) : null;

      if (!currentWindow || now - currentWindow > WINDOW_MS) {
        // Start new window
        await redisCommand('SET', windowKey, String(now));
        await redisCommand('EXPIRE', windowKey, '120');
        await redisCommand('SET', countKey, '1');
        await redisCommand('EXPIRE', countKey, '120');
        return { allowed: true, retryAfter: 0 };
      }

      const count = parseInt(await redisCommand('GET', countKey) || '0', 10);
      if (count >= maxRequests) {
        const retryAfter = Math.ceil((currentWindow + WINDOW_MS - now) / 1000);
        return { allowed: false, retryAfter };
      }

      await redisCommand('INCR', countKey);
      return { allowed: true, retryAfter: 0 };
    } catch (err) {
      // Redis failure — in production, fail closed for auth keys (no Map fallback)
      console.warn('[rate-limit-redis] Redis error, falling back to local:', err);
      if (isProd && isAuthKey(key) && REQUIRE_REDIS_IN_PROD) {
        console.error('[rate-limit-redis] CRITICAL: Redis unavailable in production for auth key', key, '- failing closed');
        // Fail closed: deny request rather than allow with inconsistent local state
        return { allowed: false, retryAfter: 60 };
      }
      return localCheckRateLimit(key, maxRequests);
    }
  }

  // No Redis configured
  if (isProd && isAuthKey(key) && REQUIRE_REDIS_IN_PROD) {
    console.error('[rate-limit-redis] CRITICAL: UPSTASH_REDIS_REST_URL/TOKEN not configured in production for auth key', key, '- rate limiting is not distributed. Set REQUIRE_REDIS_IN_PROD=false to allow local fallback (not recommended).');
    // In production, deny rather than silently using local Map for auth
    // If you intentionally run single-instance, set REQUIRE_REDIS_IN_PROD=false
    return { allowed: false, retryAfter: 60 };
  }

  if (isProd && !useRedis) {
    console.warn('[rate-limit-redis] Redis not configured — using in-memory fallback (single-instance only, not safe for distributed prod).');
  }

  return localCheckRateLimit(key, maxRequests);
}

function localCheckRateLimit(key: string, maxRequests: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = localStore.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    localStore.set(key, { count: 1, windowStart: now });
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
