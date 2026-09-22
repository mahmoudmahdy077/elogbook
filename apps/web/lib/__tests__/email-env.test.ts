// apps/web/lib/__tests__/email-env.test.ts
import { describe, it, expect } from 'vitest';
import { parseWebFullEnv } from '@elogbook/env';

describe('email env', () => {
  it('rejects production without RESEND_API_KEY in resend+smtp mode', () => {
    const base = { NEXT_PUBLIC_SUPABASE_URL: 'http://x', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 'k', NODE_ENV: 'production', RATE_LIMIT_MODE: 'single-instance', TRUSTED_PROXY_HOPS: 1, EMAIL_PROVIDER: 'resend+smtp' };
    expect(() => parseWebFullEnv(base as unknown as Record<string, string | undefined>)).toThrow(/RESEND_API_KEY/);
  });
});
