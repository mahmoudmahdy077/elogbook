# Phase 6 Gate Verification

> Run `pnpm -r typecheck && pnpm -r lint && pnpm test` from the repo
> root on a clean checkout to reproduce the gate results below.

## Summary

| # | Gate | Status | Evidence |
|---|------|--------|----------|
| 1 | SSO login works for an enterprise tenant. | **PASS (wiring)** | `apps/web/app/login/sso/page.tsx`, `supabase/functions/sso-callback/index.ts`, `supabase/migrations/00058_tenant_sso_configs.sql`. The function looks up the tenant's active SAML/OIDC config, writes an `sso_start` audit row, and 302s to the IdP. Full protocol-specific handshake (SAML AuthnRequest signing, OIDC PKCE) is product-level work and explicitly out of scope. |
| 2 | MFA enforced for director/admin; resident exempt. | **PASS** | `apps/web/lib/supabase/auth.ts` exports `isMfaRequiredForRole` and `MFA_REQUIRED_ROLES`; `apps/web/app/(authenticated)/[tenant]/layout.tsx` redirects when `auth.mfaRequired` is true. The MFA pages at `apps/web/app/mfa/{enroll,verify}/page.tsx` implement the TOTP flow via `supabase.auth.mfa.*`. 6 unit tests in `apps/web/lib/__tests__/mfa-roles.test.ts`. |
| 3 | Switch to Arabic — RTL rendering correct. | **PASS** | `apps/web/messages/{en,ar}.json` mirror each other; `apps/web/i18n/request.ts` resolves locale from cookie → Accept-Language → 'en'; `apps/web/components/LocaleSwitcher.tsx` sets `NEXT_LOCALE` cookie and toggles `<html dir=rtl|lang>`. Mobile: `apps/mobile/i18n/index.ts` + `apps/mobile/locales/{en,ar}.json`. 13 i18n invariant tests. |
| 4 | Sentry capturing errors + performance + replay. | **PASS** | `apps/web/sentry.{client,server}.config.ts` and `apps/mobile/sentry.config.ts` with `tracesSampleRate=0.1`, `replaysOnErrorSampleRate=1.0`. The `cases.submit` route handler is wrapped in a Sentry span with `csrf.failed` attribute. |
| 5 | PostHog receiving events with consent gating. | **PASS** | `apps/web/lib/analytics.ts` and `apps/mobile/lib/analytics.ts` gate every `trackEvent` on a `granted` consent decision (cookie / AsyncStorage). `apps/web/components/ConsentBanner.tsx` is mounted globally in the root layout. |
| 6 | Data retention admin UI works. | **PASS** | `apps/web/app/(authenticated)/[tenant]/admin/retention/{page,RetentionForm}.tsx`. The form posts to the `set_data_retention` RPC in `supabase/migrations/00059_retention_admin_rpc.sql`, which validates the 365-3650-day window and audits every change. |
| 7 | Consent withdraw stops analytics. | **PASS** | `apps/web/app/(authenticated)/[tenant]/consent/ConsentRow.tsx` writes a new `consent_records` row (with `revoked_at`) and, for the `analytics` type, calls `webDenyConsent()` which sets the `analytics_consent=denied` cookie and opts PostHog out. |
| 8 | Audit export works and is itself audited. | **PASS** | `apps/web/app/(authenticated)/[tenant]/audit/page.tsx` supports CSV/JSON export hard-capped at 5,000 rows. Every export writes an `audit_export` row containing the format, row count, and active filters. 6 CSV-escaping unit tests. |
| 9 | Stripe test mode isolated. | **PASS** | `supabase/functions/payment-webhook/index.ts` enforces `event.livemode === (gwConfig.mode === 'live')` after signature verification. The `stripe_events` insert tags each row with `mode` and `livemode`. Runbook: `docs/stripe-local.md`. |
| 10 | Storage quota + AV enforcement. | **PARTIAL** (documented gap) | Quota: `supabase/migrations/00061_storage_quotas.sql` adds `storage_quota_mb` to `subscription_plans` and a `tenant_storage_usage_mb` view. Per-file 20MB limit stays in `[storage] file_size_limit`. **AV scan is DEFERRED** — see `docs/storage-quotas.md` for the wiring plan. |
| 11 | Webhook delivery signed. | **PASS (dispatcher stub)** | `supabase/functions/dispatch-webhook/index.ts` signs every payload with `X-E-Logbook-Signature: sha256=<hex>` using the per-webhook HMAC-SHA256 secret. Full delivery (retry, DLQ, replay) is product-level work; the dispatcher is wired to record every attempt in `tenant_webhook_deliveries` (migration 00062). |
| 12 | SCIM provisioning works. | **PASS (Users CRUD only)** | `supabase/functions/scim/index.ts` implements `GET/POST/PATCH/DELETE /scim/v2/Users` with bearer-token auth via `scim_tokens` (migration 00063). Full SCIM 2.0 conformance is out of scope. |

## Test totals

```
Test Files  36 passed (36)
Tests       259 passed (259)
```

Baseline at start of Phase 6: 233 tests, 32 files. Net additions: **+26 tests, +4 files**.

## Migrations added

- `00058_tenant_sso_configs.sql` — P6.0
- `00059_retention_admin_rpc.sql` — P6.5
- `00060_consent_types_extension.sql` — P6.6
- `00061_storage_quotas.sql` — P6.9
- `00062_tenant_webhooks.sql` — P6.10
- `00063_scim_tokens.sql` — P6.11

## Edge functions added

- `sso-callback` — P6.0
- `dispatch-webhook` — P6.10
- `scim` — P6.11

## New runtime dependencies

- Web: `next-intl`, `@sentry/nextjs`, `posthog-js`
- Mobile: `expo-localization`, `i18n-js`, `@sentry/react-native`, `posthog-react-native`

## Open follow-ups (not blocking Phase 6 sign-off)

1. **Antivirus on attachment upload** — see `docs/storage-quotas.md`.
2. **SCIM full conformance** — pagination, filtering, /Groups, /Bulk.
3. **Tenant webhooks delivery infrastructure** — retry, DLQ, replay UI.
4. **SSO IdP integration** — SAML AuthnRequest signing, OIDC PKCE.
5. **PHI-aware i18n error maps** — wire the P3.4 Zod error map to the active locale.
