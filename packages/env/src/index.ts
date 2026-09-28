import { z } from 'zod';

const releaseCommitSchema = z.string().regex(
  /^[0-9a-f]{40}$/i,
  'must be a full 40-character hexadecimal Git commit',
);

const webPublicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
});

const webServerSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const optionalSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  RATE_LIMIT_MODE: z.enum(['distributed', 'single-instance']).optional(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).optional(),
  DISABLE_MFA: z.enum(['true', 'false']).optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_ENV: z.enum(['development', 'production', 'test']).optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ANALYZE: z.string().optional().transform((v) => v === 'true'),
  EMAIL_ENABLED: z.enum(['true', 'false']).default('true'),
  EMAIL_PROVIDER: z.enum(['resend+smtp', 'smtp-only']).default('resend+smtp'),
  EMAIL_FROM_ADDRESS: z.string().email().optional(),
  EMAIL_FROM_NAME: z.string().min(1).max(120).optional(),
  EMAIL_REPLY_TO: z.string().email().optional(),
  EMAIL_RATE_PER_MIN: z.coerce.number().int().min(1).max(1000).default(60),
  EMAIL_DATA_ENCRYPTION_KEYS: z.string().min(1).optional(),
  EMAIL_DATA_ACTIVE_KEY_VERSION: z.coerce.number().int().min(1).optional(),
  EMAIL_LOOKUP_HMAC_KEY: z.string().min(32).optional(),
  EMAIL_TOKEN_SIGNING_SECRET: z.string().min(32).optional(),
  EMAIL_CRON_SECRET: z.string().min(32).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_WEBHOOK_SECRET: z.string().min(32).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  CONTACT_ALERT_TO: z.string().email().optional(),
  SETUP_MODE: z.enum(['true', 'false']).optional(),
  SETUP_PHASE: z.enum(['setup']).optional(),
  SETUP_BIND_ADDRESS: z.enum(['127.0.0.1', '::1', 'loopback']).optional(),
  SETUP_REMOTE_TLS_REQUIRED: z.enum(['true', 'false']).optional(),
  SETUP_BOOTSTRAP_TOKEN: z.string().min(32).optional(),
  APP_RELEASE_COMMIT: releaseCommitSchema.optional(),
});

const setupEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test']).default('development'),
  SETUP_MODE: z.literal('true'),
  SETUP_PHASE: z.literal('setup'),
  SETUP_BIND_ADDRESS: z.enum(['127.0.0.1', '::1', 'loopback']),
  SETUP_REMOTE_TLS_REQUIRED: z.literal('true').default('true'),
  SETUP_BOOTSTRAP_TOKEN: z.string().min(32).optional(),
  APP_RELEASE_COMMIT: releaseCommitSchema,
}).passthrough();

const baseEnvSchema = webPublicSchema.merge(webServerSchema).merge(optionalSchema);

