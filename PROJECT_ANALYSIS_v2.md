# E-Logbook Enterprise — Complete Project Analysis v2

> **Generated**: 2026-07-08 | **Purpose**: Complete reference for AI coding agents. Every variable, every route, every type, every state. Read this, not the source.

---

## 1. PROJECT IDENTITY

**Product**: E-Logbook Enterprise — enterprise-grade electronic logbook for medical residents  
**Monorepo**: `elogbook` | **PM**: pnpm v9+ | **TS**: strict mode v6+ | **Node**: 20+  
**Deployed**: https://elogbook-two.vercel.app  

### Core Stack

| Package | Role | Framework | UI | Styling |
|---------|------|-----------|----|---------|
| `@elogbook/web` | Web dashboard | Next.js 16 (App Router) | `@heroui/react` v3.1 | Tailwind CSS v4 + CSS vars |
| `@elogbook/mobile` | Mobile app | Expo SDK 56 + RN 0.85 | NativeWind v4 | Tailwind v4 + clinicalTokens |
| `@elogbook/shared` | Shared types/schemas | TypeScript + React | — | design-tokens |
| `@elogbook/supabase` | Supabase config | — | — | — |

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_SENTRY_DSN (optional)
NEXT_PUBLIC_SENTRY_ENV (optional)
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE (default 0.2)
NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE (default 0.1)
SUPABASE_SERVICE_ROLE_KEY (server-side)
SENTRY_ORG (optional with DSN)
SENTRY_PROJECT (optional with DSN)
SENTRY_AUTH_TOKEN (optional)
UPSTASH_REDIS_REST_URL (optional — for Redis rate limiter)
UPSTASH_REDIS_REST_TOKEN (optional)
```

---

## 2. DATA MODEL — Complete TypeScript Interfaces

All defined in `packages/shared/src/types/database.ts`

### Core Enums
```
UserRole = 'resident' | 'supervisor' | 'director' | 'institution_admin' | 'admin'
CaseStatus = 'draft' | 'pending' | 'approved' | 'rejected'
TenantType = 'individual' | 'institution'
SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing'
PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded'
FrameworkType = 'acgme' | 'scfhs' | 'gmc' | 'canmeds' | 'custom'
```

### Full Interface Listing (326 lines in database.ts)
Key types: Institution, Tenant, Profile, CaseTemplate, TemplateField, CaseEntry, FacultyEvaluation, AccreditationMapping, AccreditationMilestone, AccreditationFramework, AttachmentSignature, InstitutionBilling, CaseAttachment, ApprovalRequest, AuditLog, AIConfig, AIQueryLog, ProgramGoal, SubscriptionPlan, Subscription, StripeEvent, Payment, OneTimePurchase, ResidentAIToggle, PaymentGatewayConfig, ComplianceConfiguration, DutyPeriod, TemplateFavorite

### Server-Only Types (database.server.ts)
- `AIConfigServer` — includes `api_key_enc: Uint8Array`, `key_version`
- `PaymentGatewayConfigServer` — includes `secret_key_enc: Uint8Array`, `webhook_secret_enc: Uint8Array`, `key_version`

### Zod Validation Schemas (packages/shared/src/schemas/)
- `cases.ts`: caseEntrySchema (discriminated union on is_deidentified), caseTemplateSchema, accreditationMappingSchema, approvalActionSchema, programGoalSchema, accreditationFrameworkSchema, aiQuerySchema, residentAiToggleSchema
- `auth.ts`: profileSchema, inviteUserSchema, complianceConfigSchema
- `subscriptions.ts`: subscriptionPlanSchema, paymentGatewayConfigSchema

---

## 3. ARCHITECTURE & DATA FLOW

### Authentication Flow
```
[User] → Magic Link (mobile) or Password (web)
       → Supabase Auth (auth.users)
       → on_auth_user_created trigger → handle_new_user()
           → Creates individual tenant (tenants table)
           → Creates profile (profiles table)
           → Sets tenant_id + user_role in JWT app_metadata
       → Demo users: migration 00006 creates institution-linked profiles
       → JWT contains: tenant_id, user_role (used by RLS)
```

### Case Entry Lifecycle
```
draft ──→ pending ──→ approved
  ↑                     │
  │        ┌────────────┘
  │        ▼
  └── rejected (edits allowed)
