import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit, rateLimitResponse } from '../rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows first request for a new key', () => {
    const result = checkRateLimit('ip:127.0.0.1', 5);
    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBe(0);
  });

  it('allows requests within the limit', () => {
    const key = 'ip:10.0.0.1';
    expect(checkRateLimit(key, 3).allowed).toBe(true);
    expect(checkRateLimit(key, 3).allowed).toBe(true);
    expect(checkRateLimit(key, 3).allowed).toBe(true);
  });

  it('blocks requests exceeding the limit', () => {
    const key = 'ip:10.0.0.2';
    checkRateLimit(key, 2);
    checkRateLimit(key, 2);
    const result = checkRateLimit(key, 2);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  });

  it('returns non-zero retryAfter when blocked', () => {
    const key = 'ip:10.0.0.3';
    checkRateLimit(key, 1);
    const result = checkRateLimit(key, 1);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('resets window after 60 seconds', () => {
    const key = 'ip:10.0.0.4';
    expect(checkRateLimit(key, 1).allowed).toBe(true);
    const result = checkRateLimit(key, 1);
    expect(result.allowed).toBe(false);

    // Advance past the 60s window
    vi.advanceTimersByTime(61_000);

    const afterWindow = checkRateLimit(key, 1);
    expect(afterWindow.allowed).toBe(true);
  });

  it('uses default maxRequests of 30', () => {
    const key = 'ip:10.0.0.5';
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit(key).allowed).toBe(true);
    }
    expect(checkRateLimit(key).allowed).toBe(false);
  });

  it('handles different keys independently', () => {
    expect(checkRateLimit('user:1', 1).allowed).toBe(true);
    expect(checkRateLimit('user:2', 1).allowed).toBe(true);
    expect(checkRateLimit('user:1', 1).allowed).toBe(false);
    expect(checkRateLimit('user:2', 1).allowed).toBe(false);
  });
});

describe('rateLimitResponse', () => {
  it('returns a 429 JSON response with retry-after header', async () => {
    const res = rateLimitResponse(30);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
