import { describe, it, expect } from 'vitest';
import {
  normalizeSupabaseKey,
  normalizeSupabaseUrl,
} from '@elogbook/env/supabase-url';

/**
 * A quoted or scheme-less NEXT_PUBLIC_SUPABASE_URL used to crash the proxy
 * (MIDDLEWARE_INVOCATION_FAILED on every dynamic route) and the node boot
 * contract (process exit 1). These shapes are what the Vercel dashboard
 * actually produces when a value is pasted, so they must be normalised.
 */
describe('normalizeSupabaseUrl', () => {
  it('keeps a plain https URL and drops the trailing slash', () => {
    expect(normalizeSupabaseUrl('https://ref.supabase.co')).toEqual({
      ok: true,
      url: 'https://ref.supabase.co',
    });
    expect(normalizeSupabaseUrl('https://ref.supabase.co/')).toEqual({
      ok: true,
      url: 'https://ref.supabase.co',
    });
  });

  it('unwraps a quoted paste', () => {
    expect(normalizeSupabaseUrl('"https://ref.supabase.co"')).toEqual({
      ok: true,
      url: 'https://ref.supabase.co',
    });
    expect(normalizeSupabaseUrl("'https://ref.supabase.co'")).toEqual({
      ok: true,
      url: 'https://ref.supabase.co',
    });
  });

  it('trims whitespace and newlines', () => {
    expect(normalizeSupabaseUrl('  https://ref.supabase.co\n')).toEqual({
      ok: true,
      url: 'https://ref.supabase.co',
    });
  });

  it('adds https:// when the scheme was omitted', () => {
    expect(normalizeSupabaseUrl('ref.supabase.co')).toEqual({
      ok: true,
      url: 'https://ref.supabase.co',
    });
    expect(normalizeSupabaseUrl('"ref.supabase.co"')).toEqual({
      ok: true,
      url: 'https://ref.supabase.co',
    });
  });

  it('uses http:// for loopback deployments', () => {
    expect(normalizeSupabaseUrl('localhost:54321')).toEqual({
      ok: true,
      url: 'http://localhost:54321',
    });
    expect(normalizeSupabaseUrl('127.0.0.1:54321')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:54321',
    });
  });

  it('reports a missing value as missing', () => {
    for (const value of [undefined, null, '', '   ', '""']) {
      expect(normalizeSupabaseUrl(value)).toMatchObject({
        ok: false,
        kind: 'missing',
      });
    }
  });

  it('rejects values it cannot repair', () => {
    for (const value of ['::::', 'ftp://ref.supabase.co', 'https://', 'a"b']) {
      const result = normalizeSupabaseUrl(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('invalid');
    }
  });

  it('never echoes the value in the reason', () => {
    const result = normalizeSupabaseUrl('not a url at all');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain('not a url');
  });
});

describe('normalizeSupabaseKey', () => {
  it('unwraps a quoted key and trims whitespace', () => {
    expect(normalizeSupabaseKey(' "abc.def.ghi" ')).toBe('abc.def.ghi');
    expect(normalizeSupabaseKey("'abc'")).toBe('abc');
  });

  it('returns an empty string for a missing key', () => {
    expect(normalizeSupabaseKey(undefined)).toBe('');
    expect(normalizeSupabaseKey('  ')).toBe('');
  });
});
