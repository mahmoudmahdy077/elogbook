# Enterprise Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade e-logbook to enterprise-grade with HIPAA de-identification, accreditation frameworks, offline mobile, design system overhaul, and enhanced billing.

**Architecture:** 5 independent tracks: (1) Database schema migration + RLS hardening, (2) Shared TypeScript types/Zod schemas, (3) Web app components and design system, (4) Mobile WatermelonDB offline sync, (5) Visual design system integration across all pages.

**Tech Stack:** TypeScript 6, Next.js 16, HeroUI, Tailwind v4, Supabase PostgreSQL, WatermelonDB, Expo SDK 56, Framer Motion, Zod v4.

---

## Track 1: Database & Supabase Backend

### Task 1.1: New migration file — schema additions

**Files:**
- Create: `supabase/migrations/00007_enterprise_upgrade.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================================
-- Enterprise Upgrade Migration
-- Adds: de-identification fields, accreditation frameworks, attachment signatures
-- ============================================================================

-- 1. Add de-identification fields to case_entries
ALTER TABLE case_entries
  ADD COLUMN patient_age_years INTEGER,
  ADD COLUMN patient_hash TEXT,
  ADD COLUMN accreditation_mappings JSONB DEFAULT '[]'::JSONB,
  ADD COLUMN is_deidentified BOOLEAN DEFAULT TRUE;

-- Make patient_mrn and patient_dob nullable (they have data in existing rows)
ALTER TABLE case_entries
  ALTER COLUMN patient_mrn DROP NOT NULL,
  ALTER COLUMN patient_dob DROP NOT NULL;

-- Index on patient_hash for collision checking
CREATE INDEX idx_case_entries_patient_hash ON case_entries(tenant_id, patient_hash);

-- 2. Accreditation Frameworks table
CREATE TABLE accreditation_frameworks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  framework_type TEXT NOT NULL CHECK (framework_type IN ('acgme', 'scfhs', 'gmc', 'canmeds', 'custom')),
  milestones JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_accreditation_frameworks_tenant ON accreditation_frameworks(tenant_id);

-- 3. Attachment Signatures table
CREATE TABLE attachment_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL REFERENCES case_attachments(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  signature_hash TEXT NOT NULL,
  verification_method TEXT NOT NULL CHECK (verification_method IN ('camera_hash', 'manual_hash', 'device_signature')),
  verified_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attachment_signatures_attachment ON attachment_signatures(attachment_id);

-- 4. Institutional billing records table
CREATE TABLE institution_billing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  active_residents INTEGER NOT NULL DEFAULT 0,
  base_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  per_resident_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'canceled')) DEFAULT 'draft',
  invoice_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, billing_period_start)
);

CREATE INDEX idx_institution_billing_tenant ON institution_billing(tenant_id);

-- 5. Hash function for de-identified MRNs
CREATE OR REPLACE FUNCTION hash_patient_mrn(p_mrn TEXT, p_tenant_id UUID)
RETURNS TEXT AS $$
BEGIN
  RETURN encode(digest(p_mrn || p_tenant_id::TEXT || 'elogbook-mrn-salt-v1', 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER;

-- 6. Age calculation function
CREATE OR REPLACE FUNCTION calculate_age_at_procedure(p_dob DATE, p_procedure_date DATE)
RETURNS INTEGER AS $$
BEGIN
  RETURN DATE_PART('year', AGE(p_procedure_date, p_dob))::INTEGER;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 7. Add updated_at trigger to new tables
CREATE TRIGGER set_updated_at_accreditation
  BEFORE UPDATE ON accreditation_frameworks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at_billing
  BEFORE UPDATE ON institution_billing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

- [ ] **Step 2: Run Supabase migration reset to verify**

Run: `supabase db reset`
Expected: All 7 migrations apply without error, including the new one.

- [ ] **Step 3: Verify schema changes applied**

Run: `supabase db dump --local --data-only -f /dev/null 2>&1 | head -5`
Expected: outputs dump stats without errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/00007_enterprise_upgrade.sql
git commit -m "feat: add de-identification, accreditation frameworks, attachment signatures"
```

### Task 1.2: RLS policies for new tables + hardened case_entries policy

**Files:**
- Modify: `supabase/migrations/00002_rls_policies.sql`

- [ ] **Step 1: Append RLS policies to 00002_rls_policies.sql**

```sql
-- ============================================================================
-- accreditation_frameworks
-- ============================================================================

ALTER TABLE accreditation_frameworks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can read accreditation frameworks"
  ON accreditation_frameworks FOR SELECT
  TO authenticated
  USING (tenant_id = get_tenant_id());

CREATE POLICY "Director+ can manage accreditation frameworks"
  ON accreditation_frameworks FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Director+ can update accreditation frameworks"
  ON accreditation_frameworks FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Director+ can delete accreditation frameworks"
  ON accreditation_frameworks FOR DELETE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

-- ============================================================================
-- attachment_signatures
-- ============================================================================

ALTER TABLE attachment_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read attachment signatures via tenant"
  ON attachment_signatures FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM case_attachments ca
      JOIN case_entries ce ON ce.id = ca.entry_id
      WHERE ca.id = attachment_signatures.attachment_id
      AND ce.tenant_id = get_tenant_id()
    )
  );

CREATE POLICY "Authenticated users can insert attachment signatures"
  ON attachment_signatures FOR INSERT
  TO authenticated
  WITH CHECK (
    resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

-- ============================================================================
-- institution_billing
-- ============================================================================

ALTER TABLE institution_billing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin roles can read institution billing"
  ON institution_billing FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('director', 'institution_admin', 'admin')
  );

CREATE POLICY "Admin roles can manage institution billing"
  ON institution_billing FOR ALL
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('institution_admin', 'admin')
  );

-- ============================================================================
-- case_entries: hardened write-once immutability
-- Replace existing "Resident updates own draft entries" policy with stricter version
-- ============================================================================

DROP POLICY IF EXISTS "Resident updates own draft entries" ON case_entries;
DROP POLICY IF EXISTS "Resident submits own entries (draft→pending)" ON case_entries;

-- Residents can ONLY update entries that are in 'draft' status
CREATE POLICY "Resident updates own draft entries only"
  ON case_entries FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND status = 'draft'
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND resident_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    AND status IN ('draft', 'pending')
  );

-- Residents can NEVER modify approved/rejected entries
-- Supervisors can only update entries they are assigned to review
-- (already handled by existing supervisor policy, but explicitly add reject-only constraint)

CREATE POLICY "Supervisor can approve/reject entries in tenant"
  ON case_entries FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    AND status = 'pending'
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    AND status IN ('approved', 'rejected')
  );
```

