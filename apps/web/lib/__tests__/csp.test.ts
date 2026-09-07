import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { supabaseCspOrigins, buildCsp } from '../csp';

// T06/F07: the same image must work with a custom self-hosted Supabase
// origin. CSP is built per request (proxy runs server-side), so the
// configured origin belongs in the policy — not only *.supabase.co.
describe('supabaseCspOrigins (T06)', () => {
  const OLD = process.env.NEXT_PUBLIC_SUPABASE_URL;

  afterEach(() => {
    if (OLD === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = OLD;
  });

  it('cloud URL needs no extra origins beyond the base allowlist', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://xyz.supabase.co';
    expect(supabaseCspOrigins()).toEqual([]);
  });

  it('custom https origin yields https + wss variants with port', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://api.example.com:8443';
    expect(supabaseCspOrigins()).toEqual([
      'https://api.example.com:8443',
      'wss://api.example.com:8443',
    ]);
  });

  it('custom http origin yields http + ws variants (local self-host)', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://192.168.1.10:8000';
    expect(supabaseCspOrigins()).toEqual(['http://192.168.1.10:8000', 'ws://192.168.1.10:8000']);
  });

  it('garbage or non-http(s) values contribute nothing (no injection)', () => {
    for (const bad of ['', 'not-a-url', 'javascript:alert(1)', 'ftp://files.example.com/x', 'https://']) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = bad;
      expect(supabaseCspOrigins()).toEqual([]);
    }
  });

  it('unset env contributes nothing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(supabaseCspOrigins()).toEqual([]);
  });
});

describe('buildCsp (T06)', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it('keeps the base allowlist and never emits undefined', () => {
    const csp = buildCsp('nonce-1');
    expect(csp).toContain('https://*.supabase.co');
    expect(csp).toContain('wss://*.supabase.co');
    expect(csp).toContain('nonce-nonce-1');
    expect(csp).not.toContain('undefined');
  });

  it('includes a custom origin in connect-src and img-src', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://api.example.com';
    const csp = buildCsp('n');
    expect(csp).toContain('https://api.example.com');
    expect(csp).toContain('wss://api.example.com');
  });
});
