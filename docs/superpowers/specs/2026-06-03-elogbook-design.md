# E-Logbook — System Design

**Date:** 2026-06-03  
**Status:** Draft  
**Stack:** Supabase + Next.js 14 + Expo (React Native) + HeroUI

## Overview

Multi-tenant SaaS electronic logbook for junior residents and doctors to log medical cases across multiple specialties. Supports full role hierarchy (Resident → Supervisor → Program Director → Institution Admin → System Admin) with approval workflows, program goals tracking, AI-powered insights (paid addon), and HIPAA-compliant PHI handling.

---

## 1. Architecture

### High-Level

```
┌──────────────────────────────────────────┐
│              Client Layer                 │
│  Next.js 14 (Web)  │  Expo/RN (Mobile)   │
├──────────────────────────────────────────┤
│            Supabase Backend               │
│  Auth (GoTrue)  │  PostgreSQL + RLS       │
│  Storage        │  Realtime               │
│  Edge Functions │  (PDF, AI, Webhooks)    │
└──────────────────────────────────────────┘
```

### Multi-Tenancy

- All data tables include `tenant_id`
- **Row-Level Security (RLS)** enforces `tenant_id = auth.jwt()->tenant_id` at DB level
- **Institutions** sit above tenants — one institution can manage multiple programs
- RLS policies cascade: institution_admin sees all tenants under their institution

### Monorepo Structure

```
/apps
  /web          → Next.js 14 (App Router)
  /mobile       → Expo (React Native)
/packages
  /shared       → types, Zod schemas, API client
  /supabase     → generated types, migrations, RLS policies, seed data
```

---

## 2. Data Model

### Organization & Users

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `institutions` | id, name, slug, settings (JSONB), tier | Top-level org (ministry, university hospital group) |
| `tenants` | id, institution_id (nullable), name, slug, tenant_type, plan_id, settings (JSONB) | Training program or individual account. institution_id is null for individual tenants. |
| `profiles` | id, tenant_id, user_id (↗ auth.users), role, full_name, specialty | User profiles linked to Supabase Auth |

### Case Logging

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `case_templates` | id, tenant_id, specialty, name, fields (JSONB), required_fields | Per-specialty entry form definitions |
| `case_entries` | id, tenant_id, resident_id, template_id, patient_mrn, patient_dob, case_date, field_values (JSONB), status | Actual logged cases |
| `case_attachments` | id, entry_id, file_path, file_type, uploaded_at | Files/images attached to cases |

**Fields strategy:** JSONB for `fields`/`field_values` — each specialty defines its own form fields (surgery: procedure_name, anesthesia_type, supervision_level; radiology: modality, body_part, findings). GIN-indexed for query performance. Avoids EAV pattern or per-specialty tables.

### Approval & Audit

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `approval_requests` | id, entry_id, supervisor_id, status, comment, requested_at, resolved_at | Supervisor sign-off per entry |
| `audit_logs` | id, tenant_id, user_id, action, resource_type, resource_id, changes (JSONB), ip_address, created_at | HIPAA-required immutable access trail |

### AI Insights (Paid Addon)

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `ai_config` | id, tenant_id, provider, model, encrypted_api_key, endpoint_url, is_active | Per-tenant AI provider settings |
| `resident_ai_toggle` | id, tenant_id, resident_id, enabled, quota_limit | Admin per-resident enable/disable |
| `ai_query_logs` | id, tenant_id, resident_id, query, response, tokens_used, created_at | Audit trail for AI usage |

### Program Goals

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `program_goals` | id, tenant_id, director_id, resident_id, title, target_count, specialty (nullable), deadline, description | Director-set targets per resident |
| `goal_progress` | id, goal_id, resident_id, current_count, last_updated | Computed progress (DB trigger on case insert/update/delete) |

---

## 3. User Roles & Permissions

| Role | Create Cases | View Own | View Team | Approve | Export PDF | Set Goals | Manage Users | Templates | Reports |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `resident` | ✅ | ✅ | — | — | ✅ own | — | — | — | Own progress |
| `supervisor` | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | Team stats |
| `director` | — | — | ✅ | — | ✅ | ✅ | ✅ residents | ✅ | Full program |
| `institution_admin` | — | — | ✅ all programs | — | ✅ | — | ✅ directors + residents | — | Cross-program |
| `admin` | — | — | — | — | ✅ | — | ✅ all | ✅ | System-wide |

**Hierarchy:** resident → supervisor → director → institution_admin → admin  
Higher roles inherit lower-role permissions. Implemented via Supabase Auth `app_metadata` JWT claims + RLS policies.

### Approval Workflow

```
Resident logs case → DRAFT → Submit → PENDING → Supervisor reviews → APPROVED / REJECTED
```

