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

  it('allows a fresh key after the window has expired for another key', () => {
    const key1 = 'ip:10.0.0.6';
    const key2 = 'ip:10.0.0.7';

    checkRateLimit(key1, 1);
    expect(checkRateLimit(key1, 1).allowed).toBe(false);

    // key2 should be fresh even though key1 is blocked
    expect(checkRateLimit(key2, 1).allowed).toBe(true);

    // advance time past window, key1 should reset
    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit(key1, 1).allowed).toBe(true);
  });

  it('handles maxRequests = 1', () => {
    const key = 'ip:10.0.0.8';
    expect(checkRateLimit(key, 1).allowed).toBe(true);
    expect(checkRateLimit(key, 1).allowed).toBe(false);
    expect(checkRateLimit(key, 1).retryAfter).toBeGreaterThan(0);
  });

  it('handles maxRequests = 1 correctly', () => {
    const key = 'test-max-1';
    const first = checkRateLimit(key, 1);
    expect(first.allowed).toBe(true);
    const second = checkRateLimit(key, 1);
    expect(second.allowed).toBe(false);
  });

  it('resets exactly at the window boundary (60s exactly)', () => {
    const key = 'ip:10.0.0.10';
    checkRateLimit(key, 1);
    expect(checkRateLimit(key, 1).allowed).toBe(false);

    // Advance exactly to the window boundary (60,000ms)
    vi.advanceTimersByTime(60_000);

    // At exactly 60s, now - windowStart = 60000, which is NOT > WINDOW_MS (60000)
    // so the window has NOT expired yet
    const atBoundary = checkRateLimit(key, 1);
    expect(atBoundary.allowed).toBe(false);

    // One more ms
    vi.advanceTimersByTime(1);
    expect(checkRateLimit(key, 1).allowed).toBe(true);
  });

  it('returns retryAfter of at most 60 seconds when blocked', () => {
    const key = 'ip:10.0.0.11';
    checkRateLimit(key, 1);
    // Immediately after being blocked, retryAfter should be ~60
    const result = checkRateLimit(key, 1);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
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

  it('includes the expected error message in the body', async () => {
    const res = rateLimitResponse(15);
    const body = await res.json();
    expect(body.error).toBe('Too many requests. Please wait before trying again.');
  });

  it('returns correct retry-after header for various values', async () => {
    const res1 = rateLimitResponse(0);
    expect(res1.headers.get('Retry-After')).toBe('0');

    const res2 = rateLimitResponse(120);
    expect(res2.headers.get('Retry-After')).toBe('120');

    const res3 = rateLimitResponse(60);
    expect(res3.headers.get('Retry-After')).toBe('60');
  });

  it('returns a JSON content-type response', async () => {
    const res = rateLimitResponse(30);
    const contentType = res.headers.get('content-type');
    expect(contentType).toMatch(/application\/json/);
  });
});
