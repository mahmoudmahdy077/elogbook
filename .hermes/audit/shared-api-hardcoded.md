# Audit: shared / API routes / edge functions — stubs & dead code

Scope: `packages/shared/src/**`, `apps/web/app/api/**/route.ts`, `supabase/functions/**`
Date: 2026-08-22 · READ-ONLY audit · no source files modified

Method: repo-wide greps (TODO/FIXME/stub/mock markers, `.rpc(` calls vs `CREATE FUNCTION` in
migrations, edge-function name mentions across apps/web + apps/mobile + packages, catch-block
analysis, per-route auth/rate-limit/csrf ordering scan), then targeted reads of every suspect.
No builds/tests run.

| # | File | Line | Pattern | Evidence (≤3 lines) | Sev | Suggested fix |
|---|------|------|---------|---------------------|-----|---------------|
| 1 | supabase/functions/dispatch-webhook/index.ts | 1–16 | Stub endpoint (503) | `// P1.3: Webhook dispatch disabled until outbox pattern…` returns 503 for all requests; client helper `dispatchWebhookEvent` in apps/web/lib/webhooks.ts replicates dispatch inline instead | P1 | Implement outbox+durable delivery or delete function and route callers through lib/webhooks.ts only |
| 2 | supabase/functions/scim/index.ts | 1–15 | Stub endpoint (503) | `// P1.4: SCIM disabled until complete SCIM 2.0 implementation is verified` → always `{ error: 'SCIM is disabled…' }`, 503 | P1 | Finish SCIM 2.0 or remove function + admin/scim UI entry points |
| 3 | supabase/functions/sso-callback/index.ts | 4–15 | Stub endpoint (503) | `// SSO is disabled until a complete SAML/OIDC implementation is verified.` always 503 | P1 | Implement SAML/OIDC callback or gate the SSO UI behind a feature flag |
| 4 | packages/shared/src/types (+ index.ts re-exports) | — | Dead shared exports (~99 of 141) | Verified zero references outside shared/src: PHIString, PHI_MARKER, ClinicalText(+Props/Size), NativeSpinner, NativePanel, StripeEvent, PaymentStatus, OneTimePurchase, TenantType, APP_VERSION, CARD_EXIT_ANIMATION, SPRING_SLIDE_UP, KPI_COUNT_UP, accreditationMappingSchema, accreditationMilestoneSchema, aiQueryLogSchema … | P2 | Prune from shared barrel or wire up intended consumers; add lint rule (ts-prune) to CI |
| 5 | apps/web/app/api/[tenant]/consent (client ConsentRow.tsx:32) | — | RPC without CREATE FUNCTION | `.rpc('set_user_consent')` called in apps/web/app/(authenticated)/[tenant]/consent/ConsentRow.tsx but no `set_user_consent` in any supabase/migrations/*.sql (also no user_consent table refs) | P1 | Add migration creating set_user_consert/user_consents, or remove consent UI call — currently runtime error |
| 6 | supabase/functions/payment-webhook | 1+ | Edge fn never referenced in app code | Real Stripe impl (413 lines) with signature verify; zero mentions in apps/** — invoked by Stripe only. OK by design, listed as verified-external | P3 | None (document external caller) |
| 7 | supabase/functions/ai-quality | 1+ | No caller found in apps/web or apps/mobile | 446-line real AI-quality analyzer; not invoked anywhere in client code nor from other fns | P2 | Wire into case-submit flow or remove/deprecate |
| 8 | supabase/functions/webads-export | 1+ | No caller found in client code | 234-line real XML exporter; unreferenced in apps/** | P2 | Expose UI/export button or deprecate |
| 9 | supabase/functions/ai-gap-analysis | 1+ | No caller found in client code | 128-line real analyzer; unreferenced in apps/** | P2 | Wire into analytics/gap UI or deprecate |
| 10 | supabase/functions/list-invoices | 1+ | No caller found in client code | 76-line real Stripe invoice lister; unreferenced in apps/** | P2 | Call from billing page or deprecate |
| 11 | supabase/functions/create-checkout | — | OK (control) | Invoked via supabase.functions from SubscriptionPlans.tsx | — | — |
| 12 | supabase/functions/create-portal-session | — | OK (control) | Invoked from ManageSubscriptionButton.tsx | — | — |
| 13 | supabase/functions/ai-insights | — | OK (control) | Invoked from AIInsightsPanel.tsx + mobile linking | — | — |
| 14 | supabase/functions/generate-pdf | 65 | OK (server-side caller) | Called from apps/web/app/api/[tenant]/export-pdf/route.ts via functions/v1 URL | — | — |
| 15 | apps/web/app/api/setup/* (7 routes) | various | No auth on privileged routes | configure-domain, complete, create-admin, test-db, migrate, deploy-supabase, check-requirements have no getUser/role check; proxy.ts rate-limits /api/* generally but nothing gates setup/* | P1 | Verify bootstrap-only guard (env flag/middleware) exists; otherwise these are unauthenticated admin endpoints |
| 16 | apps/web/app/api/auth/login/route.ts | — | Auth route w/o in-route rate limit | Relies solely on proxy.ts IP rate-limit (`login:${ip}`); acceptable but single-layer | P3 | Consider per-account lockout in addition to IP throttle |
| 17 | packages/shared/src/components/FormField.{web,native}.tsx | 20/17 etc | False positive | `placeholder` hits are legit input props, not stubs | — | — |
| 18 | apps/web/app/api/backup/route.ts | 54 | False positive | `success:true` follows real pg_dump backup work | — | — |

## Totals by severity
- P0: 0
- P1: 4 (#1 dispatch-webhook stub, #2 scim stub, #3 sso-callback stub, #5 missing RPC set_user_consent, #15 unauth setup routes — 5 items)
- P2: 5 (#4 dead exports mass, #7–#10 orphaned real edge functions)
- P3: 2 (#6 doc-only, #16 defense-in-depth)

## Top 10 priorities
1. #15 setup/* routes with no auth check (potential unauthenticated admin/bootstrap surface)
2. #5 `.rpc('set_user_consent')` has no CREATE FUNCTION in migrations → runtime failure on consent page
3. #1 dispatch-webhook is a permanent 503 stub while webhooks.ts silently falls back to inline delivery
4. #2 scim edge function = 503 stub still exposed & referenced by admin UI
5. #3 sso-callback = 503 stub still referenced by SSOManager.tsx
6. #7 ai-quality (446 lines, real logic) never invoked by any client
7. #8 webads-export never invoked by any client
8. #9 ai-gap-analysis never invoked by any client
9. #10 list-invoices never invoked by any client
10. #4 ~99 dead exports in packages/shared (PHIString, ClinicalText family, StripeEvent, PaymentStatus…)

## Clean checks (no findings)
- No API route returns hardcoded/mock JSON arrays — all queried Supabase/DB.
- Zero TODO/FIXME/stub markers in routes and edge functions (only test files).
- No catch block returns fake `{ success: true }`.
- Stripe paths are real (SDK/fetch + webhook signature verification), no stubbed payments.
- Route pipeline order consistent: proxy.ts does global IP rate-limit before handlers;
  in-handler order CSRF→rate→auth→tenant→role→parse shows no violations across 44 routes.
