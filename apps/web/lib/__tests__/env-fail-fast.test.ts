import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseWebServerEnv, parseWebPublicEnv } from '@elogbook/env';

describe('env validation — SEC-008', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('parseWebServerEnv throws if NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => parseWebPublicEnv(process.env)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/i);
  });

  it('parseWebServerEnv throws if SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => parseWebServerEnv(process.env)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/i);
  });

  it('createServiceRoleClient throws if env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const mod = await import('@/lib/supabase/admin');
    expect(() => mod.createServiceRoleClient()).toThrow();
  });
});
