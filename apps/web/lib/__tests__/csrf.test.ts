import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateOrigin, defaultTrustedOrigins } from '../csrf';

function makeRequest(method: string, headers: Record<string, string> = {}): Request {
  return new Request('https://app.elogbook.dev/some/path', {
    method,
    headers,
  });
}

describe('validateOrigin', () => {
  it('skips GET requests', () => {
    const res = validateOrigin(makeRequest('GET'), ['https://app.elogbook.dev']);
    expect(res).toBeNull();
  });

  it('skips HEAD requests', () => {
    const res = validateOrigin(makeRequest('HEAD'), ['https://app.elogbook.dev']);
    expect(res).toBeNull();
  });

  it('skips OPTIONS requests', () => {
    const res = validateOrigin(makeRequest('OPTIONS'), ['https://app.elogbook.dev']);
    expect(res).toBeNull();
  });

  it('rejects POST without origin or referer', () => {
    const res = validateOrigin(makeRequest('POST'), ['https://app.elogbook.dev']);
    expect(res?.status).toBe(403);
  });

  it('rejects POST with a disallowed origin', () => {
    const res = validateOrigin(
      makeRequest('POST', { origin: 'https://evil.com' }),
      ['https://app.elogbook.dev'],
    );
    expect(res?.status).toBe(403);
  });

  it('rejects POST with a protocol-mismatch referer', () => {
    const res = validateOrigin(
      makeRequest('POST', { referer: 'https://evil.com/path' }),
      ['https://app.elogbook.dev'],
    );
    expect(res?.status).toBe(403);
  });

  it('allows POST with an allowed origin', () => {
    const res = validateOrigin(
      makeRequest('POST', { origin: 'https://app.elogbook.dev' }),
      ['https://app.elogbook.dev'],
    );
    expect(res).toBeNull();
  });

  it('allows POST when origin matches a wildcard allowed origin', () => {
    const res = validateOrigin(
      makeRequest('POST', { origin: 'https://app.elogbook.dev' }),
      ['*'],
    );
    expect(res).toBeNull();
  });

  it('falls back to Referer when Origin is missing', () => {
    const res = validateOrigin(
      makeRequest('POST', { referer: 'https://app.elogbook.dev/page' }),
      ['https://app.elogbook.dev'],
    );
    expect(res).toBeNull();
  });

  // --- Additional edge cases ---

  it('rejects PUT without origin or referer', () => {
    const res = validateOrigin(makeRequest('PUT'), ['https://app.elogbook.dev']);
    expect(res?.status).toBe(403);
  });

  it('rejects DELETE without origin or referer', () => {
    const res = validateOrigin(makeRequest('DELETE'), ['https://app.elogbook.dev']);
    expect(res?.status).toBe(403);
  });

  it('rejects PATCH without origin or referer', () => {
    const res = validateOrigin(makeRequest('PATCH'), ['https://app.elogbook.dev']);
    expect(res?.status).toBe(403);
  });

  it('allows PUT with allowed origin', () => {
    const res = validateOrigin(
      makeRequest('PUT', { origin: 'https://app.elogbook.dev' }),
      ['https://app.elogbook.dev'],
    );
    expect(res).toBeNull();
  });

  it('allows DELETE with allowed origin', () => {
    const res = validateOrigin(
      makeRequest('DELETE', { origin: 'https://app.elogbook.dev' }),
      ['https://app.elogbook.dev'],
    );
    expect(res).toBeNull();
  });

  it('allows PATCH with allowed origin', () => {
    const res = validateOrigin(
      makeRequest('PATCH', { origin: 'https://app.elogbook.dev' }),
      ['https://app.elogbook.dev'],
    );
    expect(res).toBeNull();
  });

  it('returns 403 error message when origin is missing', async () => {
    const res = validateOrigin(makeRequest('POST'), ['https://app.elogbook.dev']);
    const body = await res!.json();
    expect(body.error).toBe('Origin required for state-changing requests');
  });

  it('returns 403 error message when origin is not allowed', async () => {
    const res = validateOrigin(
      makeRequest('POST', { origin: 'https://evil.com' }),
      ['https://app.elogbook.dev'],
    );
    const body = await res!.json();
    expect(body.error).toBe('Origin not allowed');
  });

  it('handles referer with no valid URL gracefully (invalid URL string)', () => {
    // If referer is a malformed URL, new URL() will throw
    const req = new Request('https://app.elogbook.dev/some/path', {
      method: 'POST',
      headers: { referer: 'not-a-valid-url' },
    });
    // Should throw because new URL('not-a-valid-url') fails
    expect(() => validateOrigin(req, ['https://app.elogbook.dev'])).toThrow();
  });

  it('handles case-insensitive method matching (lowercase)', () => {
    // Request constructor uppercases methods, but test with lowercase via headers
    const req = new Request('https://app.elogbook.dev/some/path', {
      method: 'post',
      headers: { origin: 'https://app.elogbook.dev' },
    });
    const res = validateOrigin(req, ['https://app.elogbook.dev']);
    expect(res).toBeNull();
  });

  it('returns null when trusted origins is empty and origin matches no one', () => {
    // When trustedOrigins is empty, POST without origin fails
    const req = makeRequest('POST', { origin: 'https://any-origin.com' });
    const res = validateOrigin(req, []);
    expect(res?.status).toBe(403);
  });
});

describe('defaultTrustedOrigins', () => {
  it('includes the request URL origin', () => {
    const req = new Request('https://my-deploy.example.com/x', { method: 'GET' });
    const origins = defaultTrustedOrigins(req);
    expect(origins).toContain('https://my-deploy.example.com');
  });

  it('includes NEXT_PUBLIC_SITE_URL when set', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://custom-site.example.com');
    const req = new Request('https://app.elogbook.dev/x', { method: 'GET' });
    const origins = defaultTrustedOrigins(req);
    expect(origins).toContain('https://custom-site.example.com');
    vi.unstubAllEnvs();
  });

  it('returns only the request origin when NEXT_PUBLIC_SITE_URL is not set', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const req = new Request('https://my-deploy.example.com/x', { method: 'GET' });
    const origins = defaultTrustedOrigins(req);
    expect(origins).toEqual(['https://my-deploy.example.com']);
    vi.unstubAllEnvs();
  });

  it('does not duplicate origins when request URL matches site URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://same-site.example.com');
    const req = new Request('https://same-site.example.com/x', { method: 'GET' });
    const origins = defaultTrustedOrigins(req);
    // Should contain the origin only once (Set dedup)
    expect(origins).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  it('handles malformed request URL gracefully', () => {
    const req = new Request('https://valid.example.com/x', { method: 'GET' });
    // Stub the URL property to throw
    Object.defineProperty(req, 'url', { get: () => 'not-a-valid-url' });
    const origins = defaultTrustedOrigins(req);
    // Should still work, just not add the invalid URL origin
    expect(origins).toEqual([]);
  });

  it('returns an array with string elements', () => {
    const req = new Request('https://app.elogbook.dev/path', { method: 'GET' });
    const origins = defaultTrustedOrigins(req);
    expect(Array.isArray(origins)).toBe(true);
    origins.forEach((o) => expect(typeof o).toBe('string'));
  });
});
