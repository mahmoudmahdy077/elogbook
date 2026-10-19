import { describe, expect, it } from 'vitest';
import { parseWebFullEnv } from '@elogbook/env';

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_SITE_URL: 'https://elogbook.example',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  NODE_ENV: 'production',
  RATE_LIMIT_MODE: 'single-instance',
  TRUSTED_PROXY_HOPS: '1',
  EMAIL_ENABLED: 'true',
  EMAIL_PROVIDER: 'resend+smtp',
  EMAIL_FROM_ADDRESS: 'noreply@elogbook.example',
  EMAIL_FROM_NAME: 'E-Logbook',
  EMAIL_REPLY_TO: 'support@elogbook.example',
  EMAIL_DATA_ENCRYPTION_KEYS: '{"1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}',
  EMAIL_DATA_ACTIVE_KEY_VERSION: '1',
  EMAIL_LOOKUP_HMAC_KEY: 'lookup-secret-with-at-least-32-bytes',
  EMAIL_TOKEN_SIGNING_SECRET: 'token-secret-with-at-least-32-bytes',
  EMAIL_CRON_SECRET: 'cron-secret-with-at-least-32-bytes',
  RESEND_API_KEY: 'resend-key',
  RESEND_WEBHOOK_SECRET: ['test-only-', 'webhook-', 'fixture-', 'not-a-real-secret'].join(''),
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'smtp-user',
  SMTP_PASS: 'smtp-pass',
  CONTACT_ALERT_TO: 'alerts@elogbook.example',
  EMAIL_RATE_PER_MIN: '60',
} satisfies Record<string, string>;

describe('email environment', () => {
  it('accepts the complete production contract', () => {
    expect(parseWebFullEnv(valid).EMAIL_FROM_ADDRESS).toBe('noreply@elogbook.example');
  });

  it('rejects localhost callback URLs in production', () => {
    expect(() => parseWebFullEnv({ ...valid, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).toThrow(/HTTPS/);
  });

  it('rejects display-name sender values in EMAIL_FROM_ADDRESS', () => {
    expect(() => parseWebFullEnv({ ...valid, EMAIL_FROM_ADDRESS: 'E-Logbook <noreply@elogbook.example>' })).toThrow();
  });

  it('requires Resend credentials when Resend is enabled', () => {
    const { RESEND_API_KEY: _removed, ...withoutResend } = valid;
    expect(() => parseWebFullEnv(withoutResend)).toThrow(/RESEND_API_KEY/);
  });

  it('requires SMTP credentials when failover is enabled', () => {
    const { SMTP_HOST: _removed, ...withoutSmtp } = valid;
    expect(() => parseWebFullEnv(withoutSmtp)).toThrow(/SMTP_HOST/);
  });

  it('rejects production when encryption keys are missing', () => {
    const { EMAIL_DATA_ENCRYPTION_KEYS: _removed, ...withoutKeys } = valid;
    expect(() => parseWebFullEnv(withoutKeys)).toThrow(/EMAIL_DATA_ENCRYPTION_KEYS/);
  });
});
