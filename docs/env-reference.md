# Environment Variable Reference

This document lists every environment variable used across the monorepo. Actual secret values are stored in the password manager / secret manager, not in this file.

## Variable Inventory

| Variable | Scope | Required | Environments | Default | Description |
|----------|-------|----------|--------------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | web-public | Yes | all | `http://127.0.0.1:54321` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web-public | Yes | all | - | Supabase anonymous/public key |
| `NEXT_PUBLIC_SITE_URL` | web-public | No | all | `http://localhost:3000` | Canonical site URL |
| `NEXT_PUBLIC_SENTRY_DSN` | web-public | No | production | - | Sentry client DSN |
| `NEXT_PUBLIC_SENTRY_ENV` | web-public | No | all | `development` | Sentry environment tag |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | web-public | No | production | - | Sentry traces sampling rate (0-1) |
| `NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE` | web-public | No | production | - | Session replay sampling rate (0-1) |
| `NEXT_PUBLIC_POSTHOG_KEY` | web-public | No | production | - | PostHog project API key |
| `NEXT_PUBLIC_POSTHOG_HOST` | web-public | No | production | - | PostHog instance URL |
| `SUPABASE_SERVICE_ROLE_KEY` | web-server | Yes | all | - | Supabase service role key (server-only) |
| `SENTRY_ORG` | web-server | No | production | - | Sentry organization slug |
| `SENTRY_PROJECT` | web-server | No | production | - | Sentry project slug |
| `SENTRY_AUTH_TOKEN` | web-server | No | production | - | Sentry auth token (CI/build) |
| `SENTRY_TRACES_SAMPLE_RATE` | web-server | No | production | - | Server-side traces rate (0-1) |
| `UPSTASH_REDIS_REST_URL` | web-server | No | production | - | Redis REST URL for rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | web-server | No | production | - | Redis REST auth token |
| `NODE_ENV` | web-server | No | all | `development` | Runtime environment |
| `ANALYZE` | web-server | No | all | `false` | Enable bundle analyzer |
| `EXPO_PUBLIC_SUPABASE_URL` | mobile-public | Yes | all | - | Supabase URL for mobile |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | mobile-public | Yes | all | - | Supabase anon key for mobile |
| `EXPO_PUBLIC_SENTRY_DSN` | mobile-public | No | production | - | Sentry DSN for mobile |

## Configuration Schema Packages

- **Web public**: validated by `@elogbook/env` (`parseWebPublicEnv`)
- **Web server**: validated by `@elogbook/env` (`parseWebServerEnv` / `parseWebFullEnv`)

## Security Notes

- Never prefix server-only variables with `NEXT_PUBLIC_` — they will be embedded in client bundles.
- Supabase anon key is safe for public exposure (RLS provides authorization).
- Service role key, Sentry auth token, and Redis credentials must never enter browser code.
- Mobile runtime config is set via EAS secrets, not committed to source.

## Setup

```bash
# Local development
cp .env.example .env.local
# Fill in values from `supabase status -o env`
```

For deployment, set variables in:
- **Vercel**: Project Settings → Environment Variables
- **EAS**: `eas secret:create` or EAS Dashboard
- **GitHub Actions**: Repository → Settings → Secrets and Variables
