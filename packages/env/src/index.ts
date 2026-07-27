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
});

const envSchema = webPublicSchema.merge(webServerSchema).merge(optionalSchema);

function parseOrThrow<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  source: Record<string, string | undefined>,
  label: string,
): z.infer<typeof schema> {
  const result = schema.safeParse(source);
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