const envSchema = baseEnvSchema.superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production' && !data.RATE_LIMIT_MODE) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RATE_LIMIT_MODE'],
      message:
        "RATE_LIMIT_MODE is required in production. Set 'distributed' (requires UPSTASH_REDIS_REST_URL/TOKEN) or 'single-instance' (reduced-security, single-process only).",
    });
  }
  if (
    data.RATE_LIMIT_MODE === 'distributed' &&
    (!data.UPSTASH_REDIS_REST_URL || !data.UPSTASH_REDIS_REST_TOKEN)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RATE_LIMIT_MODE'],
      message:
        'RATE_LIMIT_MODE=distributed requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
    });
  }
  if (data.NODE_ENV === 'production' && data.TRUSTED_PROXY_HOPS === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['TRUSTED_PROXY_HOPS'],
      message:
        'TRUSTED_PROXY_HOPS is required in production. Set 0 (trust nothing, use socket peer) or 1 (single Caddy hop, pilot default).',
    });
  }
  if (data.NODE_ENV === 'production' && data.DISABLE_MFA === 'true') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DISABLE_MFA'],
      message:
        'DISABLE_MFA=true is forbidden in production. Unset it (fail-closed MFA enforcement) — local dev only.',
    });
  }
  if (data.NODE_ENV === 'production' && data.EMAIL_ENABLED) {
    if (!data.EMAIL_FROM_ADDRESS) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_FROM_ADDRESS'], message: 'EMAIL_FROM_ADDRESS is required when email is enabled.' });
    if (!data.EMAIL_DATA_ENCRYPTION_KEYS) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_DATA_ENCRYPTION_KEYS'], message: 'EMAIL_DATA_ENCRYPTION_KEYS is required when email is enabled.' });
    if (!data.EMAIL_DATA_ACTIVE_KEY_VERSION) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_DATA_ACTIVE_KEY_VERSION'], message: 'EMAIL_DATA_ACTIVE_KEY_VERSION is required when email is enabled.' });
    if (!data.EMAIL_LOOKUP_HMAC_KEY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_LOOKUP_HMAC_KEY'], message: 'EMAIL_LOOKUP_HMAC_KEY is required when email is enabled.' });
    if (!data.EMAIL_TOKEN_SIGNING_SECRET) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_TOKEN_SIGNING_SECRET'], message: 'EMAIL_TOKEN_SIGNING_SECRET is required when email is enabled.' });
    if (!data.EMAIL_CRON_SECRET) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_CRON_SECRET'], message: 'EMAIL_CRON_SECRET is required when email is enabled.' });
    if (!data.CONTACT_ALERT_TO) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CONTACT_ALERT_TO'], message: 'CONTACT_ALERT_TO is required when email is enabled.' });
    if (data.EMAIL_PROVIDER === 'resend+smtp' && !data.RESEND_API_KEY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is required for resend+smtp.' });
    if (data.EMAIL_PROVIDER === 'resend+smtp' && !data.RESEND_WEBHOOK_SECRET) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RESEND_WEBHOOK_SECRET'], message: 'RESEND_WEBHOOK_SECRET is required for resend+smtp.' });
    if (data.EMAIL_PROVIDER !== 'smtp-only' && !data.SMTP_HOST) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMTP_HOST'], message: 'SMTP_HOST is required when SMTP failover is enabled.' });
    if (data.EMAIL_PROVIDER !== 'smtp-only' && (!data.SMTP_USER || !data.SMTP_PASS)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMTP_USER'], message: 'SMTP_USER and SMTP_PASS are required when SMTP failover is enabled.' });
  }
  if (data.NODE_ENV === 'production' && data.NEXT_PUBLIC_SITE_URL.startsWith('http://localhost')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['NEXT_PUBLIC_SITE_URL'], message: 'Production requires an HTTPS non-localhost site URL.' });
  }
});

function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  source: Record<string, string | undefined>,
  label: string,
): z.infer<T> {
  const normalized = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, typeof value === 'string' && value.trim() === '' ? undefined : value]),
  ) as Record<string, string | undefined>;
  const result = (schema as z.ZodTypeAny).safeParse(normalized);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`[env/${label}] Validation failed:\n${details}`);
  }
  return result.data;
}

export function parseSetupEnv(source: Record<string, string | undefined>) {
  return parseOrThrow(setupEnvSchema, source, 'setup');
}

export function parseAppReleaseCommit(value: unknown): string {
  const result = releaseCommitSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `[env/release-commit] Validation failed:\n  APP_RELEASE_COMMIT: ${result.error.issues[0]?.message ?? 'must be a full commit'}`,
    );
  }
  return result.data;
}

export function parseWebPublicEnv(source: Record<string, string | undefined>) {
  return parseOrThrow(webPublicSchema, source, 'web-public');
}

export function parseWebServerEnv(source: Record<string, string | undefined>) {
  return parseOrThrow(webServerSchema, source, 'web-server');
}

export function parseWebFullEnv(source: Record<string, string | undefined>) {
  return parseOrThrow(envSchema, source, 'web-full');
}

export const env = () => parseOrThrow(envSchema, process.env, 'default');