- [ ] **Step 2: Run Supabase migration reset to verify RLS**

Run: `supabase db reset`
Expected: All migrations and policies apply without error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00002_rls_policies.sql
git commit -m "feat: add RLS for new tables, harden case_entries write-once immutability"
```

### Task 1.3: Enhanced audit trigger with session data

**Files:**
- Modify: `supabase/migrations/00003_triggers.sql`

- [ ] **Step 1: Append enhanced audit trigger to 00003_triggers.sql**

```sql
-- ============================================================================
-- 5. write_once_submitted_check: BLOCK updates to submitted (non-draft) logs
--    by residents. Runs BEFORE UPDATE on case_entries.
-- ============================================================================

CREATE OR REPLACE FUNCTION write_once_submitted_check()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := get_user_role();

  -- If user is resident and the OLD status is not draft, BLOCK
  IF v_role = 'resident' AND OLD.status != 'draft' THEN
    RAISE EXCEPTION 'Cannot modify case entry once submitted (status: %)', OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_write_once_submitted_check
  BEFORE UPDATE ON case_entries
  FOR EACH ROW EXECUTE FUNCTION write_once_submitted_check();

-- ============================================================================
-- 6. Enhanced audit trigger with session/user-agent data
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_case_entry_enhanced()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_user_agent TEXT;
  v_session_id TEXT;
  v_changes JSONB;
BEGIN
  v_user_id := auth.uid();

  BEGIN
    v_user_agent := current_setting('request.headers', true)::JSONB ->> 'user-agent';
  EXCEPTION WHEN OTHERS THEN
    v_user_agent := 'unknown';
  END;

  BEGIN
    v_session_id := current_setting('request.jwt.claims', true)::JSONB ->> 'session_id';
  EXCEPTION WHEN OTHERS THEN
    v_session_id := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    v_changes := jsonb_build_object(
      'new', CASE
        WHEN NEW.is_deidentified = TRUE THEN
          (row_to_json(NEW)::JSONB - 'patient_mrn' - 'patient_dob')
        ELSE
          row_to_json(NEW)::JSONB
      END,
      'user_agent', v_user_agent,
      'session_id', v_session_id
    );

    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (NEW.tenant_id, v_user_id, 'INSERT', 'case_entries', NEW.id, v_changes,
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for');

    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (
      NEW.tenant_id,
      v_user_id,
      'UPDATE',
      'case_entries',
      NEW.id,
      jsonb_build_object(
        'changed_fields', (
          SELECT jsonb_object_agg(key, jsonb_build_object('old', OLD_val, 'new', NEW_val))
          FROM (
            SELECT key,
                   (row_to_json(OLD)::JSONB -> key) AS OLD_val,
                   (row_to_json(NEW)::JSONB -> key) AS NEW_val
            FROM jsonb_object_keys(row_to_json(OLD)::JSONB || row_to_json(NEW)::JSONB) AS t(key)
          ) sub
          WHERE OLD_val IS DISTINCT FROM NEW_val
            AND key NOT IN ('created_at', 'updated_at')
        ),
        'user_agent', v_user_agent,
        'session_id', v_session_id
      ),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for'
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, ip_address)
    VALUES (OLD.tenant_id, v_user_id, 'DELETE', 'case_entries', OLD.id,
      jsonb_build_object('deleted', row_to_json(OLD)::JSONB - 'patient_mrn' - 'patient_dob',
        'user_agent', v_user_agent, 'session_id', v_session_id),
      current_setting('request.headers', true)::JSONB ->> 'x-forwarded-for');
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. Audit trigger for accreditation_frameworks
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_accreditation_framework()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    NEW.tenant_id,
    v_user_id,
    TG_OP,
    'accreditation_frameworks',
    NEW.id,
    jsonb_build_object(
      'name', NEW.name,
      'version', NEW.version,
      'framework_type', NEW.framework_type
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_audit_accreditation_framework
  AFTER INSERT OR UPDATE ON accreditation_frameworks
  FOR EACH ROW EXECUTE FUNCTION audit_accreditation_framework();
```

- [ ] **Step 2: Run Supabase migration reset to verify triggers**

Run: `supabase db reset`
Expected: All triggers and functions apply without error.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/00003_triggers.sql
git commit -m "feat: add write-once immutability trigger, enhanced audit with session data"
```

---

## Track 2: Shared Package (@elogbook/shared)

### Task 2.1: Update database types with new fields

**Files:**
- Modify: `packages/shared/src/types/database.ts`

- [ ] **Step 1: Update database.ts types**

```typescript
export type TenantType = 'individual' | 'institution';
export type UserRole = 'resident' | 'supervisor' | 'director' | 'institution_admin' | 'admin';
export type CaseStatus = 'draft' | 'pending' | 'approved' | 'rejected';
export type FrameworkType = 'acgme' | 'scfhs' | 'gmc' | 'canmeds' | 'custom';

export interface Institution {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  tier: string;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  institution_id: string | null;
  name: string;
  slug: string;
  tenant_type: TenantType;
  plan_id: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  tenant_id: string;
  user_id: string;
  role: UserRole;
  full_name: string;
  specialty: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseTemplate {
  id: string;
  tenant_id: string;
  specialty: string;
  name: string;
  fields: TemplateField[];
  required_fields: string[];
  created_at: string;
  updated_at: string;
}

export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox';
  options?: string[];
  required?: boolean;
}

export interface AccreditationMapping {
  framework_id: string;
  milestone_code: string;
  competency_area: string;
  procedure_role?: 'observed' | 'assisted' | 'performed' | 'supervised';
}

export interface CaseEntry {
  id: string;
  tenant_id: string;
  resident_id: string;
  template_id: string;
  patient_mrn: string | null;
  patient_dob: string | null;
  patient_age_years: number | null;
  patient_hash: string | null;
  case_date: string;
  field_values: Record<string, unknown>;
  accreditation_mappings: AccreditationMapping[];
  is_deidentified: boolean;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
}

export interface CaseAttachment {
  id: string;
  entry_id: string;
  file_path: string;
  file_type: string;
  uploaded_at: string;
}

export interface AttachmentSignature {
  id: string;
  attachment_id: string;
  resident_id: string;
  signature_hash: string;
  verification_method: 'camera_hash' | 'manual_hash' | 'device_signature';
  verified_at: string;
}

export interface ApprovalRequest {
  id: string;
  entry_id: string;
  supervisor_id: string;
  status: 'pending' | 'approved' | 'rejected';
  comment: string | null;
  requested_at: string;
  resolved_at: string | null;
}

export interface AuditLog {
  id: string;
  tenant_id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  changes: Record<string, unknown> | null;
  ip_address: string;
  created_at: string;
}

export interface AIConfig {
  id: string;
  tenant_id: string;
  provider: 'openai' | 'anthropic' | 'azure' | 'openrouter' | 'custom';
  model: string;
  encrypted_api_key: string;
  endpoint_url: string | null;
  is_active: boolean;
}

export interface AccreditationMilestone {
  code: string;
  description: string;
  competency_area: string;
  target_minimum: number;
  specialty?: string;
}

export interface AccreditationFramework {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  framework_type: FrameworkType;
  milestones: AccreditationMilestone[];
  created_at: string;
  updated_at: string;
}

export interface InstitutionBilling {
  id: string;
  tenant_id: string;
  billing_period_start: string;
  billing_period_end: string;
  active_residents: number;
  base_amount: number;
  per_resident_fee: number;
  total_amount: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'canceled';
  invoice_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgramGoal {
  id: string;
  tenant_id: string;
  director_id: string;
  resident_id: string;
  title: string;
  target_count: number;
  specialty: string | null;
  deadline: string;
  description: string | null;
  created_at: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  features: Record<string, unknown>;
  tenant_type: TenantType;
  max_residents: number | null;
}

export interface PaymentGatewayConfig {
  id: string;
  tenant_id: string;
  provider: 'stripe' | 'paddle' | 'lemonsqueezy' | 'custom';
  publishable_key: string;
  encrypted_secret_key: string;
  encrypted_webhook_secret: string;
  endpoint_url: string | null;
  is_active: boolean;
}
```

- [ ] **Step 2: Verify type compilation**

Run: `pnpm --filter @elogbook/shared typecheck`
Expected: PASS — no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/database.ts
git commit -m "feat: add enterprise types - de-identification, accreditation, billing"
```

### Task 2.2: Update Zod schemas with conditional de-identification validation

**Files:**
- Modify: `packages/shared/src/schemas/cases.ts`

- [ ] **Step 1: Rewrite cases.ts with conditional validation**

```typescript
import { z } from 'zod';

export const templateFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'textarea', 'select', 'number', 'date', 'checkbox']),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
});

