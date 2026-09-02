/**
 * Distributed rate limiter (Upstash Redis REST) with an explicit, non-silent
 * deployment contract.
 *
 * DEPLOYMENT CONTRACT — `RATE_LIMIT_MODE` is REQUIRED in production.
 *
 *   RATE_LIMIT_MODE=distributed
 *     Horizontally scaled deployments. Requires UPSTASH_REDIS_REST_URL and
 *     UPSTASH_REDIS_REST_TOKEN. When Redis is unreachable:
 *       - credential keys  -> DENY (fail closed) and mark readiness degraded
 *       - availability keys -> local per-instance limiter + error log (fail open)
 *
 *   RATE_LIMIT_MODE=single-instance
 *     Deliberately single-process self-hosted deployments (the Docker Compose
 *     installer profile). Local in-memory limiter only. Credential keys get a
 *     hard reduced budget. This is a documented reduced-security mode.
 *
 *   Unset in production -> throws. A security policy is never chosen silently.
 *   Unset in development/test -> defaults to 'single-instance'.
 *
 * Rationale for splitting failure direction by key class: `api:` is applied to
 * effectively every /api/* request by proxy.ts, so treating a Redis outage as
 * "deny" on that key class is a self-inflicted denial of service. Credential
 * keys are the brute-force surface and are the ones worth denying.
 */

import { NextResponse } from 'next/server';

export type RateLimitMode = 'distributed' | 'single-instance';

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const localStore = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60_000;
const WINDOW_SECONDS = 60;

/** Hard ceiling applied to credential keys served by the local limiter. */
const LOCAL_CREDENTIAL_BUDGET = 5;

/**
 * Credential / identity-mutation surfaces. These fail CLOSED in distributed
 * mode when Redis is unavailable. `api:` is deliberately NOT in this list.
 */
const CREDENTIAL_KEY_PREFIXES = [
  'login:',
  'auth-cb:',
  'invite:',
  'assign-role:',
  'sso:',
  'request-verification:',
] as const;

export function isCredentialKey(key: string): boolean {
  return CREDENTIAL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Per-instance budget for the local limiter. */
function localBudget(key: string, maxRequests: number): number {
  return isCredentialKey(key)
    ? Math.min(maxRequests, LOCAL_CREDENTIAL_BUDGET)
    : maxRequests;
}

/**
 * Resolve the deployment contract. Evaluated lazily and cached so tests can
 * control the environment via vi.resetModules() + dynamic import, and so a
 * misconfiguration surfaces as a descriptive error rather than an opaque
 * import-time crash.
 */
let cachedMode: RateLimitMode | null = null;
let warnedSingleInstanceWithCreds = false;

export function resolveMode(): RateLimitMode {
  if (cachedMode) return cachedMode;

  const raw = process.env.RATE_LIMIT_MODE;
  const isProd = process.env.NODE_ENV === 'production';

  if (raw === 'distributed' || raw === 'single-instance') {
    cachedMode = raw;
  } else if (raw !== undefined && raw !== '') {
    throw new Error(
      `[rate-limit] RATE_LIMIT_MODE has invalid value "${raw}". ` +
        `Expected 'distributed' or 'single-instance'.`,
    );
  } else if (isProd) {
    throw new Error(
      '[rate-limit] RATE_LIMIT_MODE is required in production. ' +
        "Set 'distributed' (multi-instance; requires UPSTASH_REDIS_REST_URL and " +
        "UPSTASH_REDIS_REST_TOKEN) or 'single-instance' (documented " +
        'reduced-security mode for single-process self-hosted deployments).',
    );
  } else {
    cachedMode = 'single-instance';
  }

  if (cachedMode === 'distributed' && !hasRedisCredentials()) {
    throw new Error(
      '[rate-limit] RATE_LIMIT_MODE=distributed requires UPSTASH_REDIS_REST_URL ' +
        'and UPSTASH_REDIS_REST_TOKEN.',
    );
  }

  if (cachedMode === 'single-instance' && hasRedisCredentials()) {
    if (!warnedSingleInstanceWithCreds) {
      warnedSingleInstanceWithCreds = true;
      console.warn(
        '[rate-limit] RATE_LIMIT_MODE=single-instance with Upstash credentials present: ' +
          'credentials are ignored and local limiter will be used. Mode is the authority, not credential presence.',
      );
    }
  } else if (cachedMode === 'single-instance' && isProd) {
    // Only warn about single-instance in prod if we haven't already warned for creds case
    if (!warnedSingleInstanceWithCreds) {
      console.warn(
        '[rate-limit] RATE_LIMIT_MODE=single-instance in production: limits are ' +
          'per-process and are NOT enforced across instances. Valid only for a ' +
          'single-process deployment.',
      );
    }
  }

  return cachedMode;
}

function hasRedisCredentials(): boolean {
  return !!(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

/** Test seam: clear the memoised mode and local buckets. */
export function __resetRateLimiterForTests(): void {
  cachedMode = null;
  warnedSingleInstanceWithCreds = false;
  redisDegradedSince = null;
  localStore.clear();
}

/**
 * Readiness signal. In distributed mode a Redis outage should cause the
 * orchestrator to pull the instance out of rotation rather than leaving it
 * serving denials indefinitely.
 */
let redisDegradedSince: number | null = null;

export function rateLimiterHealth(): {
  mode: RateLimitMode;
  redisDegraded: boolean;
  degradedSince: string | null;
} {
  const mode = resolveMode();
  return {
    mode,
    redisDegraded: mode === 'distributed' && redisDegradedSince !== null,
    degradedSince: redisDegradedSince
      ? new Date(redisDegradedSince).toISOString()
      : null,
  };
}

/**
 * Atomic fixed-window counter.
 *
 * Replaces the previous GET -> SET -> GET -> INCR sequence, which was neither
 * atomic (concurrent requests could each reset the window or each pass the
 * threshold before incrementing) nor correct (it never unwrapped the Upstash
 * `{ result }` envelope, so every parseInt produced NaN and no request was
 * ever denied).
 *
 * Returns { count, ttl } for the current window. EXPIRE is set only on the
 * first increment so the window does not slide forward under load.
 */
const WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

/**
 * Execute a Redis command via the Upstash REST API.
 *
 * Uses the POST/JSON-array form so arguments (including Lua source) are not
 * URL-path encoded, and unwraps the `{ result }` envelope.
 */
async function redisCommand(...args: (string | number)[]): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis not configured');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args.map(String)),
    signal: AbortSignal.timeout(3000),
  });

  if (!res.ok) throw new Error(`Redis error: ${res.status}`);

  const payload: unknown = await res.json();
  if (payload && typeof payload === 'object' && 'error' in payload) {
    throw new Error(`Redis error: ${String((payload as { error: unknown }).error)}`);
  }
  if (!payload || typeof payload !== 'object' || !('result' in payload)) {
    throw new Error('Redis error: malformed response (no result field)');
  }
  return (payload as { result: unknown }).result;
}

