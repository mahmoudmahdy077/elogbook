import { describe, it, expect } from 'vitest';
import { deriveCookieProjectRef, authCookieName } from '../e2e-cookie';

// T02: the E2E auth cookie name must match the app's @supabase/ssr default
// for cloud, custom-domain, and local origins — never silently empty.
describe('deriveCookieProjectRef (T02)', () => {
  it('cloud project URL yields the project ref', () => {
    expect(deriveCookieProjectRef('https://nuyedxkzaimlzaetbpaw.supabase.co')).toBe(
      'nuyedxkzaimlzaetbpaw',
    );
    expect(authCookieName('https://nuyedxkzaimlzaetbpaw.supabase.co')).toBe(
      'sb-nuyedxkzaimlzaetbpaw-auth-token',
    );
  });

  it('self-hosted custom domain yields the first hostname label', () => {
    expect(deriveCookieProjectRef('https://api.example.com')).toBe('api');
    expect(authCookieName('https://api.example.com')).toBe('sb-api-auth-token');
  });

  it('local Supabase yields a deterministic non-empty ref', () => {
    expect(authCookieName('http://127.0.0.1:54321')).toBe('sb-127-auth-token');
    expect(authCookieName('http://localhost:54321')).toBe('sb-localhost-auth-token');
  });

  it('never produces the old silent-failure name sb--auth-token', () => {
    for (const url of [
      'https://abc.supabase.co',
      'https://api.example.com',
      'http://127.0.0.1:54321',
      'http://localhost:54321',
    ]) {
      expect(authCookieName(url)).not.toBe('sb--auth-token');
    }
  });

  it('invalid URL throws instead of returning an empty ref', () => {
    expect(() => deriveCookieProjectRef('not-a-url')).toThrow();
    expect(() => deriveCookieProjectRef('')).toThrow();
  });
});