```

### Mobile Offline Sync
```
WatermelonDB ←─→ SyncService ←─→ Supabase
(SQLite local)    | sync.ts      (server)
                  ↓
         Server-authoritative conflict:
         - Server updated_at > local → server wins
         - Local edits preserved as new draft
         - Conflict notification banner
```

---

## 4. ROLE-BASED ACCESS CONTROL (5 Roles)

| Role | Permissions |
|------|-------------|
| **resident** | Own cases CRUD (draft → pending), own profile view/edit, AI insights |
| **supervisor** | Tenant-wide case read, approve/reject, view evaluations |
| **director** | Tenant-wide read, manage templates/goals/accreditation frameworks |
| **institution_admin** | Full tenant mgmt, billing, AI config, payment config, webhooks, SSO |
| **admin** | Cross-tenant global: manage institutions, subscription plans, system-wide |

---

## 5. DESIGN SYSTEM (Apple Health Aesthetic)

### Colors (light mode — default)
```
backdrop:    #F2F2F7 (page bg)
surface:     #FFFFFF (card bg)
primary:     #007AFF (blue accent)
secondary:   #5856D6 (purple)
success:     #34C759 (green)
warning:     #FF9500 (amber)
danger:      #FF3B30 (red)
text:        primary #000000, secondary #3C3C43, muted #6D6D73
border:      rgba(60, 60, 67, 0.10)
```

### Fonts
```
heading: 'Inter', -apple-system, 'SF Pro Display', sans-serif
body:    'Inter', -apple-system, 'SF Pro Text', sans-serif
mono:    'SF Mono', 'JetBrains Mono', ui-monospace
```

### Glass Panel
```
bg: rgba(255, 255, 255, 0.72)
blur: 20px
border: rgba(255, 255, 255, 0.6)
rule: ONLY for transient overlays (modals, dialogs) — NOT for data-dense cards
```

---

## 6. MOBILE APP REFERENCE (full: apps/mobile/REFERENCE.md — 1,513 lines)

| Area | Files | Key Details |
|------|-------|-------------|
| Theme | `global.css`, `theme/design-tokens.ts` | All CSS vars, token exports |
| App Root | `_layout.tsx` | ErrorBoundary, fonts, Stack, sync init, screen capture prevention |
| Tabs Layout | `(tabs)/_layout.tsx` | Role-based 6-tab visibility, Ionicons, lazy loading |
| Dashboard | `(tabs)/index.tsx` | Stats cards, goal rings, sync status, pull-to-refresh |
| Case Logging | `(tabs)/log-case.tsx` | 4-step wizard, de-identification toggle, offline save |
| Case List | `(tabs)/my-cases.tsx` | Filter chips, status badges, sync conflict banner |
| Case Detail | `(tabs)/case-detail.tsx` | Patient info, fields, approve/reject, edit/resubmit |
| Approvals | `(tabs)/approvals.tsx` | KPI counters, glass panel cards |
| AI Insights | `(tabs)/ai-insights.tsx` | Streaming, disclaimer, quota |
| Profile | `(tabs)/profile.tsx` | Avatar, role, subscription, sign out |
| Duty Hours | `(tabs)/duty-hours.tsx` | Shift logging, weekly summary, violations |
| Faculty Evals | `(tabs)/faculty-evaluations.tsx` | Evaluation form, rating scales |
| Components | `components/` (7) | AppleCard, BiometricGate, CaseCountWidget, AccessibleText, DateField, ScreenErrorBoundary |
| Client | `lib/supabase.ts` | SecureStore adapter, auto-refresh |
| Sync | `lib/sync.ts` | Singleton: pull/push/conflict/backoff/periodic |
| DB | `lib/db/` | WatermelonDB, schema v2, storage.ts (CRUD + parseDate) |
| Models | `lib/db/models/` | CaseEntry, CaseTemplate, ProgramGoal |
| Haptics | `lib/haptics.ts` | submitSuccess/Error, offlineSave, approvalAction |
| Notifications | `lib/notifications.ts` | Polls approval_requests |

---

## 7. DATABASE / SUPABASE REFERENCE (full: supabase/DATABASE_DOCUMENTATION.md — 1,170 lines)

### 33 Tables Fully Documented
institutions, tenants, profiles, case_templates, case_entries, case_attachments, approval_requests, audit_logs, program_goals, goal_progress, subscription_plans, subscriptions, payments, one_time_purchases, ai_config, resident_ai_toggle, ai_query_logs, payment_gateway_config, accreditation_frameworks, attachment_signatures, institution_billing, consent_records, ai_response_cache, stripe_events, consent_types, storage_quotas, key_rotation_log, tenant_webhooks, tenant_webhook_deliveries, scim_tokens, compliance_reports, template_favorites, faculty_evaluations

Each table documented with: columns/types/defaults, PK/FK constraints, indexes, RLS policies (every FOR ALL / SELECT / INSERT / UPDATE / DELETE rule per role), triggers

### All RPC Functions
| Function | Security | Purpose |
|----------|----------|---------|
| approve_case | SECURITY DEFINER | Atomic approval with row lock + tenant check |
| reject_case | SECURITY DEFINER | Atomic rejection with row lock + tenant check |
| get_case_stats | STABLE | Aggregated case statistics |
| rotate_encryption_key | SECURITY DEFINER | Versioned key rotation (v1→v2) |
| rotate_mrn_salt | SECURITY DEFINER | Per-tenant MRN salt rotation |
| decrypt_with_version | STABLE | Picks correct key by version |
| store_tenant_webhook | SECURITY DEFINER | Insert/update webhook with encrypted secret |
| hash_patient_mrn | IMMUTABLE | SHA-256 with configurable salt |
| handle_new_user | SECURITY DEFINER | Auto-creates tenant + profile on signup |
| enforce_data_retention | SECURITY DEFINER | Daily purge of expired records |
| refresh_case_stats_mv | SECURITY DEFINER | Materialized view refresh |
| cleanup_ai_response_cache | SECURITY DEFINER | Purge expired cache entries |
| get_tenant_id | STABLE | Extract tenant_id from JWT |
| get_user_role | STABLE | Extract role from JWT |
| audit_case_entry | SECURITY DEFINER | PHI-stripped case audit logging |
| audit_accreditation_framework | SECURITY DEFINER | Framework change audit |
| audit_config_change | SECURITY DEFINER | Config mutation audit |
| audit_table_change | SECURITY DEFINER | Generic table audit (runs via DO block) |
| reject_audit_mutation | INSTEAD OF | Append-only enforcement |

### 73 Migrations Summary
- **00001-00018**: Core schema, RLS, triggers, seed data, demo accounts
- **00019-00031**: Fixes: consent RLS, stripe events, subscription unique, resubmit, AI quota, BRIN indexes, stripe RLS, response cache RLS, missing tenant_id, constraints, attachment audit, goal timestamps
- **00048-00059**: Security phase: approval tenant_id fix, FORCE RLS on all tables, secret redaction in audit, audit append-only, search_path normalization, secret encryption, AI quota atomic increment, misc fixes, audit triggers, stripe events failure recording, SSO configs, retention admin RPC
- **00060-00076**: Enterprise features: consent types, storage quotas, key rotation, tenant webhooks, onboarding flag, SCIM tokens, compliance audit gaps, performance indexes, template favorites, stripe customer ID, duty tracking, faculty evaluations, RLS fixes for duty/evaluations, performance indexes v2, webhook encryption, backup schedule

### 9 Edge Functions
| Function | Auth | Provider | Key Logic |
|----------|------|----------|-----------|
| ai-insights | JWT Bearer | OpenAI/Anthropic/Azure/OpenRouter/Custom | Multi-provider routing, safety guardrails, two-layer cache (memory+DB), SSE streaming, quota check, cross-resident protection |
| generate-pdf | JWT Bearer | — | Template-based PDF generation |
| create-checkout | JWT Bearer | Stripe/Paddle/LemonSqueezy | Checkout session creation |
| payment-webhook | Service Role | Stripe/Paddle/LemonSqueezy | Webhook signature verification, subscription lifecycle |
| webhook-proxy | JWT Bearer | Custom URL | Tenant-configured webhook relay |
| set-config | Service Role | — | Admin config management |

### Encryption Architecture
- pgcrypto: `pgp_sym_encrypt` / `pgp_sym_decrypt`
- Versioned keys via `app.encryption_key_v{N}` GUCs
- `decrypt_with_version()` — selects correct key by version number
- Secure views: `secret_ai_config`, `secret_payment_gateway_config`, `secret_tenant_webhooks` — all with `security_barrier=true`
- RLS on secure views: tenant-scoped via `get_tenant_id()` / `get_user_role()`
- Key rotation RPC: decrypts all with old key, re-encrypts with new key
- Salt rotation RPC: per-tenant `mrn_hash_salt` with version tracking

---

## 8. SECURITY ARCHITECTURE

### Database-Level
- **33 tables** with FORCE ROW LEVEL SECURITY enabled
- JWT-based tenant isolation via `get_tenant_id()` and `get_user_role()` helpers
- Cross-tenant leakage prevented via `relforcerowsecurity=true`

### Application-Level
- Server components verify auth via `getAuthContext()` from `lib/supabase/auth.ts`
- CSRF guard on all POST/PUT/DELETE/PATCH (`validateOrigin()` in middleware)
- Rate limiting on all mutation endpoints (`checkRateLimit()`) — Redis-ready at `rate-limit-redis.ts`
- Ownership verification in case submit route (resident must own the case)

### PHI Protection
- `patient_mrn` and `patient_dob` NEVER logged to audit_logs
- De-identification defaults to true
- MRN stored as SHA-256 hash with per-tenant salt
- Hash re-computed on salt rotation (application-side)

### Secrets Management
- Encrypted columns: `api_key_enc`, `secret_key_enc`, `webhook_secret_enc`, `secret_enc`
- Versioned keys + rotation RPC
- Decrypting views with `security_barrier=true`
- Server-only types (`database.server.ts`) — never in client bundles

### Audit Trail
- Append-only (UPDATE/DELETE blocked via trigger)
- All state-changing operations logged
- PHI + secrets auto-redacted

---

## 9. COMPLIANCE FRAMEWORKS

### Supported Regions
| Region | Code | Frameworks |
|--------|------|------------|
| US East | us-east-1 | HIPAA |
| EU West | eu-west-1 | GDPR |
| Middle East | me-central-1 | SCFHS (Saudi) |
| Asia Pacific | ap-southeast-1 | Australian Privacy Act |

### Accreditation Frameworks
| Framework | Type | Usage |
|-----------|------|-------|
| ACGME | acgme | US residency programs |
| SCFHS | scfhs | Saudi Commission |
| GMC | gmc | UK General Medical Council |
| CanMEDS | canmeds | Royal College of Canada |
| Custom | custom | Institution-defined |

### Data Retention
- Configurable per-tenant (365-3650 days)
- Daily purge via `enforce_data_retention()` (pg_cron)
- Default: 7 years (HIPAA minimum)

---

## 10. EDGE CASES & ERROR HANDLING

### Case Entry State Machine
| Transition | Guard | Who |
|------------|-------|-----|
| draft → draft | None (save) | Resident |
| draft → pending | Block if tenant lapsed | Resident |
| pending → approved | Row lock + tenant check | Supervisor |
| pending → rejected | Row lock + tenant check | Supervisor |
| rejected → draft | None (resubmit) | Resident |
| approved → * | BLOCKED — immutable | System |

### Subscription Lapses
- INSERT blocked via `block_lapsed_tenant_submit()` trigger
- Read-only UI via `ReadOnlyBanner.tsx` + `SubscriptionStatusProvider`

### Mobile Offline Edge Cases
- Conflict: server wins if `updated_at` newer
- Local edits preserved as new draft
- Backoff: 30s → 60s → 120s → 300s
- Periodic 60s sync + foreground + connectivity triggers
- Mutex prevents concurrent pushes

### AI Insights Safety
- Regex blocks diagnosis/prescription/prognosis language
- Mandatory disclaimer appended to every response
- Refuses if `is_deidentified !== true`
- 429 if quota exceeded
- Cross-resident access blocked via JWT

---

## 11. API REFERENCE (OpenAPI — 2311-line spec in docs/openapi.yaml)

### Edge Functions
| Function | Endpoint | Auth | Provider |
|----------|----------|------|----------|
| ai-insights | POST /functions/v1/ai-insights | JWT Bearer | OpenAI/Anthropic/Azure/OpenRouter/Custom |
| generate-pdf | POST /functions/v1/generate-pdf | JWT Bearer | — |
| create-checkout | POST /functions/v1/create-checkout | JWT Bearer | Stripe/Paddle/LemonSqueezy |
| payment-webhook | POST /functions/v1/payment-webhook | Service Role | Stripe/Paddle/LemonSqueezy |
| webhook-proxy | POST /functions/v1/webhook-proxy | JWT Bearer | Tenant-configured |
| set-config | PATCH /functions/v1/set-config | Service Role | — |

### Web API Routes (Next.js App Router)
| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| /api/health | GET | None | DB health check |
| /auth/callback | GET | OAuth | Auth callback handler |
| /api/csp-violation | POST | None | CSP report collector |
| /api/[tenant]/admin/sso | GET/POST | JWT | SSO config CRUD |
| /api/[tenant]/admin/ai-config | GET/POST | JWT | AI provider config |
| /api/[tenant]/admin/assign-role | POST | JWT | Role assignment |
| /api/[tenant]/admin/payment-gateway | GET/POST | JWT | Payment config |
| /api/[tenant]/admin/webhooks | GET/POST/DELETE | JWT | Webhook CRUD |
| /api/[tenant]/admin/webhooks/test | POST | JWT | Webhook test ping |
| /api/[tenant]/approvals/action | POST | JWT | Approve/reject case |
| /api/[tenant]/export-pdf | POST | JWT | PDF generation |
| /api/[tenant]/compliance/export | GET | JWT | Compliance report |
| /api/[tenant]/audit/export | GET | JWT | Audit log export |
| /[tenant]/cases/[id]/submit | POST | JWT | Submit case for approval |

---

## 12. COMPETITIVE LANDSCAPE

Full analysis at `docs/competitive-analysis.md` (348 lines, ~30KB). 10 competitors analyzed.

### Key Findings
- **E-Logbook wins on**: offline-first mobile, AI clinical insights, multi-provider AI, compliance infrastructure (PHI redaction, append-only audit, pgcrypto encryption, SCIM, SAML/OIDC SSO)
- **Top gaps to close**: rotation scheduling/calendar (ties directors to New Innovations), ACGME Milestones sub-competency granularity (22 competencies × 5 levels with EPA mapping), Mini-CEX/DOPS/CBD evaluation forms
- **Biggest threat**: New Innovations has ~80% US GME market share with high switching costs
- **Best opportunity**: AI is a first-mover territory — zero competitors have any AI capability

See `docs/competitive-analysis.md` for the full capability matrix, strategic opportunity matrix, threat assessment, and prioritized recommendations.

---

## 13. CI/CD PIPELINE

### GitHub Actions Workflows
| Workflow | Trigger | Jobs |
|----------|---------|------|
| CI | PR + push to main | typecheck → lint → test (284 tests) → build-web (30 routes) |
| CD | push to main | deploy-web (Vercel) |
| deploy-mobile | manual/tag | EAS Build + Submit |
| deploy-preview | PR | Vercel preview deployment |
| Security | weekly | CodeQL + Semgrep + container scan + DAST + SBOM |

---

## 14. KNOWN GAPS & NEXT STEPS

### Pending Configuration (needs credentials)
1. **UPSTASH_REDIS_REST_URL** + **UPSTASH_REDIS_REST_TOKEN** — activates Redis-backed rate limiter (currently in-memory with auto-fallback)
2. **NEXT_PUBLIC_SENTRY_DSN** — enables runtime error monitoring
3. **Custom domain** on Vercel — bypasses Security Checkpoint on Hobby plan
4. **Supabase SMTP** — enables password reset emails

### Known Blockers
5. `supabase db reset` requires Docker (not on this machine)
6. No E2E smoke tests (Vercel Security Checkpoint blocks headless browsers on Hobby)
7. No k6 load tests executed (script exists)
8. Edge function tests not implemented

### Coverage Gaps
9. `sync.ts` (mobile) at 49.3%
10. `auth.ts` (server) at 21.05%

### Enterprise Upgrade Roadmap

**Phase A — Production Hardening (1-2 weeks)**
1. Set env vars (Upstash, Sentry, SMTP)
2. Add custom domain to Vercel
3. Run `supabase db reset` from Docker machine
4. Deploy Playwright smoke tests

**Phase B — Feature Parity (4-6 weeks)**
1. Enhanced reporting dashboard (like New Innovations)
2. PDF export with accreditation visualization
3. Multi-language (expand current i18n)
4. EMR/EHR integration (FHIR/HL7)
5. Advanced analytics for program directors
6. Mass user invite/onboarding
7. Bulk CSV import for cases
8. Calendar view for duty hours

**Phase C — Enterprise Differentiators (8-12 weeks)**
1. AI-powered case suggestions (auto-fill from patient data)
2. Competency gap analysis with AI recommendations
3. Automated accreditation report generation
4. Cross-institution benchmarking (anonymized)
5. Mobile document capture with OCR
6. Voice-to-text case logging
7. API marketplace for third-party integrations
8. White-label / custom branding per institution
