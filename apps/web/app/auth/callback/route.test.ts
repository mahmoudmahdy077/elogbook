import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  getServerVerifiedAal: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

vi.mock('@/lib/supabase/security-context', () => ({
  getServerVerifiedAal: mocks.getServerVerifiedAal,
}));

import { GET } from './route';

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

function request(next: string, code = 'valid-code'): Request {
  return new Request(`https://attacker.example/auth/callback?code=${code}&next=${encodeURIComponent(next)}`);
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.elogbook.test/base';
    mocks.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.getServerVerifiedAal.mockResolvedValue('aal1');
    mocks.createServerSupabase.mockResolvedValue({
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
        getUser: mocks.getUser,
        getSession: vi.fn(),
        mfa: { listFactors: vi.fn() },
      },
      from: vi.fn(),
    });
  });

  afterEach(() => {
    if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  });

  it('redirects successful callbacks to the configured site origin, not the request host', async () => {
    const response = await GET(request('/dashboard'));

    expect(response.headers.get('location')).toBe('https://app.elogbook.test/dashboard');
  });

  it.each([
    'javascript:alert(1)',
    'https://evil.example/dashboard',
    '//evil.example/dashboard',
    '/\\evil.example/dashboard',
  ])('falls back within the configured app origin for unsafe next value %s', async (next) => {
    const response = await GET(request(next));

    expect(response.headers.get('location')).toBe('https://app.elogbook.test/dashboard');
  });

  it('redirects failed callbacks to the configured site origin', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ data: null, error: new Error('invalid code') });

    const response = await GET(request('/dashboard', 'invalid-code'));

    expect(response.headers.get('location')).toBe('https://app.elogbook.test/login?error=auth_failed');
  });
});
