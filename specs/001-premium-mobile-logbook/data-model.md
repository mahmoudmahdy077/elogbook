# Data Model: Premium Mobile Logbook

**Feature**: [spec.md](./spec.md) | **Date**: 2026-06-11

## Entity Changes Summary

| Entity | Action | Rationale |
|--------|--------|-----------|
| `tenants` | MODIFY | Add data residency fields (region, data_retention_days, consent_required) |
| `case_entries` | No schema change | Existing schema already supports all FR requirements |
| `approval_requests` | No schema change | Existing workflow covers verification |
| `ai_query_logs` | MODIFY | Add disclaimer_rendered, response_format fields |
| `subscription_plans` | No schema change | Existing 5-plan structure covers SaaS tiers |
| `subscriptions` | No schema change | Existing status lifecycle covers billing |
| `institution_billing` | No schema change | Existing table covers institutional invoices |
| `accreditation_frameworks` | No schema change | Existing JSONB milestones cover all frameworks |

## Modified Entities

### Tenant (MODIFY)

Add data residency and compliance configuration fields:

| Field | Type | Default | Constraint | Description |
|-------|------|---------|------------|-------------|
| `region` | `TEXT` | `'us-east-1'` | NOT NULL | Data residency region (e.g., `eu-west-1`, `me-central-1`, `ap-southeast-1`) |
| `data_retention_days` | `INTEGER` | `2555` | CHECK (>0) | Data retention period in days (default 7 years) |
| `consent_required` | `BOOLEAN` | `true` | NOT NULL | Whether patient consent must be obtained before logging identifiable cases |
| `compliance_frameworks` | `TEXT[]` | `'{}'` | — | Array of applicable regulatory frameworks (e.g., `{HIPAA, GDPR, SCFHS}`) |

**Migration**: `ALTER TABLE tenants ADD COLUMN region TEXT NOT NULL DEFAULT 'us-east-1', ADD COLUMN data_retention_days INTEGER DEFAULT 2555, ADD COLUMN consent_required BOOLEAN DEFAULT true, ADD COLUMN compliance_frameworks TEXT[] DEFAULT '{}';`

### AI Query Log (MODIFY)

Add tracking for AI safety compliance:

| Field | Type | Default | Constraint | Description |
|-------|------|---------|------------|-------------|
| `disclaimer_rendered` | `BOOLEAN` | `false` | NOT NULL | Whether the mandatory educational disclaimer was included in the response |
| `response_format` | `TEXT` | `'text'` | CHECK ('text', 'stream') | How the response was delivered (batch or streaming) |
| `safety_flags` | `TEXT[]` | `'{}'` | — | Array of triggered safety guardrails (e.g., `{blocked_diagnosis, blocked_prescription}`) |

**Migration**: `ALTER TABLE ai_query_logs ADD COLUMN disclaimer_rendered BOOLEAN DEFAULT false, ADD COLUMN response_format TEXT DEFAULT 'text', ADD COLUMN safety_flags TEXT[] DEFAULT '{}';`

## State Transitions

### Case Entry Lifecycle (Unchanged)

```
draft ──→ pending ──→ approved
  ↑                     │
  │        ┌────────────┘
  │        ▼
  └── rejected (resident edits → new draft)
```

**Rules**:
- `draft → pending`: Resident submits for verification
- `pending → approved`: Supervisor approves
- `pending → rejected`: Supervisor rejects with comment
- `rejected → draft`: Resident edits and resubmits (creates new draft, original rejected entry preserved)
- Write-once: Once `pending`, resident cannot modify (enforced by `write_once_submitted_check` trigger)

### Offline Draft Lifecycle (New)

```
local_draft ──→ syncing ──→ pending (server)
                   │
                   ├──→ conflict_draft (server state saved, local edits preserved)
                   └──→ error_draft (retry later)
```

**Rules**:
- `local_draft`: Created when offline or on submission failure
- `syncing`: Push to Supabase in progress
- `conflict_draft`: Server state took precedence; local edits preserved as separate draft
- `error_draft`: Push failed; retry on next sync cycle

### Subscription Lifecycle (Existing, Unchanged)

```
trialing → active → past_due → active
              ↓         ↓
          canceled   unpaid
```

### AI Query Lifecycle (New)

```
idle → processing → complete (response + disclaimer + safety check)
              ↓
          error (timeout, provider unavailable, safety block)
              ↓
          throttled (quota exhausted, AI disabled)
```

## Entity Relationship Diagram (Relevant Subset)

```
tenants (MODIFIED) ──(1:N)── profiles
    │
    ├──(1:N)── case_entries
    │              ├──(1:N)── approval_requests
    │              └──(1:N)── case_attachments
    │
    ├──(1:1)── ai_config
    ├──(1:N)── ai_query_logs (MODIFIED)
    ├──(1:1)── payment_gateway_config
    ├──(1:N)── subscriptions ──(N:1)── subscription_plans
    ├──(1:N)── institution_billing
    ├──(1:N)── accreditation_frameworks
    └──(1:N)── program_goals ──(1:1)── goal_progress
```

## Validation Rules

### New: AI Query Validation (aiQuerySchema)

```typescript
// packages/shared/src/schemas/cases.ts — new export
const aiQuerySchema = z.object({
  query: z.string().min(1).max(500),
  resident_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  stream: z.boolean().default(false),
});
```

### New: Compliance Configuration Validation

```typescript
// packages/shared/src/schemas/auth.ts — new export
const complianceConfigSchema = z.object({
  region: z.enum(['us-east-1', 'eu-west-1', 'me-central-1', 'ap-southeast-1']),
  data_retention_days: z.number().int().min(365).max(3650),
  consent_required: z.boolean(),
  compliance_frameworks: z.array(z.enum(['hipaa', 'gdpr', 'scfhs', 'gmc', 'pipeda', 'australian_privacy'])),
});
```

### New: Institution Billing Schema Enhancement

```typescript
// packages/shared/src/schemas/subscriptions.ts — modify subscriptionPlanSchema
// Add: max_ai_queries_per_resident INTEGER (nullable)
// Add: custom_branding BOOLEAN DEFAULT false
// Add: priority_support BOOLEAN DEFAULT false
```
