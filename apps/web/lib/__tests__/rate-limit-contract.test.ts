import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Contract from PRODUCTION_UPGRADE_PLAN.md TICKET-001 §V — stated once here.
// Every row is a behavioral assertion, never a count.

describe('rate-limit contract (TICKET-001)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-expect-error global fetch mock
    global.fetch = fetchMock;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function loadModule(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) vi.stubEnv(k, '');
      else vi.stubEnv(k, v);
    }
    // Ensure NODE_ENV is stubbed correctly for the module
    if (env.NODE_ENV) vi.stubEnv('NODE_ENV', env.NODE_ENV);
    // Force re-evaluation of process.env via stubEnv
    // Re-mock fetch after reset
    // @ts-expect-error global fetch mock
    global.fetch = fetchMock;
    const mod = await import('../rate-limit-redis');
    mod.__resetRateLimiterForTests();
    return mod;
  }

  const WINDOW_SCRIPT_SNIPPET = "redis.call('INCR'";

  // Row 1: single-instance any env -> local Map, credential budget ≤5
  it('single-instance uses local Map and caps credential keys at 5', async () => {
    const mod = await loadModule({
      NODE_ENV: 'development',
      RATE_LIMIT_MODE: 'single-instance',
    });

    // api: key full budget
    for (let i = 0; i < 30; i++) {
      const r = await mod.checkRateLimit('api:1.2.3.4', 30);
      expect(r.allowed).toBe(true);
    }
    expect((await mod.checkRateLimit('api:1.2.3.4', 30)).allowed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    // login: capped at 5 even if maxRequests 30
    fetchMock.mockClear();
    const credKey = 'login:1.2.3.4';
    for (let i = 0; i < 5; i++) {
      expect((await mod.checkRateLimit(credKey, 30)).allowed).toBe(true);
    }
    expect((await mod.checkRateLimit(credKey, 30)).allowed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Row 2: distributed Redis healthy -> atomic EVAL, unwrapped, TTL derived
  it('distributed healthy: uses EVAL POST JSON-array and unwraps {result:[count,ttl]}', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
    });

    // First request: count 1, ttl 60 -> allowed
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: [1, 60] }),
    } as Response);

    const r1 = await mod.checkRateLimit('api:1.2.3.4', 30);
    expect(r1.allowed).toBe(true);
    expect(r1.retryAfter).toBe(0);

    // Verify wire shape: POST to UPSTASH url with body ["EVAL", <lua>, "1", <key>, "60"]
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://test.upstash.io');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as unknown[];
    expect(body[0]).toBe('EVAL');
    expect(String(body[1])).toContain(WINDOW_SCRIPT_SNIPPET);
    expect(body[2]).toBe('1');
    expect(body[3]).toBe('ratelimit:api:1.2.3.4');
    expect(body[4]).toBe('60');

    // Denied case: count 31 with budget 30 -> denied, retryAfter = ttl
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: [31, 42] }),
    } as Response);
    const r2 = await mod.checkRateLimit('api:1.2.3.4', 30);
    expect(r2.allowed).toBe(false);
    expect(r2.retryAfter).toBe(42);
  });

  // D-2 cell: malformed envelope must be treated as error (never NaN)
  it('D-2: malformed envelope without result throws and is handled as Redis error', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
    });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ foo: 'bar' }),
    } as Response);

    // For api: key, malformed should fall back to local (open) — not NaN window
    const rApi = await mod.checkRateLimit('api:9.9.9.9', 30);
    expect(rApi.allowed).toBe(true); // first local request allowed
    // degraded flag must be set before return (answer 2)
    expect(mod.rateLimiterHealth().redisDegraded).toBe(true);

    // For credential key, malformed must deny (closed)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ foo: 'bar' }),
    } as Response);
    const rCred = await mod.checkRateLimit('login:9.9.9.9', 30);
    expect(rCred.allowed).toBe(false);
    expect(rCred.retryAfter).toBe(60);
  });

  it('D-2: result shape [31] denominator must deny via ttl handling, not NaN', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'tok',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: [31, 10] }),
    } as Response);
    const r = await mod.checkRateLimit('api:x', 30);
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBe(10);
  });

  // TTL handling: -1 logs, -2 silent, both 60
  it('TTL -1 and -2 both map to 60, -1 logs', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      UPSTASH_REDIS_REST_URL: 'https://u.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: [31, -1] }),
    } as Response);
    const r1 = await mod.checkRateLimit('api:ttl1', 30);
    expect(r1.allowed).toBe(false);
    expect(r1.retryAfter).toBe(60);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TTL -1'));

    warnSpy.mockClear();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: [31, -2] }),
    } as Response);
    const r2 = await mod.checkRateLimit('api:ttl2', 30);
    expect(r2.allowed).toBe(false);
    expect(r2.retryAfter).toBe(60);
    // -2 does not log the same message (only -1 does)
    const ttlWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('TTL -1'));
    expect(ttlWarns.length).toBe(0);
    warnSpy.mockRestore();
  });

  // Degradation ordering: set before returning denied request
  it('degradation is set BEFORE returning denied credential request (answer 2)', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      UPSTASH_REDIS_REST_URL: 'https://u.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
    });
    fetchMock.mockRejectedValue(new Error('network down'));
    const r = await mod.checkRateLimit('login:degrade', 30);
    expect(r.allowed).toBe(false);
    // health must already be degraded at this point
    expect(mod.rateLimiterHealth().redisDegraded).toBe(true);
    expect(mod.rateLimiterHealth().degradedSince).not.toBeNull();
  });

  // Clearing degradation on next success
  it('clears degradation immediately on next successful Redis call (answer 4)', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      UPSTASH_REDIS_REST_URL: 'https://u.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
    });
    fetchMock.mockRejectedValue(new Error('down'));
    await mod.checkRateLimit('login:x', 30);
    expect(mod.rateLimiterHealth().redisDegraded).toBe(true);

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ result: [1, 60] }),
    } as Response);
    const r = await mod.checkRateLimit('api:y', 30);
    expect(r.allowed).toBe(true);
    expect(mod.rateLimiterHealth().redisDegraded).toBe(false);
    expect(mod.rateLimiterHealth().degradedSince).toBeNull();
  });

  // Distributed Redis down: api open, login closed
  it('distributed Redis down: api falls back local (open), login denied (closed)', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      UPSTASH_REDIS_REST_URL: 'https://u.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
    });
    fetchMock.mockRejectedValue(new Error('timeout'));

    const rApi = await mod.checkRateLimit('api:1.1.1.1', 30);
    expect(rApi.allowed).toBe(true); // local first hit

    const rLogin = await mod.checkRateLimit('login:1.1.1.1', 30);
    expect(rLogin.allowed).toBe(false);
    expect(rLogin.retryAfter).toBe(60);
    expect(mod.rateLimiterHealth().redisDegraded).toBe(true);
  });

  // Row 4: unset in prod -> throw (boot hook)
  it('RATE_LIMIT_MODE unset in production throws (boot must exit non-zero)', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      // no RATE_LIMIT_MODE
      UPSTASH_REDIS_REST_URL: 'https://u.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
    });
    expect(() => mod.resolveMode()).toThrow(/RATE_LIMIT_MODE is required in production/);
  });

  it('RATE_LIMIT_MODE=distributed without creds throws', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      // missing UPSTASH vars
    });
    expect(() => mod.resolveMode()).toThrow(/requires UPSTASH_REDIS_REST_URL/);
  });

  // Row 5: unset in dev/test defaults single-instance
  it('unset in dev defaults single-instance', async () => {
    const mod = await loadModule({
      NODE_ENV: 'development',
    });
    expect(mod.resolveMode()).toBe('single-instance');
    const r = await mod.checkRateLimit('api:dev', 30);
    expect(r.allowed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Row 7: single-instance with creds present -> ignore creds, local, warn once
  it('single-instance with Upstash creds ignores them and warns once', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'single-instance',
      UPSTASH_REDIS_REST_URL: 'https://u.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
    });
    // resolveMode called during load? We call explicitly to trigger warning
    mod.resolveMode();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('credentials are ignored'));

    warnSpy.mockClear();
    // second call should not warn again (memoised)
    mod.resolveMode();
    expect(warnSpy).not.toHaveBeenCalled();

    // checkRateLimit must NOT call fetch
    const r = await mod.checkRateLimit('api:creds', 30);
    expect(r.allowed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // Redis {error: ...} payload throws
  it('Upstash {error: ...} payload is treated as Redis error', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      UPSTASH_REDIS_REST_URL: 'https://u.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'READONLY' }),
    } as Response);
    const r = await mod.checkRateLimit('login:err', 30);
    expect(r.allowed).toBe(false);
    expect(mod.rateLimiterHealth().redisDegraded).toBe(true);
  });

  // HTTP error from Redis
  it('Redis HTTP error is treated as failure', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      UPSTASH_REDIS_REST_URL: 'https://u.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);
    const r = await mod.checkRateLimit('api:http500', 30);
    expect(r.allowed).toBe(true); // api fallback
    expect(mod.rateLimiterHealth().redisDegraded).toBe(true);
  });

  // Every key prefix actually used: ensure api and credential prefixes are distinguished
  it('every key class in CREDENTIAL_KEY_PREFIXES fails closed, others open', async () => {
    const prefixes = [
      'login:',
      'auth-cb:',
      'invite:',
      'assign-role:',
      'sso:',
      'request-verification:',
    ];
    for (const p of prefixes) {
      const mod = await loadModule({
        NODE_ENV: 'production',
        RATE_LIMIT_MODE: 'distributed',
        UPSTASH_REDIS_REST_URL: 'https://u.io',
        UPSTASH_REDIS_REST_TOKEN: 't',
      });
      fetchMock.mockRejectedValue(new Error('down'));
      const r = await mod.checkRateLimit(`${p}1.2.3.4`, 30);
      expect(r.allowed, `prefix ${p} should deny`).toBe(false);
    }
    // non-credential like api: and unknown
    const mod2 = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      UPSTASH_REDIS_REST_URL: 'https://u.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
    });
    fetchMock.mockRejectedValue(new Error('down'));
    expect((await mod2.checkRateLimit('api:1.1.1.1', 30)).allowed).toBe(true);
    expect((await mod2.checkRateLimit('other:1.1.1.1', 30)).allowed).toBe(true);
  });

  // Gate F: credential keys never silently degrade to local Map
  it('credential keys never use local Map in distributed degraded mode', async () => {
    const mod = await loadModule({
      NODE_ENV: 'production',
      RATE_LIMIT_MODE: 'distributed',
      UPSTASH_REDIS_REST_URL: 'https://u.io',
      UPSTASH_REDIS_REST_TOKEN: 't',
    });
    fetchMock.mockRejectedValue(new Error('down'));
    // Fill local budget for login: would be 5 if it used Map — but we deny outright
    for (let i = 0; i < 6; i++) {
      const r = await mod.checkRateLimit('login:same', 30);
      expect(r.allowed).toBe(false);
    }
    // Should have called fetch each time (attempted Redis), not local
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