function localCheckRateLimit(
  key: string,
  maxRequests: number,
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const budget = localBudget(key, maxRequests);
  const entry = localStore.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    localStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfter: 0 };
  }

  if (entry.count >= budget) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  entry.count++;
  return { allowed: true, retryAfter: 0 };
}

/**
 * Core rate limiter — enforces threshold via one atomic Redis EVAL when in
 * distributed mode, otherwise falls back to local Map.
 *
 * Failure direction split by key class (Rule 5):
 *  - credential keys -> fail CLOSED (deny) when Redis is down, mark degraded
 *  - api:* and other availability keys -> fail OPEN (local) + log
 *
 * Degradation ordering (contract answer 2): redisDegradedSince is set BEFORE
 * the denied response is returned, so Gate F can assert ordering.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number = 30,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const mode = resolveMode();

  // single-instance: deliberately local only, even if credentials are present
  if (mode === 'single-instance') {
    return localCheckRateLimit(key, maxRequests);
  }

  // distributed: must use Redis atomically
  try {
    const redisKey = `ratelimit:${key}`;
    const raw = await redisCommand('EVAL', WINDOW_SCRIPT, '1', redisKey, String(WINDOW_SECONDS));

    // Upstash returns {result: [count, ttl]} where we unwrapped to [count, ttl]
    if (!Array.isArray(raw) || raw.length !== 2) {
      throw new Error('Redis error: malformed EVAL result (expected [count, ttl])');
    }

    const count = Number(raw[0]);
    const ttl = Number(raw[1]);

    if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
      throw new Error('Redis error: malformed EVAL result (non-numeric)');
    }

    // Success clears degradation immediately (answer 4)
    if (redisDegradedSince !== null) {
      redisDegradedSince = null;
    }

    const budget = localBudget(key, maxRequests);

    if (count > budget) {
      // Derive retryAfter from TTL per answer 3
      let retryAfter: number;
      if (ttl === -1) {
        console.warn(
          `[rate-limit] Redis TTL -1 for key ${key}: key has no expiry (Lua EXPIRE may have failed). Using ${WINDOW_SECONDS}s and key will not auto-expire.`,
        );
        retryAfter = WINDOW_SECONDS;
      } else if (ttl === -2) {
        // Key gone — window already expired, conservative
        retryAfter = WINDOW_SECONDS;
      } else if (ttl <= 0) {
        retryAfter = WINDOW_SECONDS;
      } else {
        retryAfter = ttl;
      }
      return { allowed: false, retryAfter };
    }

    return { allowed: true, retryAfter: 0 };
  } catch (err) {
    // Redis failure — set degradation BEFORE returning, per contract answer 2
    if (redisDegradedSince === null) {
      redisDegradedSince = Date.now();
    }

    if (isCredentialKey(key)) {
      // Fail CLOSED for credential keys
      console.warn('[rate-limit] Redis error, failing closed for credential key:', key, err);
      return { allowed: false, retryAfter: WINDOW_SECONDS };
    }

    // Fail OPEN for availability keys — local fallback + error log
    console.warn('[rate-limit] Redis error, falling back to local for availability key:', key, err);
    return localCheckRateLimit(key, maxRequests);
  }
}

export function rateLimitResponse(retryAfter: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests. Please wait before trying again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}