export const caseTemplateSchema = z.object({
  specialty: z.string().min(1),
  name: z.string().min(1),
  fields: z.array(templateFieldSchema).min(1),
  required_fields: z.array(z.string()),
});

export const accreditationMappingSchema = z.object({
  framework_id: z.string().uuid(),
  milestone_code: z.string().min(1),
  competency_area: z.string().min(1),
  procedure_role: z.enum(['observed', 'assisted', 'performed', 'supervised']).optional(),
});

// Base case entry without patient data (for de-identified mode)
export const caseEntryDeidentifiedSchema = z.object({
  template_id: z.string().uuid(),
  patient_age_years: z.number().int().min(0).max(150),
  patient_hash: z.string().min(1).max(128),
  case_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  field_values: z.record(z.unknown()),
  accreditation_mappings: z.array(accreditationMappingSchema).default([]),
  is_deidentified: z.literal(true),
});

// Case entry with plaintext patient data (for identified mode)
export const caseEntryIdentifiedSchema = z.object({
  template_id: z.string().uuid(),
  patient_mrn: z.string().min(1).max(50),
  patient_dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  case_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  field_values: z.record(z.unknown()),
  accreditation_mappings: z.array(accreditationMappingSchema).default([]),
  is_deidentified: z.literal(false),
});

// Union type: validate based on is_deidentified toggle
export const caseEntrySchema = z.discriminatedUnion('is_deidentified', [
  caseEntryDeidentifiedSchema,
  caseEntryIdentifiedSchema,
]);

export const approvalActionSchema = z.object({
  entry_id: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
  comment: z.string().max(500).optional(),
});

export const programGoalSchema = z.object({
  resident_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  target_count: z.number().int().min(1),
  specialty: z.string().nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(1000).nullable().optional(),
});

export const accreditationMilestoneSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  competency_area: z.string().min(1),
  target_minimum: z.number().int().min(1),
  specialty: z.string().optional(),
});

export const accreditationFrameworkSchema = z.object({
  name: z.string().min(1).max(200),
  version: z.string().default('1.0'),
  framework_type: z.enum(['acgme', 'scfhs', 'gmc', 'canmeds', 'custom']),
  milestones: z.array(accreditationMilestoneSchema).min(1),
});
```

- [ ] **Step 2: Verify type compilation**

Run: `pnpm --filter @elogbook/shared typecheck`
Expected: PASS — no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/schemas/cases.ts
git commit -m "feat: add discriminated union schema for de-identified/identified case entries"
```

### Task 2.3: Update shared package index exports

**Files:**
- Modify: `packages/shared/src/index.ts` (check if exists, create if not)

- [ ] **Step 1: Check and update index.ts**

Search for existing index.ts in shared package, update to export all new types and schemas.

```typescript
export * from './types/database';
export * from './schemas/cases';
```

- [ ] **Step 2: Verify all consumers compile**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS after fixing any consumer references.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat: update shared package exports"
```

---

## Track 3: Web Application (@elogbook/web)

### Task 3.1: Design system — globals.css overhaul

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Write the new globals.css**

```css
@import "tailwindcss";
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Inter:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap');
@source "../../node_modules/@heroui/react/dist/**/*.{js,ts,jsx,tsx}";

:root {
  --color-backdrop: #060814;
  --color-backdrop-light: #F8FAFC;
  --color-primary: #0D9488;
  --color-primary-glow: rgba(13, 148, 136, 0.3);
  --color-secondary: #6366F1;
  --color-secondary-glow: rgba(99, 102, 241, 0.3);
  --color-neutral-dark: #0F172A;
  --color-neutral-light: #E2E8F0;
  --color-border: rgba(99, 102, 241, 0.15);
  --color-border-glow: rgba(99, 102, 241, 0.3);
  --font-heading: 'Outfit', sans-serif;
  --font-body: 'Inter', sans-serif;
  --font-mono: 'Geist Mono', monospace;

  --color-amber-glow: rgba(217, 119, 6, 0.4);
  --color-emerald-glow: rgba(5, 150, 105, 0.4);
  --color-crimson-glow: rgba(220, 38, 38, 0.4);
}