**Individual premium tenants:** No supervisor role. Submit → auto-APPROVED (self-attestation). No `approval_requests` created.

---

## 4. Modules

### 4.1 Case Logging
- Template-driven forms per specialty (driven by `case_templates.fields` JSONB)
- Draft auto-save, file/image attachments, offline support (mobile)
- Patient PHI: MRN, DOB — encrypted at rest, access logged in audit trail

### 4.2 Approval Dashboard
- Supervisor queue: pending cases with accept/reject actions + comments
- Bulk approve support
- Push notification triggers on status change (mobile + web)

### 4.3 Analytics & Reports
- Case counts by specialty, period, status, resident
- Charts and dashboards
- PDF export via Edge Function using Puppeteer — hospital letterhead, signatures, approval stamps

### 4.4 Admin Panel
- Manage institutions, programs, users, roles
- Create/edit case templates per specialty
- AI provider configuration + per-resident toggle
- Subscription tier & addon billing management

### 4.5 Audit & Compliance
- Immutable audit trail — all PHI access logged
- Data retention policies
- Export for external audits

### 4.6 Mobile Offline
- Offline-first case logging with local queue (AsyncStorage/SQLite)
- Auto-sync when connectivity returns
- Camera integration → Supabase Storage upload
- Push notifications via Expo Notifications

### 4.7 Goals & Milestones
- Program directors set per-resident targets (procedure counts, specialty exposure, deadlines)
- Progress auto-calculated from logged cases via DB trigger
- Dashboard with % completion and at-risk alerts
- Export goal progress to PDF for portfolio reviews

### 4.8 AI Insights (Paid Addon)
- AI-generated case summaries and trend analysis per resident
- Learning gap detection (e.g., "low exposure to pediatric cases")
- Natural language query: "Show my cardiac procedures this quarter"
- Admin controls: per-resident enable/disable, provider selection, model selection, usage quotas
- Supported providers: OpenAI, Anthropic, Azure, OpenRouter, custom endpoint
- API keys encrypted at rest (Supabase Vault)
- Billed per resident/month via tenant subscription

---

## 5. Frontend Architecture

### Design System
- **HeroUI** (NextUI v2) for all web components — Card, Table, Modal, Navbar, Dropdown, Tabs, Badge, Chip, Input, DatePicker
- Dark theme by default with medical-grade accessibility (WCAG AA+)
- **NativeWind** (Tailwind for React Native) for mobile — HeroUI-inspired theme tokens for visual consistency

### Web Routes (Next.js App Router)

| Route | Page |
|-------|------|
| `/login` | Supabase Auth — magic link, SSO |
| `/[tenant]/dashboard` | Resident: case counts, quick-log, goal progress rings |
| `/[tenant]/cases` | Case list — filters, search, status badges |
| `/[tenant]/cases/new` | Template-driven entry form |
| `/[tenant]/cases/[id]` | Detail view + attachments + approval timeline |
| `/[tenant]/approvals` | Supervisor review queue |
| `/[tenant]/goals` | Director: set goals. Resident: track progress |
| `/[tenant]/admin` | Users, templates, institution, AI config, billing |
| `/[tenant]/reports` | Analytics, charts, PDF export |
| `/[tenant]/audit` | Audit trail viewer (admin only) |

### Mobile (Expo)

| Tab | Screen |
|-----|--------|
| Dashboard | Case counts, goal rings, quick-actions |
| Log Case | Template-driven form, camera, offline queue |
| My Cases | List + filters, swipe to submit for approval |
| Approvals | Supervisor: pending queue with accept/reject |
| Profile | Settings, sync status, logout |

---

## 6. Subscriptions & Monetization

### Package Types

| Package | Audience | Monthly Fee | Features |
|---------|----------|:-----------:|----------|
| **Free** | Individual resident | $0 | Up to 20 cases, basic templates, no AI |
| **Individual Premium** | Resident (no institution) | $9.99 | Unlimited cases, AI insights, PDF export, **no approval required** — self-managed logbook |
| **Institution Basic** | Training program | $49.99 | Up to 10 residents, full approval workflow, templates, reports |
| **Institution Pro** | Training program | $149.99 | Up to 50 residents, goals & milestones, audit trail, custom templates |
| **Institution Enterprise** | Hospital group / Ministry | Custom | Unlimited residents, all features, SSO, dedicated support, BAA included |

### Individual Premium (No Institution)

- Residents whose program isn't on the platform can purchase **Individual Premium**
- Creates a personal tenant (`tenant_type = 'individual'`) — no institution linkage
- **No approval workflow** — cases go directly to APPROVED on submit
- Acts as their own supervisor for compliance (self-attestation)
- Full access to AI insights, PDF export, goals (self-set)
- Can later be claimed by an institution if their program joins

