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
      // Redis failure — fall back to local limiter
      console.warn('[rate-limit-redis] Redis error, falling back to local:', err);
      return localCheckRateLimit(key, maxRequests);
    }
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