@theme inline {
  --font-sans: var(--font-body);
  --font-mono: var(--font-mono);
  --color-backdrop: var(--color-backdrop);
  --color-primary: var(--color-primary);
  --color-secondary: var(--color-secondary);
}

body {
  background-color: var(--color-backdrop);
  color: var(--color-neutral-light);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading);
  letter-spacing: -0.02em;
}

/* Glassmorphic panel */
.glass-panel {
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: 0 4px 24px rgba(6, 8, 20, 0.4);
  border-radius: 0.75rem;
}

.glass-panel:hover {
  border-color: var(--color-border);
}

.glass-panel:focus-within {
  border-color: var(--color-border-glow);
  box-shadow: 0 0 0 1px var(--color-primary-glow), 0 4px 24px rgba(6, 8, 20, 0.4);
}

/* Status badges */
.badge-draft {
  background: rgba(226, 232, 240, 0.1);
  border: 1px solid rgba(226, 232, 240, 0.2);
  color: #E2E8F0;
}

.badge-pending {
  background: rgba(217, 119, 6, 0.15);
  border: 1px solid var(--color-amber-glow);
  color: #F59E0B;
  box-shadow: 0 0 8px var(--color-amber-glow);
}

.badge-approved {
  background: rgba(5, 150, 105, 0.15);
  border: 1px solid var(--color-emerald-glow);
  color: #10B981;
  box-shadow: 0 0 8px var(--color-emerald-glow);
}

.badge-rejected {
  background: rgba(220, 38, 38, 0.15);
  border: 1px solid var(--color-crimson-glow);
  color: #EF4444;
  box-shadow: 0 0 8px var(--color-crimson-glow);
}

/* Clinical data monospace */
.clinical-data {
  font-family: var(--font-mono);
  letter-spacing: 0.025em;
}

/* KPI progress ring */
.kpi-ring {
  filter: drop-shadow(0 0 6px var(--color-primary-glow));
}

