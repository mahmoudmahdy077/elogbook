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
| `EMAIL_ENABLED` | web-server | No | all | `true` | Enables application email delivery |
| `EMAIL_PROVIDER` | web-server | No | all | `resend+smtp` | Application provider mode: `resend+smtp` or `smtp-only` |
| `EMAIL_FROM_ADDRESS` | web-server | Yes when email enabled | production | - | Bare sender address; never include display name |
| `EMAIL_FROM_NAME` | web-server | No | all | - | Sender display name |
| `EMAIL_REPLY_TO` | web-server | No | all | - | Bare monitored reply-to address |
| `EMAIL_DATA_ENCRYPTION_KEYS` | web-server | Yes when email enabled | production | - | JSON key ring for versioned AES-GCM recipient/context encryption |
| `EMAIL_DATA_ACTIVE_KEY_VERSION` | web-server | Yes when email enabled | production | - | Active email encryption key version |
| `EMAIL_LOOKUP_HMAC_KEY` | web-server | Yes when email enabled | production | - | HMAC key for recipient lookup and deduplication |
| `EMAIL_TOKEN_SIGNING_SECRET` | web-server | Yes when email enabled | production | - | HMAC secret for expiring email action tokens |
| `EMAIL_CRON_SECRET` | web-server | Yes when email enabled | production | - | Scheduler authentication secret |
| `RESEND_API_KEY` | web-server | Yes for `resend+smtp` | production | - | Resend API key |
| `RESEND_WEBHOOK_SECRET` | web-server | Yes for `resend+smtp` | production | - | Resend webhook signing secret |
| `SMTP_HOST` | web-server | Yes for `resend+smtp` | production | - | SMTP host |
| `SMTP_PORT` | web-server | No | all | `587` | SMTP port |
| `SMTP_USER` | web-server | Yes for `resend+smtp` | production | - | SMTP username |
| `SMTP_PASS` | web-server | Yes for `resend+smtp` | production | - | SMTP password |
| `CONTACT_ALERT_TO` | web-server | Yes when email enabled | production | - | Bare recipient for platform contact alerts |
| `EMAIL_RATE_PER_MIN` | web-server | No | all | `60` | Application email send budget |
| `BACKUP_STORAGE_PROVIDER` | backup/CI | Yes for production backup | production | - | Approved backup storage provider identifier; placeholders are rejected |
| `BACKUP_ENCRYPTION_PROVIDER` | backup/CI | Yes for backup | production | - | Approved encryption provider identifier |
| `BACKUP_ENCRYPTION_HOOK` | backup/CI | Yes for backup | production | - | Executable provider-neutral encryption hook path |
| `BACKUP_KMS_PROVIDER` | backup/CI | Yes for production backup | production | - | Approved KMS provider identifier |
| `BACKUP_KMS_KEY_REFERENCE` | backup/CI | Yes for production backup | production | - | Non-placeholder key reference; manifests retain only its SHA-256 |
| `BACKUP_KMS_VERIFY_HOOK` | backup/CI | Yes for production backup | production | - | Executable hook that must print `verified` before `pg_dump` |
| `BACKUP_OBJECT_LOCK_MODE` | backup/CI | Yes for production backup | production | - | `compliance` or `governance` |
| `BACKUP_OBJECT_LOCK_RETENTION_DAYS` | backup/CI | Yes for production backup | production | - | Integer remote retention from 1 through 3650 |
| `BACKUP_OBJECT_LOCK_VERIFY_HOOK` | backup/CI | Yes for production backup | production | - | Executable per-object lock verification hook |
| `BACKUP_UPLOAD_HOOK` | backup/CI | Yes for production backup | production | - | Executable provider-neutral upload hook path |
| `BACKUP_REMOTE_VERIFY_HOOK` | backup/CI | Yes for production backup | production | - | Executable remote SHA-256 verification hook path |
| `RESTORE_TARGET_ALLOWLIST` | control plane | Yes for restore drills | setup/non-production control plane | - | Comma-separated ids of server-provisioned disposable restore targets. Each id must match `[a-z0-9_]{1,32}`; the server derives the database name as `elogbook_restore_<id>`. Empty (the default) fails closed, and reserved or malformed entries are dropped |
| `SUPABASE_CONFIG_PATH` | control plane | No | setup/non-production control plane | `/app/data/supabase-config.json` | Installer-written Supabase connection config; never returned to a caller |
| `RELEASE_COMMIT` | release tooling | Yes for generated evidence | CI | `GITHUB_SHA` | Full release commit bound into evidence |
| `RELEASE_ATTESTATION_VERIFIER` | release tooling | Yes for promotion | production release | - | Approved executable that verifies the manifest and checksums and prints `verified` |
| `PRODUCTION_ENVIRONMENT_VERIFIER` | release tooling | Yes for promotion | production release | - | Approved executable that verifies commit-bound production controls and prints `verified` |
| `ANDROID_PRIMARY_SPKI_PIN` | mobile build | Yes for Android builds | EAS preview, production | - | Non-public reviewed SHA-256 SPKI pin injected by the config plugin |
| `ANDROID_BACKUP_SPKI_PIN` | mobile build | Yes for Android builds | EAS preview, production | - | Distinct non-public reviewed backup SPKI pin injected by the config plugin |
| `NODE_ENV` | web-server | No | all | `development` | Runtime environment; setup mode is non-production only |
| `APP_RELEASE_COMMIT` | build/setup | Yes for setup image | setup, production image | - | Full 40-character build commit injected as a Docker build argument; setup completion verifies it and never shells out to Git |
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
- Service role key, Sentry auth token, Redis credentials, email provider keys, SMTP credentials, encryption keys, and action-token secrets must never enter browser code.
- `EMAIL_FROM_ADDRESS` and `EMAIL_REPLY_TO` are bare addresses; keep display names in `EMAIL_FROM_NAME`.
- `EMAIL_FROM` is a development compatibility alias only and must not be used as a recipient address.
- Mobile runtime config is set via EAS secrets, not committed to source. Android SPKI pins are non-public EAS environment variables read only by the config plugin; never add an `EXPO_PUBLIC_` fallback.
- Production backup fails closed unless KMS identity is verified before `pg_dump` and every remote object passes both SHA-256 and object-lock verification.
- Deterministic release inventory is not promotion evidence; promotion requires the configured signature, attestation, and production environment verifiers.
- Mobile Sentry is dedicated: EAS builds populate `EXPO_PUBLIC_SENTRY_DSN` from the GitHub secret `EXPO_PUBLIC_SENTRY_DSN` (not from server `SENTRY_DSN`); enforced by `scripts/check-sentry-consistency.mjs`. Missing value safely disables mobile telemetry.
- Release rollback class (image-only / schema-compatible / restore-based) is decided before every update; see `docs/upgrade/runbooks/update.md` and `apps/ops` update-plan model.

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
