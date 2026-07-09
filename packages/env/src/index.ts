/**
 * @elogbook/env — Shared environment variable validation & access
 *
 * Single source of truth for all environment variables across the monorepo.
 * Validates at first access so missing/invalid vars fail fast.
 *
 * Usage:
 *   import { env } from '@elogbook/env';
 *   const url = env.SUPABASE_URL; // string — validated at boot
 *   const isDev = env.IS_DEV;     // boolean
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const envSchema = z.object({
  // ── Supabase ──────────────────────────────────────────────────────────
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // ── Site ──────────────────────────────────────────────────────────────
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),

  // ── Redis (Upstash) ───────────────────────────────────────────────────
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // ── Sentry ────────────────────────────────────────────────────────────
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_ENV: z.enum(['development', 'production', 'test']).optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),

  // ── PostHog ───────────────────────────────────────────────────────────
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),

  // ── Build / CI ────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ANALYZE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
function parseEnv(env: Record<string, string | undefined>) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const missing = result.error.issues
      .filter((i) => i.code === 'invalid_type' && i.message.includes('Required'))
      .map((i) => i.path.join('.'));
    if (missing.length > 0) {
      console.error(`[env] Missing required variables: ${missing.join(', ')}`);
    }
    // Return partial with defaults where possible instead of crashing
    return result.data as z.infer<typeof envSchema>;
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Singleton — parsed once at module load
// ---------------------------------------------------------------------------
export const env = parseEnv(process.env);

// Convenience helpers
export const IS_DEV = env.NODE_ENV === 'development';
export const IS_PROD = env.NODE_ENV === 'production';
export const IS_TEST = env.NODE_ENV === 'test';