### AI Analysis One-Time Purchase

- Available to **any resident** (free or premium) as a per-use purchase
- Generates a comprehensive AI progress report: strengths, gaps, trends, recommendations
- One-time fee: **$4.99** per report
- No subscription required — pay as you go

### Database Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `subscription_plans` | id, name, slug, price_monthly, features (JSONB), tenant_type, max_residents | Plan definitions |
| `subscriptions` | id, tenant_id, plan_id, status, stripe_subscription_id, current_period_start, current_period_end | Active subscriptions per tenant |
| `payments` | id, tenant_id, amount, currency, stripe_payment_intent_id, status, created_at | Payment history |
| `one_time_purchases` | id, resident_id, purchase_type, amount, stripe_payment_intent_id, status, consumed, created_at | AI reports and other one-off purchases |

### Tenant Type

Add to `tenants` table:

| Column | Values | Purpose |
|--------|--------|---------|
| `tenant_type` | `'individual'` \| `'institution'` | Determines workflow and feature availability |
| `plan_id` | FK → subscription_plans | Current active plan |

### Stripe Integration

- **Stripe Checkout** for subscription signup and one-time purchases
- Webhook endpoint (Edge Function) handles `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`
- Syncs subscription status to `subscriptions` table
- One-time AI purchase triggers Edge Function to generate report upon payment confirmation

### Gateway-Agnostic Design

Admin configures the payment gateway from the dashboard — not hardcoded. All gateways share a common interface:

| Gateway | Subscription | One-Time | Webhook Support |
|---------|:---:|:---:|:---:|
| Stripe | ✅ | ✅ | ✅ |
| Paddle | ✅ | ✅ | ✅ |
| LemonSqueezy | ✅ | ✅ | ✅ |
| Custom | via endpoint_url | via endpoint_url | custom |

**Table: `payment_gateway_config`**

| Column | Purpose |
|--------|---------|
| `tenant_id` | FK → tenants |
| `provider` | `'stripe'` \| `'paddle'` \| `'lemonsqueezy'` \| `'custom'` |
| `publishable_key` | Client-side key |
| `encrypted_secret_key` | Server-side key (Vault) |
| `encrypted_webhook_secret` | Webhook verification (Vault) |
| `endpoint_url` | For custom gateways |
| `is_active` | Toggle |

**Payment Adapter Pattern:** Edge function `payment-webhook` reads `payment_gateway_config`, routes to the appropriate adapter. Client-side uses the configured provider's SDK (Stripe.js, Paddle.js, etc.) based on the config.

### Edge Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `stripe-webhook` | Stripe events | Sync payments, subscriptions, provisioning |
| `ai-report-purchase` | `one_time_purchases` insert | Generate and deliver AI report on confirmed payment |

---

## 7. HIPAA / Compliance

- **Encryption at rest:** Supabase-managed PostgreSQL encryption
- **Encryption in transit:** TLS 1.3 enforced
- **Audit trail:** `audit_logs` captures every read/write on PHI-tagged records
- **Access control:** RLS at database level, JWT claims for role enforcement
- **Data retention:** Configurable per tenant, automated purging of expired records
- **API keys:** Encrypted via Supabase Vault for AI provider credentials
- **BA/BA Agreement:** Supabase offers HIPAA-compliant enterprise plans

---

## 8. Edge Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `generate-pdf` | HTTP request | Puppeteer-based PDF export of case logbook |
| `ai-insights` | HTTP request | Proxies to configured LLM provider with tenant API key |
| `goal-progress-update` | DB trigger | Recalculates `goal_progress` on case insert/update |
| `approval-notification` | DB trigger | Pushes notification on approval status change |
| `payment-webhook` | Gateway events | Routes to Stripe/Paddle/LemonSqueezy adapter based on config |
| `ai-report-purchase` | HTTP request | Generates AI report on confirmed one-time payment |

---

## 9. Key Design Decisions

1. **JSONB over EAV:** Simpler queries, GIN-indexable, avoids join explosion
2. **RLS over middleware:** Database-level tenant isolation — no application-layer data leaks
3. **Supabase Edge Functions over separate backend:** Single platform for auth, DB, storage, compute — reduces infrastructure surface
4. **HeroUI + NativeWind over custom design:** Faster development, built-in accessibility, consistent across platforms
5. **OpenRouter support in AI config:** Single endpoint for 200+ models, no vendor lock-in
6. **Dual tenant model (individual + institution):** Same schema, different workflows — individual tenants skip approval, institution tenants use full hierarchy. Avoids code forking.