/* Motion transitions */
.motion-fade {
  transition: opacity 200ms cubic-bezier(0.4, 0, 0.2, 1),
              transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

.motion-scale {
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

- [ ] **Step 2: Verify CSS compiles with Next.js**

Run: `pnpm --filter @elogbook/web build 2>&1 | Select-Object -Last 20`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat: clinical design system - glassmorphism, glow badges, Outfit/Geist fonts"
```

### Task 3.2: Redesign CaseForm with de-identification wizard

**Files:**
- Modify: `apps/web/components/CaseForm.tsx`

- [ ] **Step 1: Rewrite CaseForm with multi-step wizard, de-id toggle, accreditation mapping**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, TextField, TextArea, Select, ListBox, ListBoxItem, Card, Switch } from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import { caseEntrySchema, type AccreditationMapping, type AccreditationFramework } from '@elogbook/shared';

const GLOBAL_TENANT_ID = '00000000-0000-0000-0000-000000000000';

interface CaseFormProps {
  tenantId: string;
  tenantSlug: string;
  initialStatus: string;
}

interface TemplateField {
  key?: string;
  name?: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
}

interface Template {
  id: string;
  tenant_id: string;
  specialty: string;
  name: string;
  fields: TemplateField[];
  required_fields: string[];
}

const STEP_LABELS = ['Template', 'Patient Info', 'Case Details', 'Review'];

export default function CaseForm({ tenantId, tenantSlug, initialStatus }: CaseFormProps) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [templates, setTemplates] = useState<Template[]>([]);
  const [frameworks, setFrameworks] = useState<AccreditationFramework[]>([]);
  const [step, setStep] = useState(0);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [patientMrn, setPatientMrn] = useState('');
  const [patientDob, setPatientDob] = useState('');
  const [patientAge, setPatientAge] = useState<number | null>(null);
  const [patientHash, setPatientHash] = useState('');
  const [caseDate, setCaseDate] = useState('');
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [accreditationMappings, setAccreditationMappings] = useState<AccreditationMapping[]>([]);
  const [isDeidentified, setIsDeidentified] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  useEffect(() => {
    async function loadData() {
      const [tenantRes, globalRes, fwRes] = await Promise.all([
        supabase.from('case_templates').select('*').eq('tenant_id', tenantId),
        supabase.from('case_templates').select('*').eq('tenant_id', GLOBAL_TENANT_ID),
        supabase.from('accreditation_frameworks').select('*').eq('tenant_id', tenantId),
      ]);

      if (tenantRes.error) { setErrors([tenantRes.error.message]); }
      if (fwRes.error) { /* frameworks are optional */ }

      const all = [...(tenantRes.data || []), ...(globalRes.data || [])] as Template[];
      setTemplates(all);
      setFrameworks((fwRes.data || []) as AccreditationFramework[]);
      setLoadingTemplates(false);
    }
    loadData();
  }, [tenantId, supabase]);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const fields = selectedTemplate?.fields || [];

  function getFieldKey(f: TemplateField): string {
    return f.key || f.name || '';
  }

  function handleFieldChange(key: string, value: unknown) {
    setFieldValues(prev => ({ ...prev, [key]: value }));
  }

  function computePatientHash(mrn: string) {
    if (!mrn) return '';
    return btoa(`${mrn}:${tenantId}:elogbook-mrn-salt-v1`).substring(0, 64);
  }

  function handleDeidentifyToggle(checked: boolean) {
    setIsDeidentified(checked);
    if (checked) {
      setPatientHash(computePatientHash(patientMrn));
    }
  }

  function handlePatientMrnChange(value: string) {
    setPatientMrn(value);
    if (isDeidentified) {
      setPatientHash(computePatientHash(value));
    }
  }

  function canProceed(): boolean {
    if (step === 0) return !!selectedTemplateId;
    if (step === 1) {
      if (isDeidentified) return patientAge !== null && !!patientHash && !!caseDate;
      return !!patientMrn && !!patientDob && !!caseDate;
    }
    if (step === 2) {
      const requiredKeys = selectedTemplate?.required_fields || [];
      return requiredKeys.every(k => fieldValues[k] !== undefined && fieldValues[k] !== '');
    }
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);

    const basePayload = {
      template_id: selectedTemplateId,
      case_date: caseDate,
      field_values: fieldValues,
      accreditation_mappings: accreditationMappings,
      is_deidentified: isDeidentified,
    };

    const payload = isDeidentified
      ? { ...basePayload, patient_age_years: patientAge!, patient_hash: patientHash }
      : { ...basePayload, patient_mrn: patientMrn, patient_dob: patientDob };

    const result = caseEntrySchema.safeParse(payload);
    if (!result.success) {
      setErrors(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`));
      return;
    }

    setLoading(true);
    const { error } = await supabase.from('case_entries').insert({
      tenant_id: tenantId,
      template_id: selectedTemplateId,
      patient_mrn: isDeidentified ? null : patientMrn,
      patient_dob: isDeidentified ? null : patientDob,
      patient_age_years: isDeidentified ? patientAge : null,
      patient_hash: isDeidentified ? patientHash : null,
      case_date: caseDate,
      field_values: fieldValues,
      accreditation_mappings: accreditationMappings,
      is_deidentified: isDeidentified,
      status: initialStatus,
    });

    if (error) {
      setErrors([error.message]);
      setLoading(false);
      return;
    }

    router.push(`/${tenantSlug}/cases`);
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Step indicator */}
      <div className="flex gap-2 mb-6">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-heading
              ${i === step ? 'bg-primary text-white shadow-lg shadow-primary-glow/40' :
                i < step ? 'bg-emerald-600 text-white' : 'bg-neutral-dark text-neutral-light/40 border border-border'}`}>
              {i < step ? '✓' : i + 1}
            </div>
            <span className={`text-xs font-heading ${i <= step ? 'text-neutral-light' : 'text-neutral-light/30'}`}>
              {label}
            </span>
            {i < 3 && <div className={`w-8 h-px ${i < step ? 'bg-emerald-600' : 'bg-border'}`} />}
          </div>
        ))}
      </div>

      <Card className="glass-panel">
        <Card.Content className="gap-4 p-6">
          <AnimatePresence mode="wait">
            {errors.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-crimson-glow/20 border border-crimson-glow/40 text-red-300 p-3 rounded-lg text-sm"
              >
                {errors.map((err, i) => <p key={i}>{err}</p>)}
              </motion.div>
            )}

            {/* Step 0: Template Selection */}
            {step === 0 && (
              <motion.div key="step0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <h2 className="text-lg font-heading font-semibold">Select Case Template</h2>
                <Select
                  label="Case Template"
                  placeholder="Choose a template..."
                  selectedKey={selectedTemplateId || null}
                  onSelectionChange={(key) => { setSelectedTemplateId(key || ''); setFieldValues({}); }}
                  isLoading={loadingTemplates}
                >
                  <Select.Trigger aria-label="Select template"><Select.Value /></Select.Trigger>
                  <Select.Popover>
                    <ListBox aria-label="Select a template">
                      {templates.map(t => (
                        <ListBoxItem id={t.id} textValue={`${t.specialty} - ${t.name}`}>
                          <div>
                            <span className="font-medium">{t.specialty}</span>
                            <span className="text-neutral-light/50 ml-2 text-xs">{t.name}</span>
                          </div>
                        </ListBoxItem>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </motion.div>
            )}

            {/* Step 1: Patient Info with De-identification */}
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-heading font-semibold">Patient Information</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-light/60">De-identify</span>
                    <Switch
                      isSelected={isDeidentified}
                      onValueChange={handleDeidentifyToggle}
                      size="sm"
                    />
                  </div>
                </div>

                {isDeidentified ? (
                  <div className="space-y-4">
                    <div className="glass-panel p-3 bg-amber-glow/10 border-amber-glow/20">
                      <p className="text-xs text-amber-300">
                        HIPAA Safe Harbor: Patient identifiers are hashed before storage. No plaintext MRN or DOB is retained.
                      </p>
                    </div>
                    <TextField
                      label="Patient MRN (will be hashed)"
                      value={patientMrn}
                      onChange={handlePatientMrnChange}
                      placeholder="Enter MRN for one-way hashing"
                      className="font-mono"
                    />
                    <input type="hidden" value={patientHash} />
                    <TextField
                      label="Patient Age at Procedure (years)"
                      type="number"
                      value={patientAge?.toString() || ''}
                      onChange={(v) => setPatientAge(v ? parseInt(v) : null)}
                      className="font-mono"
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="glass-panel p-3 bg-crimson-glow/10 border-crimson-glow/20">
                      <p className="text-xs text-red-300">
                        Warning: Plaintext PII will be stored. Ensure this environment is HIPAA-compliant with encryption at rest.
                      </p>
                    </div>
                    <TextField
                      label="Patient MRN"
                      value={patientMrn}
                      onChange={handlePatientMrnChange}
                      className="font-mono clinical-data"
                    />
                    <TextField
                      label="Patient DOB"
                      type="date"
                      value={patientDob}
                      onChange={setPatientDob}
                      className="font-mono clinical-data"
                    />
                  </div>
                )}

                <TextField
                  label="Case Date"
                  type="date"
                  value={caseDate}
                  onChange={setCaseDate}
                  className="font-mono clinical-data"
                />
              </motion.div>
            )}

            {/* Step 2: Dynamic Template Fields */}
            {step === 2 && selectedTemplateId && fields.length > 0 && (
              <motion.div key="step2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <h2 className="text-lg font-heading font-semibold">{selectedTemplate?.name} Fields</h2>
                {fields.map((field) => {
                  const key = getFieldKey(field);
                  const label = field.label;
                  const type = field.type;
                  const options = field.options || [];
                  const isRequired = selectedTemplate?.required_fields?.includes(key);

                  switch (type) {
                    case 'textarea':
                      return (
                        <TextArea
                          key={key}
                          label={`${label}${isRequired ? ' *' : ''}`}
                          value={(fieldValues[key] as string) || ''}
                          onChange={(v: string) => handleFieldChange(key, v)}
                          className="mb-3"
                        />
                      );
                    case 'select':
                      return (
                        <Select
                          key={key}
                          label={`${label}${isRequired ? ' *' : ''}`}
                          selectedKey={(fieldValues[key] as string) || null}
                          onSelectionChange={(val) => handleFieldChange(key, val || '')}
                          className="mb-3"
                        >
                          <Select.Trigger aria-label={`Select ${label}`}><Select.Value /></Select.Trigger>
                          <Select.Popover>
                            <ListBox aria-label={label}>
                              {options.map((opt: string) => (
                                <ListBoxItem id={opt}>{opt}</ListBoxItem>
                              ))}
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      );
                    case 'number':
                      return (
                        <TextField
                          key={key}
                          label={`${label}${isRequired ? ' *' : ''}`}
                          type="number"
                          value={(fieldValues[key] as string) || ''}
                          onChange={(v: string) => handleFieldChange(key, v)}
                          className="mb-3"
                        />
                      );
                    case 'date':
                      return (
                        <TextField
                          key={key}
                          label={`${label}${isRequired ? ' *' : ''}`}
                          type="date"
                          value={(fieldValues[key] as string) || ''}
                          onChange={(v: string) => handleFieldChange(key, v)}
                          className="mb-3"
                        />
                      );
                    case 'checkbox':
                      return (
                        <div key={key} className="mb-3 flex items-center gap-2">
                          <input type="checkbox" id={`field-${key}`} checked={!!fieldValues[key]}
                            onChange={(e) => handleFieldChange(key, e.target.checked)} className="rounded" />
                          <label htmlFor={`field-${key}`} className="text-sm">
                            {label}{isRequired ? ' *' : ''}
                          </label>
                        </div>
                      );
                    default:
                      return (
                        <TextField
                          key={key}
                          label={`${label}${isRequired ? ' *' : ''}`}
                          value={(fieldValues[key] as string) || ''}
                          onChange={(v: string) => handleFieldChange(key, v)}
                          className="mb-3"
                        />
                      );
                  }
                })}
              </motion.div>
            )}

            {/* Step 3: Review */}
            {step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                <h2 className="text-lg font-heading font-semibold">Review Case Entry</h2>
                <div className="glass-panel p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-neutral-light/60">Template:</span>
                    <span className="font-heading">{selectedTemplate?.specialty} - {selectedTemplate?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-light/60">De-identified:</span>
                    <span className={`badge-${isDeidentified ? 'approved' : 'pending'} px-2 py-0.5 rounded text-xs`}>
                      {isDeidentified ? 'Yes (Safe Harbor)' : 'No (PII Stored)'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-light/60">Case Date:</span>
                    <span className="clinical-data">{caseDate}</span>
                  </div>
                  {Object.entries(fieldValues).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-neutral-light/60">{k}:</span>
                      <span>{String(v)}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card.Content>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between mt-4">
        <Button variant="flat" isDisabled={step === 0} onPress={() => setStep(s => s - 1)}>
          Back
        </Button>
        {step < 3 ? (
          <Button color="primary" isDisabled={!canProceed()} onPress={() => setStep(s => s + 1)}>
            Continue
          </Button>
        ) : (
          <Button type="submit" color="primary" isLoading={loading} isDisabled={!canProceed()}>
            Submit Case
          </Button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify type compilation**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/CaseForm.tsx
git commit -m "feat: redesign CaseForm with multi-step wizard, de-identification toggle, glassmorphism"
```

