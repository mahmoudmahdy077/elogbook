import { describe, it, expect } from 'vitest';
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
});

describe('defaultTrustedOrigins', () => {
  it('includes the request URL origin', () => {
    const req = new Request('https://my-deploy.example.com/x', { method: 'GET' });
    const origins = defaultTrustedOrigins(req);
    expect(origins).toContain('https://my-deploy.example.com');
  });
});
