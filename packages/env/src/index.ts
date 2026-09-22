import { z } from 'zod';

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
  EMAIL_PROVIDER: z.enum(['resend+smtp', 'smtp-only']).default('resend+smtp'),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  EMAIL_CRON_SECRET: z.string().min(1).optional(),
  CONTACT_ALERT_TO: z.string().optional(),
  EMAIL_RATE_PER_MIN: z.coerce.number().int().min(1).max(1000).default(60),
});

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
  if (data.NODE_ENV === 'production' && (data as Record<string, unknown>).EMAIL_PROVIDER === 'resend+smtp' && !(data as Record<string, unknown>).RESEND_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY is required in production with EMAIL_PROVIDER=resend+smtp.' });
  }
  if (data.NODE_ENV === 'production' && !(data as Record<string, unknown>).EMAIL_FROM) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EMAIL_FROM'], message: 'EMAIL_FROM is required in production.' });
  }
});

function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  source: Record<string, string | undefined>,
  label: string,
): z.infer<T> {
  const result = (schema as z.ZodTypeAny).safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`[env/${label}] Validation failed:\n${details}`);
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