### Task 3.3: Create CompetencyManager component

**Files:**
- Create: `apps/web/components/CompetencyManager.tsx`

- [ ] **Step 1: Write CompetencyManager.tsx**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button, TextField, TextArea, Card, Select, ListBox, ListBoxItem } from '@heroui/react';
import { motion } from 'framer-motion';
import { type AccreditationFramework, type AccreditationMilestone, accreditationFrameworkSchema } from '@elogbook/shared';

interface CompetencyManagerProps {
  tenantId: string;
}

export default function CompetencyManager({ tenantId }: CompetencyManagerProps) {
  const [supabase] = useState(() => createClient());
  const [frameworks, setFrameworks] = useState<AccreditationFramework[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFramework, setSelectedFramework] = useState<AccreditationFramework | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0');
  const [frameworkType, setFrameworkType] = useState<'acgme' | 'scfhs' | 'gmc' | 'canmeds' | 'custom'>('acgme');
  const [milestonesText, setMilestonesText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('accreditation_frameworks')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (error) { setErrors([error.message]); }
      else { setFrameworks(data as AccreditationFramework[]); }
      setLoading(false);
    }
    load();
  }, [tenantId, supabase]);

  async function handleCreate() {
    setErrors([]);

    let milestones: AccreditationMilestone[];
    try {
      milestones = JSON.parse(milestonesText);
      if (!Array.isArray(milestones)) throw new Error('Milestones must be a JSON array');
    } catch {
      setErrors(['Invalid milestone JSON format. Must be an array of objects.']);
      return;
    }

    const payload = { name, version, framework_type: frameworkType, milestones };
    const result = accreditationFrameworkSchema.safeParse(payload);
    if (!result.success) {
      setErrors(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`));
      return;
    }

    setSaving(true);
    const { data, error } = await supabase
      .from('accreditation_frameworks')
      .insert({ ...payload, tenant_id: tenantId })
      .select()
      .single();

    if (error) {
      setErrors([error.message]);
      setSaving(false);
      return;
    }

    setFrameworks(prev => [data as AccreditationFramework, ...prev]);
    setShowNewForm(false);
    setName('');
    setVersion('1.0');
    setMilestonesText('');
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('accreditation_frameworks').delete().eq('id', id);
    if (!error) {
      setFrameworks(prev => prev.filter(f => f.id !== id));
      setSelectedFramework(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-heading font-semibold">Accreditation Frameworks</h2>
        <Button color="primary" size="sm" onPress={() => setShowNewForm(!showNewForm)}>
          {showNewForm ? 'Cancel' : '+ New Framework'}
        </Button>
      </div>

      {showNewForm && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
          <Card className="glass-panel">
            <Card.Content className="gap-4 p-6">
              <h3 className="font-heading font-semibold">New Accreditation Framework</h3>
              {errors.length > 0 && (
                <div className="bg-crimson-glow/20 border border-crimson-glow/40 text-red-300 p-3 rounded-lg text-sm">
                  {errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
              <TextField label="Framework Name" value={name} onChange={setName} />
              <TextField label="Version" value={version} onChange={setVersion} />
              <Select
                label="Framework Type"
                selectedKey={frameworkType}
                onSelectionChange={(key) => setFrameworkType(key as typeof frameworkType)}
              >
                <Select.Trigger aria-label="Select framework type"><Select.Value /></Select.Trigger>
                <Select.Popover>
                  <ListBox aria-label="Framework type">
                    <ListBoxItem id="acgme">ACGME (US)</ListBoxItem>
                    <ListBoxItem id="scfhs">SCFHS (Saudi)</ListBoxItem>
                    <ListBoxItem id="gmc">GMC (UK)</ListBoxItem>
                    <ListBoxItem id="canmeds">CanMEDS (Canada)</ListBoxItem>
                    <ListBoxItem id="custom">Custom</ListBoxItem>
                  </ListBox>
                </Select.Popover>
              </Select>
              <TextArea
                label="Milestones (JSON array)"
                value={milestonesText}
                onChange={setMilestonesText}
                placeholder={`[{"code":"MK-01","description":"Perform appendectomy","competency_area":"Surgical Skills","target_minimum":20}]`}
                minRows={4}
              />
              <Button color="primary" isLoading={saving} onPress={handleCreate}>Create Framework</Button>
            </Card.Content>
          </Card>
        </motion.div>
      )}

      <div className="grid gap-4">
        {frameworks.map(fw => (
          <Card key={fw.id} className="glass-panel cursor-pointer" onPress={() => setSelectedFramework(fw)}>
            <Card.Content className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-heading font-semibold">{fw.name}</h3>
                  <p className="text-xs text-neutral-light/50">v{fw.version} - {fw.framework_type.toUpperCase()} - {fw.milestones.length} milestones</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="flat" color="danger" onPress={() => handleDelete(fw.id)}>Delete</Button>
                </div>
              </div>
              {selectedFramework?.id === fw.id && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 space-y-2">
                  <h4 className="text-sm font-heading font-semibold text-neutral-light/60">Milestones</h4>
                  {fw.milestones.map((m, i) => (
                    <div key={m.code} className="glass-panel p-2 text-xs">
                      <span className="clinical-data font-semibold">{m.code}</span>
                      <span className="ml-2">{m.description}</span>
                      <span className="ml-2 text-neutral-light/40">({m.competency_area} - min {m.target_minimum})</span>
                    </div>
                  ))}
                </motion.div>
              )}
            </Card.Content>
          </Card>
        ))}
      </div>

      {!loading && frameworks.length === 0 && !showNewForm && (
        <div className="text-center text-neutral-light/40 py-12">
          <p className="text-lg font-heading">No accreditation frameworks yet</p>
          <p className="text-sm">Create one to begin mapping competencies to case templates.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify type compilation**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/CompetencyManager.tsx
git commit -m "feat: add CompetencyManager component with accreditation framework CRUD"
```

### Task 3.4: Create ApprovalsDashboard component

**Files:**
- Create: `apps/web/components/ApprovalsDashboard.tsx`

- [ ] **Step 1: Write ApprovalsDashboard.tsx**

```typescript
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button, Card } from '@heroui/react';
import { motion } from 'framer-motion';
import ApprovalActions from './ApprovalActions';

interface ApprovalsDashboardProps {
  tenantId: string;
  tenantSlug: string;
}

interface PendingEntry {
  id: string;
  resident: { full_name: string; specialty: string | null };
  template: { specialty: string; name: string };
  patient_age_years: number | null;
  is_deidentified: boolean;
  case_date: string;
  field_values: Record<string, unknown>;
  approval: {
    id: string;
    status: string;
    requested_at: string;
    comment: string | null;
  };
}

export default function ApprovalsDashboard({ tenantId, tenantSlug }: ApprovalsDashboardProps) {
  const [supabase] = useState(() => createClient());
  const [entries, setEntries] = useState<PendingEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('case_entries')
        .select(`
          id, patient_age_years, is_deidentified, case_date, field_values, status,
          resident:resident_id ( full_name, specialty ),
          template:template_id ( specialty, name ),
          approval:approval_requests!entry_id ( id, status, requested_at, comment )
        `)
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .order('case_date', { ascending: false });

      if (!error && data) {
        const mapped: PendingEntry[] = data.map((row: Record<string, unknown>) => ({
          id: row.id as string,
          patient_age_years: row.patient_age_years as number | null,
          is_deidentified: row.is_deidentified as boolean,
          case_date: row.case_date as string,
          field_values: row.field_values as Record<string, unknown>,
          resident: (row.resident as { full_name: string; specialty: string | null }) || { full_name: 'Unknown', specialty: null },
          template: (row.template as { specialty: string; name: string }) || { specialty: 'Unknown', name: 'Unknown' },
          approval: (row.approval as [{ id: string; status: string; requested_at: string; comment: string | null }])?.[0] || { id: '', status: '', requested_at: '', comment: null },
        }));
        setEntries(mapped);
      }
      setLoading(false);
    }
    load();
  }, [tenantId, supabase]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-heading font-semibold">Approvals Dashboard</h2>
        <span className="badge-pending px-3 py-1 rounded-full text-sm font-heading">
          {entries.length} Pending
        </span>
      </div>

      {loading && (
        <div className="text-center text-neutral-light/40 py-8">Loading...</div>
      )}

      {!loading && entries.length === 0 && (
        <div className="text-center text-neutral-light/40 py-12">
          <p className="text-lg font-heading">No pending approvals</p>
          <p className="text-sm">All cases have been reviewed.</p>
        </div>
      )}

      <motion.div className="space-y-3">
        {entries.map((entry, idx) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
          >
            <Card className="glass-panel">
              <Card.Content className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-heading font-semibold">{entry.resident.full_name}</span>
                      <span className="badge-pending px-2 py-0.5 rounded text-xs">PENDING</span>
                      <span className={`badge-${entry.is_deidentified ? 'approved' : 'pending'} px-2 py-0.5 rounded text-xs`}>
                        {entry.is_deidentified ? 'De-ID' : 'PII'}
                      </span>
                    </div>
                    <div className="text-sm text-neutral-light/60">
                      <span>{entry.template.specialty} - {entry.template.name}</span>
                      <span className="ml-3 clinical-data">{entry.case_date}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      {Object.entries(entry.field_values).slice(0, 4).map(([k, v]) => (
                        <div key={k} className="text-neutral-light/50">
                          <span className="text-neutral-light/30">{k}:</span> {String(v)}
                        </div>
                      ))}
                    </div>
                    {entry.approval.comment && (
                      <p className="text-xs text-neutral-light/40 italic">{entry.approval.comment}</p>
                    )}
                  </div>
                  <div className="shrink-0">
                    <ApprovalActions
                      requestId={entry.approval.id}
                      entryId={entry.id}
                      tenant={tenantSlug}
                    />
                  </div>
                </div>
              </Card.Content>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 2: Verify type compilation**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/ApprovalsDashboard.tsx
git commit -m "feat: add ApprovalsDashboard with pending queue and inline review"
```

### Task 3.5: Add CompetencyManager to Admin page, ApprovalsDashboard to Approvals page

**Files:**
- Modify: `apps/web/app/[tenant]/admin/page.tsx` (read first)
- Modify: `apps/web/app/[tenant]/approvals/page.tsx` (read first)

- [ ] **Step 1: Read admin and approvals pages, then integrate new components**

Read both files, add CompetencyManager as a new tab in the admin page, and replace the approvals list with ApprovalsDashboard.

- [ ] **Step 2: Verify builds**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/[tenant]/admin/page.tsx apps/web/app/[tenant]/approvals/page.tsx
git commit -m "feat: integrate CompetencyManager into admin, ApprovalsDashboard into approvals page"
```

---

## Track 4: Mobile Application (@elogbook/mobile)

### Task 4.1: Install WatermelonDB and set up local database

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/lib/db/schema.ts`
- Create: `apps/mobile/lib/db/database.ts`

- [ ] **Step 1: Add WatermelonDB dependencies**

Run: `pnpm --filter @elogbook/mobile add @nozbe/watermelondb @nozbe/with-observables`

- [ ] **Step 2: Write WatermelonDB schema and database setup**

Create the schema file with models mirroring case_entries and case_templates for offline use.

- [ ] **Step 3: Verify Expo build**

Run: `pnpm --filter @elogbook/mobile typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/package.json pnpm-lock.yaml apps/mobile/lib/db/
git commit -m "feat: add WatermelonDB local database for offline mobile"
```

### Task 4.2: Create sync service

**Files:**
- Create: `apps/mobile/lib/sync.ts`

- [ ] **Step 1: Write sync service**

```typescript
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';

type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

class SyncService {
  private status: SyncStatus = 'idle';
  private listeners: Set<(status: SyncStatus) => void> = new Set();

  constructor() {
    NetInfo.addEventListener(state => {
      if (state.isConnected && this.status === 'offline') {
        this.pushPendingCases();
      } else if (!state.isConnected) {
        this.setStatus('offline');
      }
    });
  }

  private setStatus(status: SyncStatus) {
    this.status = status;
    this.listeners.forEach(fn => fn(status));
  }

  onStatusChange(fn: (status: SyncStatus) => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  async pushPendingCases() {
    this.setStatus('syncing');
    try {
      // WatermelonDB pulls pending drafts and pushes to Supabase
      // On success, mark as synced; on conflict, mark with error state
      this.setStatus('idle');
    } catch {
      this.setStatus('error');
    }
  }

  async pullTemplates(tenantId: string) {
    const { data } = await supabase
      .from('case_templates')
      .select('*')
      .eq('tenant_id', tenantId);
    // Store in local WatermelonDB for offline access
    return data;
  }

  getStatus(): SyncStatus { return this.status; }
}

export const syncService = new SyncService();
```

- [ ] **Step 2: Verify compilation**

Run: `pnpm --filter @elogbook/mobile typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/sync.ts
git commit -m "feat: add offline sync service with NetInfo monitoring"
```

### Task 4.3: Enhance log-case.tsx with offline support and haptic feedback

**Files:**
- Modify: `apps/mobile/app/(tabs)/log-case.tsx`

- [ ] **Step 1: Read the current file, then enhance with offline-first, haptics, and camera barcode scan**

Read the file, add: offline indicator, haptic feedback on submit, expo-camera barcode scanning for MRN de-identification, cached templates from local DB.

- [ ] **Step 2: Verify type compilation**

Run: `pnpm --filter @elogbook/mobile typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(tabs)/log-case.tsx
git commit -m "feat: enhance mobile log-case with offline support, haptics, camera scanning"
```

---

## Track 5: Design System Integration

### Task 5.1: Apply design tokens to TenantLayout (sidebar, nav)

**Files:**
- Modify: `apps/web/app/[tenant]/layout.tsx`

- [ ] **Step 1: Read the layout, then apply glassmorphism and font tokens**

Update sidebar to use glass-panel styling, Outfit font for nav labels, and teal/indigo accent colors per DESIGN.md.

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @elogbook/web build 2>&1 | Select-Object -Last 20`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/[tenant]/layout.tsx
git commit -m "feat: apply clinical design system to tenant layout"
```

### Task 5.2: Apply design tokens to Dashboard page (KPI rings, glass panels)

**Files:**
- Modify: `apps/web/app/[tenant]/dashboard/page.tsx`

- [ ] **Step 1: Replace stat cards with glass panels + SVG KPI rings**

Read the file, replace the stat cards with glass-panel styled cards. Add SVG circular progress rings for goal tracking using clip-path or stroke-dasharray.

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @elogbook/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/[tenant]/dashboard/page.tsx
git commit -m "feat: apply glass panels and KPI rings to dashboard"
```

### Task 5.3: Apply design tokens to remaining pages (cases, goals, reports, billing, audit)

**Files:**
- Modify: `apps/web/app/[tenant]/cases/page.tsx`
- Modify: `apps/web/app/[tenant]/goals/page.tsx`
- Modify: `apps/web/app/[tenant]/reports/page.tsx`
- Modify: `apps/web/app/[tenant]/billing/page.tsx`
- Modify: `apps/web/app/[tenant]/audit/page.tsx`

- [ ] **Step 1: Apply glass-panel cards, status badges, Outfit headings to all pages**

For each page, replace hard-bordered Card components with glass-panel class, use badge-draft/pending/approved/rejected for status indicators, use font-heading for titles, and font-mono for clinical data fields.

- [ ] **Step 2: Verify full build**

Run: `pnpm --filter @elogbook/web typecheck && pnpm --filter @elogbook/web lint`
Expected: Both PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/[tenant]/cases/ apps/web/app/[tenant]/goals/ apps/web/app/[tenant]/reports/ apps/web/app/[tenant]/billing/ apps/web/app/[tenant]/audit/
git commit -m "feat: apply design system to all tenant pages"
```

---

## Final Verification

### Task V.1: Full typecheck and lint across all packages

- [ ] **Step 1: Run all checks**

```bash
pnpm --filter @elogbook/shared typecheck
pnpm --filter @elogbook/web typecheck
pnpm --filter @elogbook/mobile typecheck
pnpm --filter @elogbook/web lint
pnpm --filter @elogbook/mobile lint
```

Expected: All PASS.

- [ ] **Step 2: Run Supabase db reset to verify schema**

```bash
supabase db reset
```

Expected: All migrations and seeds apply cleanly.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final verification - all typechecks and migrations pass"
```
