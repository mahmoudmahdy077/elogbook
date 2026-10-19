import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSetupEnv, parseWebServerEnv, parseWebPublicEnv } from '@elogbook/env';

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

  it('accepts the dedicated setup phase without the full web environment', () => {
    const setup = {
      SETUP_MODE: 'true',
      SETUP_PHASE: 'setup',
      SETUP_BIND_ADDRESS: '127.0.0.1',
      SETUP_REMOTE_TLS_REQUIRED: 'true',
      APP_RELEASE_COMMIT: 'a'.repeat(40),
      NODE_ENV: 'development',
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    };
    expect(() => parseSetupEnv(setup)).not.toThrow();
  });

  it('rejects production setup and a missing or invalid release commit', () => {
    const setup = {
      SETUP_MODE: 'true',
      SETUP_PHASE: 'setup',
      SETUP_BIND_ADDRESS: '127.0.0.1',
      SETUP_REMOTE_TLS_REQUIRED: 'true',
      APP_RELEASE_COMMIT: 'a'.repeat(40),
    };
    expect(() => parseSetupEnv({ ...setup, NODE_ENV: 'production' })).toThrow(/NODE_ENV/);
    expect(() => parseSetupEnv({ ...setup, APP_RELEASE_COMMIT: undefined })).toThrow(/APP_RELEASE_COMMIT/);
    expect(() => parseSetupEnv({ ...setup, APP_RELEASE_COMMIT: 'not-a-commit' })).toThrow(/APP_RELEASE_COMMIT/);
  });

  it('setup phase rejects an invalid bind address or phase', () => {
    const base = {
      SETUP_MODE: 'true',
      SETUP_PHASE: 'setup',
      SETUP_BIND_ADDRESS: '127.0.0.1',
      SETUP_REMOTE_TLS_REQUIRED: 'true',
      APP_RELEASE_COMMIT: 'a'.repeat(40),
      NODE_ENV: 'development',
    };
    expect(() => parseSetupEnv({ ...base, SETUP_BIND_ADDRESS: '0.0.0.0' })).toThrow(/SETUP_BIND_ADDRESS/);
    expect(() => parseSetupEnv({ ...base, SETUP_PHASE: 'runtime' })).toThrow(/SETUP_PHASE/);
  });

  it('createServiceRoleClient throws if env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const mod = await import('@/lib/supabase/admin');
    expect(() => mod.createServiceRoleClient()).toThrow();
  });
});
