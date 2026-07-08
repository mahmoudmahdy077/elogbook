# E-Logbook Enterprise — Production Upgrade Plan

> **Goal**: Transform E-Logbook from current state to enterprise-grade SaaS competing with (and beating) New Innovations, MedHub, and NHS Logbook+.
> **Rule**: Use Supabase native features first. No new systems. No new infrastructure. Fast deploy.
> **Reader**: Any coding agent (even a small LLM) should be able to follow this line by line.

---

## TABLE OF CONTENTS

1. [Phase 0 — Bug Fixes & Data Hygiene](#phase-0)
2. [Phase 1 — DB Schema Upgrades](#phase-1)
3. [Phase 2 — Security Hardening](#phase-2)
4. [Phase 3 — Web UI Upgrades](#phase-3)
5. [Phase 4 — Mobile App Upgrades](#phase-4)
6. [Phase 5 — New Features (Competitor Parity)](#phase-5)
7. [Phase 6 — Enterprise Differentiators](#phase-6)
8. [Phase 7 — Performance & Polish](#phase-7)
9. [Verification Checklist](#verification)

---

<a id="phase-0"></a>
## PHASE 0 — Bug Fixes & Data Hygiene

> **Why**: Clean the foundation before building on top. These are confirmed bugs from the analysis.

### 0.1 Remove Duplicate Migration Files

**Problem**: ~14 timestamp-named `.sql.sql` files exist alongside their numbered counterparts, causing confusion.

**Action**:
```
File: supabase/migrations/
DELETE these files:
  20260701100421_00028_add_missing_tenant_id.sql
  20260701100432_00049_force_rls_all_tables.sql
  20260701100453_00048_fix_approval_tenant_id.sql
  20260701100756_00050_redact_secrets_in_audit.sql.sql
  20260701100811_00051_audit_logs_append_only.sql.sql
  20260701100827_00052_normalize_search_path.sql.sql
  20260701100901_00053_encrypt_secrets.sql.sql
  20260701100923_00054_ai_quota_atomic_increment.sql.sql
  20260701100951_00061_storage_quotas.sql.sql
  20260701101027_00062_key_rotation.sql.sql
  20260701101033_00063_scim_tokens.sql.sql
  20260701101053_00058_tenant_sso_configs_v3.sql.sql
```

**Verify**: `ls supabase/migrations/2026*` returns empty.

### 0.2 Fix Missing DB Functions

**Problem**: Migrations 00058 and 00063 reference `current_role_in_tenant()`, `current_role_global()`, `touch_updated_at()`, `invite_user()` — but these were in the removed migrations 00032-00047 that no longer exist on disk.

**Action**: Create new migration `00078_restore_missing_functions.sql`:

```sql
-- Restore functions lost when migrations 00032-00047 were deleted

CREATE OR REPLACE FUNCTION public.current_role_global()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'user_role', '')::TEXT;
$$;

CREATE OR REPLACE FUNCTION public.current_role_in_tenant(p_tenant_id UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_tenant_id IS NOT NULL AND get_tenant_id() != p_tenant_id THEN NULL
    ELSE current_role_global()
  END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- invite_user is handled at the application layer via Supabase Auth
-- No DB function needed. If any migration calls it, create a stub:
CREATE OR REPLACE FUNCTION public.invite_user(p_email TEXT, p_tenant_id UUID, p_role TEXT, p_full_name TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  -- Placeholder: actual invite happens via supabase.auth.signInWithOtp in app
  SELECT;
$$;
```

**Apply**: Run via Supabase Management API `/database/query` endpoint.
**Verify**: `SELECT current_role_global();` returns NULL (not error).

### 0.3 Fix CaseForm Client-Side Query Waterfall

**Problem**: `CaseForm.tsx` does 6+ sequential Supabase queries on mount (templates, favorites, profiles, usage counts, accreditation frameworks). This causes 2-3s load time.

**File**: `apps/web/components/CaseForm.tsx`

**Action**: Replace sequential `useEffect` with `Promise.all`:
```typescript
// BEFORE (sequential, ~3s):
const [templates, setTemplates] = useState([]);
const [favorites, setFavorites] = useState([]);
const [frameworks, setFrameworks] = useState([]);
// ...6 sequential awaits

// AFTER (parallel, ~0.5s):
useEffect(() => {
  if (!user) return;
  let cancelled = false;
  (async () => {
    const profile = await getProfile();
    if (cancelled) return;
    const [templatesRes, favRes, personalRes, tenantRes, frameworkRes] = await Promise.all([
      getTemplates(tenantId),
      getFavorites(user.id),
      getPersonalCounts(profile.id),
      getTenantCounts(tenantId),
      getFrameworks(tenantId),
    ]);
    if (cancelled) return;
    // set all state at once
    setTemplates(mergeTemplates(templatesRes, favRes, personalRes, tenantRes));
    setFavorites(favRes);
    setFrameworks(frameworkRes);
  })();
  return () => { cancelled = true; };
}, [user, tenantId]);
```

**Verify**: Open `/[tenant]/cases/new` — DevTools Network tab shows parallel requests, not sequential.

### 0.4 Fix Dashboard Index Math Bug

**Problem**: Dashboard `page.tsx` calculates array indices for `Promise.all` results differently depending on role (resident vs director+), with 4 variants of index math. This is a known source of bugs.

**File**: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`

**Action**: Replace dynamic index math with named object destructuring:
```typescript
// BEFORE: results[2] could be goals (resident) or residents (director)
// AFTER: use named queries object
const [
  recentCases,
  goals,
  goalProgressOrResidents,
  violationsOrMoreData,
  statsCounts,
] = await Promise.all([...]);

// Make role-dependent naming explicit:
const isResident = auth.profile.role === 'resident';
const goalProgress = isResident ? goalProgressOrResidents : [];
const residents = isResident ? [] : goalProgressOrResidents;
```

**Verify**: Dashboard renders correctly for both `resident` and `director` demo accounts.

### 0.5 Fix Inconsistent Auth Pattern

**Problem**: Some pages use `getAuthContext()` (cached, returns profile+tenant+subscription), others use inline `supabase.auth.getUser()` + manual profile fetch. Reports page and approvals page use the latter.

**Files**:
- `apps/web/app/(authenticated)/[tenant]/reports/page.tsx`
- `apps/web/app/(authenticated)/[tenant]/approvals/page.tsx`
- `apps/web/app/(authenticated)/[tenant]/cases/new/page.tsx`

**Action**: Replace inline auth with `getAuthContext()`:
```typescript
// BEFORE:
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect('/login');
const { data: profile } = await supabase.from('profiles')...

// AFTER:
const auth = await getAuthContext();
if (auth.tenant.slug !== tenantSlug) redirect('/login');
// auth.profile, auth.tenant, auth.subscription all available
```

**Verify**: Login as all 5 demo roles, visit every page — no redirect loops, no blank pages.

### 0.6 Add Missing error.tsx Boundaries

**Problem**: `goals/` and `billing/` have no `error.tsx` — unhandled errors crash the whole layout.

**Action**: Create 2 files:

**File**: `apps/web/app/(authenticated)/[tenant]/goals/error.tsx`
```tsx
'use client';
export default function GoalsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-danger">Unable to load goals</h2>
      <p className="text-sm text-default-500 mt-2">{error.message}</p>
      <button onClick={reset} className="mt-4 px-4 py-2 bg-primary text-white rounded-lg">
        Try again
      </button>
    </div>
  );
}
```

**File**: `apps/web/app/(authenticated)/[tenant]/billing/error.tsx`
```tsx
'use client';
export default function BillingError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-danger">Unable to load billing</h2>
      <p className="text-sm text-default-500 mt-2">{error.message}</p>
      <button onClick={reset} className="mt-4 px-4 py-2 bg-primary text-white rounded-lg">
        Try again
      </button>
    </div>
  );
}
```

**Verify**: Trigger a DB error (disconnect briefly) on goals and billing pages — error card shows, not white screen.

---

<a id="phase-1"></a>
## PHASE 1 — DB Schema Upgrades

> **Why**: New features need new tables. All using Supabase native (SQL migrations applied via Management API).

### 1.1 Rotations & Scheduling

**Migration**: `00079_rotations.sql`

```sql
-- Rotation scheduling (closes #1 competitor gap vs New Innovations)

CREATE TABLE public.rotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  specialty TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  site TEXT,
  supervisor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed','cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shift assignments within rotations
CREATE TABLE public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rotation_id UUID NOT NULL REFERENCES public.rotations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  shift_type TEXT NOT NULL DEFAULT 'regular' CHECK (shift_type IN ('call','clinic','vacation','weekend','regular','night','long')),
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_rotations_tenant_resident ON public.rotations(tenant_id, resident_id);
CREATE INDEX idx_rotations_tenant_status ON public.rotations(tenant_id, status);
CREATE INDEX idx_rotations_date_range ON public.rotations(start_date, end_date);
CREATE INDEX idx_shifts_tenant_date ON public.shifts(tenant_id, shift_date);
CREATE INDEX idx_shifts_rotation ON public.shifts(rotation_id);

-- RLS
ALTER TABLE public.rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotations FORCE ROW LEVEL SECURITY;
CREATE POLICY rotations_tenant_isolation ON public.rotations
  FOR ALL USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());
CREATE POLICY rotations_select_own ON public.rotations
  FOR SELECT USING (resident_id = (SELECT id FROM profiles WHERE user_id = auth.uid()));
CREATE POLICY rotations_insert_director ON public.rotations
  FOR INSERT WITH CHECK (get_user_role() IN ('director','institution_admin','admin'));
CREATE POLICY rotations_update_director ON public.rotations
  FOR UPDATE USING (get_user_role() IN ('director','institution_admin','admin'));
CREATE POLICY rotations_delete_director ON public.rotations
  FOR DELETE USING (get_user_role() IN ('director','institution_admin','admin'));

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY shifts_tenant_isolation ON public.shifts
  FOR ALL USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());

-- Triggers
CREATE TRIGGER set_rotations_updated_at BEFORE UPDATE ON public.rotations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Audit
SELECT audit_table_change('rotations');
SELECT audit_table_change('shifts');
```

### 1.2 ACGME Milestones

**Migration**: `00080_milestones.sql`

```sql
-- ACGME Milestones: 22 sub-competencies × 5 levels with EPA mapping

CREATE TABLE public.milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  competency_area TEXT NOT NULL,
  sub_competency TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
  assessor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assessment_date DATE NOT NULL,
  evidence_entry_id UUID REFERENCES public.case_entries(id) ON DELETE SET NULL,
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, resident_id, sub_competency, assessment_date)
);

CREATE TABLE public.epa_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  epa_code TEXT NOT NULL,
  epa_description TEXT NOT NULL,
  milestone_codes TEXT[] NOT NULL,
  required_procedures TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_milestones_tenant_resident ON public.milestones(tenant_id, resident_id);
CREATE INDEX idx_milestones_competency ON public.milestones(tenant_id, competency_area);
CREATE INDEX idx_epa_tenant ON public.epa_mappings(tenant_id);

-- RLS
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones FORCE ROW LEVEL SECURITY;
CREATE POLICY milestones_tenant ON public.milestones FOR ALL
  USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

ALTER TABLE public.epa_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.epa_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY epa_tenant ON public.epa_mappings FOR ALL
  USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

-- Seed ACGME 22 sub-competencies as default framework
INSERT INTO public.epa_mappings (tenant_id, epa_code, epa_description, milestone_codes)
SELECT
  '00000000-0000-0000-0000-000000000000', -- global tenant for defaults
  code, desc, ARRAY[competency]
FROM (VALUES
  ('PC1', 'Patient Care 1: Compassionate & appropriate care', ARRAY['Patient Care']),
  ('PC2', 'Patient Care 2: Diagnostic & therapeutic procedures', ARRAY['Patient Care']),
  ('MK1', 'Medical Knowledge 1: Clinical knowledge', ARRAY['Medical Knowledge']),
  ('MK2', 'Medical Knowledge 2: Investigative & analytic thinking', ARRAY['Medical Knowledge']),
  ('PB1', 'Practice-Based Learning 1: Self-monitoring & improvement', ARRAY['Practice-Based Learning']),
  ('PB2', 'Practice-Based Learning 2: Feedback & teaching', ARRAY['Practice-Based Learning']),
  ('CS1', 'Communication 1: Patient & family communication', ARRAY['Interpersonal & Communication Skills']),
  ('CS2', 'Communication 2: Interprofessional communication', ARRAY['Interpersonal & Communication Skills']),
  ('PR1', 'Professionalism 1: Ethical principles', ARRAY['Professionalism']),
  ('PR2', 'Professionalism 2: Accountability', ARRAY['Professionalism']),
  ('SBP1', 'Systems-Based Practice 1: Healthcare systems', ARRAY['Systems-Based Practice']),
  ('SBP2', 'Systems-Based Practice 2: Quality & safety', ARRAY['Systems-Based Practice'])
) AS t(code, desc, competency);

-- Triggers + audit
CREATE TRIGGER set_milestones_updated_at BEFORE UPDATE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
SELECT audit_table_change('milestones');
SELECT audit_table_change('epa_mappings');
```

### 1.3 Evaluation Forms (Mini-CEX, DOPS, CBD)

**Migration**: `00081_evaluation_forms.sql`

```sql
-- Expanded evaluation portfolio (closes gap vs NHS Logbook+ & New Innovations)

CREATE TABLE public.evaluation_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  evaluator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  form_type TEXT NOT NULL CHECK (form_type IN ('mini_cex','dops','cbd','cex','msf','osce','360_review','portfolio_review')),
  encounter_date DATE,
  setting TEXT,
  patient_context TEXT,
  ratings JSONB NOT NULL DEFAULT '{}',
  -- ratings structure: { "domains": [{ "name": "Clinical", "score": 4, "max": 5 }, ...] }
  overall_score NUMERIC(3,1),
  feedback TEXT,
  action_plan TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','acknowledged')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_eval_forms_tenant_resident ON public.evaluation_forms(tenant_id, resident_id);
CREATE INDEX idx_eval_forms_tenant_type ON public.evaluation_forms(tenant_id, form_type);
CREATE INDEX idx_eval_forms_status ON public.evaluation_forms(tenant_id, status);

ALTER TABLE public.evaluation_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_forms FORCE ROW LEVEL SECURITY;
CREATE POLICY eval_forms_tenant ON public.evaluation_forms FOR ALL
  USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

CREATE TRIGGER set_evalforms_updated_at BEFORE UPDATE ON public.evaluation_forms
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
SELECT audit_table_change('evaluation_forms');
```

### 1.4 CPT/ICD Code Library

**Migration**: `00082_cpt_icd_codes.sql`

```sql
-- CPT/ICD code browser (closes gap vs SurgLog, MedHub)

CREATE TABLE public.procedure_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  code_system TEXT NOT NULL CHECK (code_system IN ('cpt','icd10','snomed')),
  description TEXT NOT NULL,
  category TEXT,
  rvu NUMERIC(5,2),
  parent_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_procedure_codes_unique ON public.procedure_codes(code, code_system);
CREATE INDEX idx_procedure_codes_search ON public.procedure_codes USING gin (to_tsvector('english', code || ' ' || description));
CREATE INDEX idx_procedure_codes_category ON public.procedure_codes(category);

-- This table is PUBLIC (no RLS) — reference data for all tenants
-- No tenant_id column — shared medical reference

-- Link cases to procedure codes
ALTER TABLE public.case_entries ADD COLUMN procedure_codes TEXT[] DEFAULT '{}';
CREATE INDEX idx_case_entries_proc_codes ON public.case_entries USING gin (procedure_codes);
```

### 1.5 Onboarding Wizard State

**Migration**: `00083_onboarding_steps.sql`

```sql
-- Track onboarding wizard steps for new users
ALTER TABLE public.profiles ADD COLUMN onboarding_steps JSONB DEFAULT '[]';
-- onboarding_steps: ["profile","specialty","tour","first_case","goal_set"]

-- Notifications table (Supabase realtime-compatible)
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_unread ON public.notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_tenant ON public.notifications(tenant_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON public.notifications FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY notifications_insert_tenant ON public.notifications FOR INSERT
  WITH CHECK (tenant_id = get_tenant_id());

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
```

### 1.6 Audit Log Improvements

**Migration**: `00084_audit_improvements.sql`

```sql
-- Add metadata column to audit_logs for structured audit data
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add session_id for request correlation
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX idx_audit_logs_session ON public.audit_logs(session_id) WHERE session_id IS NOT NULL;
```

### 1.7 Comment Threads

**Migration**: `00085_comments.sql`

```sql
-- Comment threads on cases and evaluations
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id UUID REFERENCES public.case_entries(id) ON DELETE CASCADE,
  evaluation_id UUID REFERENCES public.evaluation_forms(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (entry_id IS NOT NULL OR evaluation_id IS NOT NULL)
);

CREATE INDEX idx_comments_entry ON public.comments(entry_id);
CREATE INDEX idx_comments_evaluation ON public.comments(evaluation_id);
CREATE INDEX idx_comments_parent ON public.comments(parent_id);
CREATE INDEX idx_comments_tenant ON public.comments(tenant_id);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments FORCE ROW LEVEL SECURITY;
CREATE POLICY comments_tenant ON public.comments FOR ALL
  USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

CREATE TRIGGER set_comments_updated_at BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
SELECT audit_table_change('comments');
```

---

<a id="phase-2"></a>
## PHASE 2 — Security Hardening

### 2.1 Enable Supabase Realtime for Notifications

**File**: `supabase/config.toml`
```toml
[realtime]
enabled = true

# Already published via ALTER PUBLICATION in migration 00083
```

**Action**: Call Supabase Management API to update config. Enable realtime for `notifications` table.

**Verify**: `SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';` includes `notifications`.

### 2.2 Add Supabase Auth MFA Enforcement

**Problem**: MFA is checked in app code but not enforced at the Supabase Auth level.

**Action**: Via Supabase Dashboard or Management API:
1. Enable MFA enforcement for `director`, `institution_admin`, `admin` roles
2. Set AAL2 requirement for admin operations

**SQL**:
```sql
-- Add a trigger that rejects high-privilege role assignment without MFA
CREATE OR REPLACE FUNCTION public.enforce_mfa_for_high_privilege()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('director', 'institution_admin', 'admin') THEN
    -- Check if user has at least one MFA factor enrolled
    IF NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors
      WHERE user_id = NEW.user_id AND status = 'verified'
    ) THEN
      RAISE EXCEPTION 'MFA enrollment required for role %', NEW.role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_mfa ON public.profiles;
CREATE TRIGGER trg_enforce_mfa BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mfa_for_high_privilege();
```

### 2.3 Add Webhook Retry Logic

**Problem**: `lib/webhooks.ts` has no retry — best-effort only. Failed deliveries are lost.

**File**: `apps/web/lib/webhooks.ts`

**Action**: Add retry queue using Supabase pg_cron:
```sql
-- Migration 00086_webhook_retry.sql
CREATE TABLE IF NOT EXISTS public.webhook_retry_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES public.tenant_webhook_deliveries(id) ON DELETE CASCADE,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhook_retry_next ON public.webhook_retry_queue(next_attempt_at) WHERE attempt_count < max_attempts;

-- Cron job to process retries every 5 minutes
SELECT cron.schedule(
  'webhook-retry-processor',
  '*/5 * * * *',
  $$SELECT retry_pending_webhooks();$$
);

CREATE OR REPLACE FUNCTION public.retry_pending_webhooks()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Mark expired retries for re-processing
  UPDATE public.webhook_retry_queue
  SET next_attempt_at = NOW() + (attempt_count || ' minutes')::INTERVAL
  WHERE next_attempt_at < NOW()
    AND attempt_count < max_attempts;
END;
$$;
```

### 2.4 Add Rate Limiting to All Missing Routes

**Problem**: CSV export routes (`specialty.csv`, `status.csv`, `evaluations.csv`, `duty-hours.csv`) have NO rate limiting.

**Files**: Each CSV export route in `apps/web/app/api/[tenant]/reports/*/route.ts`

**Action**: Add rate limiting to each CSV export route:
```typescript
// Add at top of each CSV export route handler:
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';

const rl = await checkRateLimit(`csv-export:${ip}`, 10); // 10/min
if (!rl.allowed) return rateLimitResponse(rl.retryAfter);
```

---

<a id="phase-3"></a>
## PHASE 3 — Web UI Upgrades

### 3.1 Onboarding Wizard

**New files**:
- `apps/web/app/(authenticated)/[tenant]/onboarding/page.tsx`
- `apps/web/components/onboarding/OnboardingWizard.tsx`
- `apps/web/components/onboarding/StepProfile.tsx`
- `apps/web/components/onboarding/StepSpecialty.tsx`
- `apps/web/components/onboarding/StepTour.tsx`
- `apps/web/components/onboarding/StepFirstCase.tsx`
- `apps/web/components/onboarding/StepGoalSet.tsx`

**Component spec**:
```tsx
// OnboardingWizard.tsx
interface Props {
  profile: { id: string; role: UserRole; full_name: string; specialty: string | null };
  tenantId: string;
  tenantSlug: string;
}

// 5 steps with progress bar:
// Step 1: Profile setup (name, avatar upload to Supabase Storage)
// Step 2: Specialty selection (dropdown + custom option)
// Step 3: Feature tour (interactive walkthrough pointing at sidebar items)
// Step 4: First case prompt (link to /cases/new with template pre-selected)
// Step 5: Goal setting (link to /goals for directors, skip for residents)

// On complete: PATCH profiles SET onboarding_completed = true, onboarding_steps = [...]
// Redirect to /{slug}/dashboard
```

**Layout guard** (already exists in `(authenticated)/[tenant]/layout.tsx`):
```typescript
// Line 49-51: Already redirects to /onboarding if !auth.profile.onboarding_completed
// Just needs the page to exist
```

### 3.2 Rotation Calendar Page

**New files**:
- `apps/web/app/(authenticated)/[tenant]/rotations/page.tsx`
- `apps/web/app/(authenticated)/[tenant]/rotations/loading.tsx`
- `apps/web/app/(authenticated)/[tenant]/rotations/error.tsx`
- `apps/web/components/RotationCalendar.tsx`
- `apps/web/components/RotationForm.tsx`

**RotationCalendar.tsx spec**:
```tsx
interface Props {
  rotations: Array<{
    id: string; title: string; specialty: string | null;
    start_date: string; end_date: string;
    resident_name: string; status: string;
  }>;
  tenantSlug: string;
  canEdit: boolean; // director+ only
}

// Render: Month grid calendar (CSS Grid, no external lib)
// Each rotation = colored bar spanning its date range
// Click rotation → detail modal with shifts list
// "New Rotation" button (director+ only) → RotationForm modal
// Filters: resident selector (director+), month navigation
```

**Add to Sidebar nav** (after Goals):
```typescript
// In NAV_LINKS array, add:
{
  label: 'Rotations',
  href: '/rotations',
  icon: 'calendar',
  roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'],
}
```

### 3.3 Milestones Dashboard

**New files**:
- `apps/web/app/(authenticated)/[tenant]/milestones/page.tsx`
- `apps/web/components/MilestonesMatrix.tsx`

**MilestonesMatrix.tsx spec**:
```tsx
interface Props {
  residentId: string;
  milestones: Milestone[];
  epaMappings: EPAMapping[];
}

// Render: 22-row × 5-column matrix grid
// Rows: sub-competency names (PC1, PC2, MK1, etc.)
// Columns: Level 1-5
// Current level = filled circle, next = empty circle, achieved = green checkmark
// Below: EPA cards showing which EPAs map to which milestones
// Click cell → modal to add/edit assessment with evidence linkage
```

### 3.4 Evaluation Forms Portfolio

**New files**:
- `apps/web/app/(authenticated)/[tenant]/evaluations/page.tsx`
- `apps/web/components/evaluations/EvaluationFormPicker.tsx`
- `apps/web/components/evaluations/MiniCEXForm.tsx`
- `apps/web/components/evaluations/DOPSForm.tsx`
- `apps/web/components/evaluations/CBDForm.tsx`

**Each form type**:
```tsx
// MiniCEXForm: 7 domains × 1-9 scale
// DOPSForm: 11 domains × 1-6 scale
// CBDForm: 6 domains × entrustment level 1-5
// All share common structure: domains JSONB rating, feedback, action plan
// Submit → INSERT into evaluation_forms table
// List view: filter by type, resident, date range
```

### 3.5 CPT/ICD Code Browser

**New file**: `apps/web/components/ProcedureCodePicker.tsx`

```tsx
interface Props {
  selectedCodes: string[];
  onChange: (codes: string[]) => void;
  tenantSlug: string;
}

// Render: Search input with debounce
// Results: virtualized list (use @tanstack/react-virtual or simple windowing)
// Each item: code + description + RVU + checkbox
// Selected codes shown as chips above search
// Data source: supabase.from('procedure_codes').textSearch('description', query)
```

**Integration**: Add `procedureCodes` field to CaseForm ReviewStep.

### 3.6 Advanced Analytics Dashboard

**New files**:
- `apps/web/app/(authenticated)/[tenant]/analytics/page.tsx`
- `apps/web/components/AnalyticsDashboard.tsx` (enhance existing)

**New data fetches** (server-side, parallel):
```typescript
const [
  monthlyVolume,      // case_entries grouped by month
  specialtyBreakdown,  // case_entries grouped by specialty
  supervisorWorkload,   // approval_requests grouped by supervisor
  residentProgress,     // goal_progress + case counts per resident
  milestoneProgress,    // milestones avg level per competency
  dutyHourTrends,       // duty_periods grouped by week
] = await Promise.all([...7 queries...]);
```

**New charts**:
- Case volume trend (line chart SVG)
- Specialty distribution (donut chart — already have, enhance with drill-down)
- Resident comparison bar chart
- Milestone radar chart (SVG pentagon)
- Duty hours compliance gauge
- Approval turnaround time histogram

### 3.7 Notification Bell with Realtime

**New file**: `apps/web/components/NotificationBell.tsx`

```tsx
// Client component using Supabase realtime subscription
useEffect(() => {
  const channel = supabase
    .channel('notifications')
    .on('INSERT', 'notifications', (payload) => {
      if (payload.new.user_id === user.id) {
        setNotifications(prev => [payload.new, ...prev].slice(0, 20));
        setUnreadCount(prev => prev + 1);
      }
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [user.id]);

// UI: Bell icon in Sidebar header (like the "3" badge on Approvals but dynamic)
// Click → dropdown panel with notification list
// Each notification: title, body, time-ago, link, read/unread dot
// "Mark all as read" button
```

### 3.8 Bulk CSV Import

**New files**:
- `apps/web/app/(authenticated)/[tenant]/cases/import/page.tsx`
- `apps/web/components/CaseImport.tsx`

```tsx
// 1. Upload CSV file
// 2. Parse headers → map to template fields
// 3. Preview table (first 10 rows)
// 4. Select template + field mapping
// 5. Validate (Zod per row)
// 6. Bulk insert via Supabase batch (.insert([...]) with 100 batch size)
// 7. Show success/failure summary
```

### 3.9 Comment Threads on Cases

**New file**: `apps/web/components/CaseComments.tsx`

```tsx
interface Props {
  entryId: string;
  tenantId: string;
  comments: Comment[];
  currentUser: { id: string; fullName: string; role: UserRole };
}

// threaded comment list (max depth 2)
// textarea at bottom → INSERT into comments table
// realtime: subscribe to comments where entry_id = {entryId}
```

---

<a id="phase-4"></a>
## PHASE 4 — Mobile App Upgrades

### 4.1 Splash Screen & App Icon

**File**: `apps/mobile/app.json`
```json
{
  "splash": {
    "image": "./assets/splash.png",
    "resizeMode": "contain",
    "backgroundColor": "#007AFF"
  },
  "icon": "./assets/icon.png",
  "android": {
    "adaptiveIcon": {
      "foregroundImage": "./assets/adaptive-icon.png",
      "backgroundColor": "#007AFF"
    }
  }
}
```

### 4.2 Push Notifications (Supabase Native)

**File**: `apps/mobile/lib/notifications.ts`

```typescript
// Upgrade from polling to Supabase Realtime + Expo Push Notifications
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

export async function registerForPushNotifications() {
  const token = (await Notifications.getExpoPushTokenAsync()).data;

  // Store token in profiles table
  await supabase.from('profiles')
    .update({ push_token: token })
    .eq('user_id', (await supabase.auth.getUser()).data.user?.id);

  // Subscribe to realtime notifications
  const channel = supabase
    .channel('mobile-notifications')
    .on('INSERT', 'notifications', async (payload) => {
      if (payload.new.user_id === currentUserId) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: payload.new.title,
            body: payload.new.body,
            data: { url: payload.new.link },
          },
          trigger: null, // immediate
        });
      }
    })
    .subscribe();
}
```

**Migration needed**: `00088_push_tokens.sql`
```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_token TEXT;
```

### 4.3 Add Rotations Tab to Mobile

**New file**: `apps/mobile/app/(tabs)/rotations.tsx`

```tsx
// Calendar view (month grid)
// Each rotation = colored card in date range
// Tap → detail with shifts
// Offline: cache rotations in WatermelonDB

// Add to TabLayout:
// Tab: 'Rotations', icon: 'calendar', visible for: all roles
```

**WatermelonDB model**: Add `Rotation` model to `lib/db/models/Rotation.ts` and schema v3.

### 4.4 Add Milestones View to Mobile

**New file**: `apps/mobile/app/(tabs)/milestones.tsx`

```tsx
// Resident view: own milestone matrix (22 × 5 grid)
// Tap cell → see evidence (linked case entries)
// Director view: select resident → their matrix
```

### 4.5 Add Evaluation Forms to Mobile

**New file**: `apps/mobile/app/(tabs)/evaluations.tsx`

```tsx
// List evaluation forms by type (Mini-CEX, DOPS, CBD)
// Tap form type → new evaluation form
// Supervisor/Director: pick resident → fill form
// Resident: view received evaluations (read-only)
```

### 4.6 Upgrade Sync Engine

**File**: `apps/mobile/lib/sync.ts`

**Action**: Add sync for new tables:
```typescript
// In SyncService.pullCases():
// Also pull: rotations, shifts, milestones, evaluation_forms, comments

// Add new pull methods:
async pullRotations(residentId: string) { ... }
async pullEvaluationForms(residentId: string) { ... }
async pullNotifications(userId: string) { ... }
async pullComments(entryIds: string[]) { ... }

// Add to push loop:
// Push local rotation/shift changes (if user is director)
```

### 4.7 WatermelonDB Schema v3

**File**: `apps/mobile/lib/db/schema.ts`

```typescript
// Bump schema version from 2 to 3
// Add new models:
import { RotationModel, ShiftModel, EvaluationFormModel, CommentModel } from './models';

export const schema = appSchema({
  version: 3,
  tables: [
    // ... existing tables ...
    { name: 'rotations', columns: [...] },
    { name: 'shifts', columns: [...] },
    { name: 'evaluation_forms', columns: [...] },
    { name: 'comments', columns: [...] },
  ],
});
```

---

<a id="phase-5"></a>
## PHASE 5 — New Features (Competitor Parity)

### 5.1 ACGME WebADS Export

**New edge function**: `supabase/functions/webads-export/index.ts`

```typescript
// Input: tenant_id, resident_id(s), date range
// Output: XML in ACGME WebADS format
// Fields: resident info, case entries (procedure, role, date, attending)
// Format: ACGME Case Log XML schema
// Deno serve:
serve(async (req) => {
  const { tenant_id, resident_ids, date_from, date_to } = await req.json();
  // Verify JWT
  // Fetch case_entries with joins
  // Build XML using XMLSerializer
  // Return XML response
});
```

### 5.2 UK/GMC Framework Support

**Migration**: `00089_gmc_framework.sql`

```sql
-- Add GMC/ISCP to framework_type enum
ALTER TABLE public.accreditation_frameworks
  DROP CONSTRAINT IF EXISTS accreditation_frameworks_type_check;
ALTER TABLE public.accreditation_frameworks
  ADD CONSTRAINT accreditation_frameworks_type_check
  CHECK (framework_type IN ('acgme','scfhs','gmc','canmeds','custom'));

-- Seed GMC curriculum
INSERT INTO public.accreditation_frameworks (tenant_id, name, version, framework_type, milestones)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'GMC Curriculum 2024',
  '2024.1',
  'gmc',
  '[
    {"code":"ML1","description":"Manages safe and effective handover","competency_area":"Maintaining Good Medical Practice","target_minimum":5},
    {"code":"ML2","description":"Safe prescribing","competency_area":"Maintaining Good Medical Practice","target_minimum":10}
  ]'::jsonb
);
```

### 5.3 CanMEDS Role Annotation

**Migration**: `00090_canmeds.sql`

```sql
-- Add CanMEDS roles to case_entries
ALTER TABLE public.case_entries
  ADD COLUMN IF NOT EXISTS canmeds_roles TEXT[] DEFAULT '{}';
-- Possible values: Medical Expert, Communicator, Collaborator, Leader, Health Advocate, Scholar, Professional

CREATE INDEX idx_case_entries_canmeds ON public.case_entries USING gin (canmeds_roles);

-- Seed CanMEDS framework
INSERT INTO public.accreditation_frameworks (tenant_id, name, version, framework_type, milestones)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'CanMEDS 2015',
  '2015',
  'canmeds',
  '[
    {"code":"ME","description":"Medical Expert","competency_area":"Medical Expert","target_minimum":1},
    {"code":"COM","description":"Communicator","competency_area":"Communicator","target_minimum":1},
    {"code":"COL","description":"Collaborator","competency_area":"Collaborator","target_minimum":1},
    {"code":"LDR","description":"Leader","competency_area":"Leader","target_minimum":1},
    {"code":"HA","description":"Health Advocate","competency_area":"Health Advocate","target_minimum":1},
    {"code":"SCH","description":"Scholar","competency_area":"Scholar","target_minimum":1},
    {"code":"PRO","description":"Professional","competency_area":"Professional","target_minimum":1}
  ]'::jsonb
);
```

### 5.4 Scholarly Activity Tracker

**Migration**: `00091_scholarly_activity.sql`

```sql
CREATE TABLE public.scholarly_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('publication','presentation','poster','research','irb','grant','book_chapter')),
  title TEXT NOT NULL,
  journal TEXT,
  authors TEXT,
  date DATE,
  doi TEXT,
  status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','published','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scholarly_tenant_resident ON public.scholarly_activities(tenant_id, resident_id);
CREATE INDEX idx_scholarly_tenant_type ON public.scholarly_activities(tenant_id, activity_type);

ALTER TABLE public.scholarly_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scholarly_activities FORCE ROW LEVEL SECURITY;
CREATE POLICY scholarly_tenant ON public.scholarly_activities FOR ALL
  USING (tenant_id = get_tenant_id()) WITH CHECK (tenant_id = get_tenant_id());

CREATE TRIGGER set_scholarly_updated_at BEFORE UPDATE ON public.scholarly_activities
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
SELECT audit_table_change('scholarly_activities');
```

### 5.5 PDF Report Generator (Enhanced)

**File**: `supabase/functions/generate-pdf/index.ts`

**Upgrade**: Add accreditation mapping visualization, milestone progress charts, rotation history summary.

```typescript
// New input parameters:
interface PDFRequest {
  resident_id: string;
  tenant_id: string;
  date_from: string;
  date_to: string;
  include_sections: {
    case_log: boolean;
    milestone_matrix: boolean;
    duty_hours: boolean;
    evaluations: boolean;
    rotation_history: boolean;
    scholarly: boolean;
  };
}

// Render: Handlebars template → HTML → Puppeteer/Chromium → PDF
// Sections: Cover page, Case log table, Milestone matrix grid,
// Duty hours chart, Evaluation summary, Rotation timeline,
// Scholarly activity list, Appendix: Accreditation mappings
```

---

<a id="phase-6"></a>
## PHASE 6 — Enterprise Differentiators

### 6.1 AI Case Quality Scoring

**Edge function upgrade**: `supabase/functions/ai-insights/index.ts`

```typescript
// New mode: 'quality_score'
// Input: case_entry data (de-identified)
// Output: {
//   completeness: number (0-100),
//   specificity: number (0-100),
//   classification: number (0-100),
//   overall: number (0-100),
//   suggestions: string[]
// }

// Prompt template:
const QUALITY_PROMPT = `Analyze this medical case log entry and score it:
Completeness (are all relevant fields filled?), 
Specificity (is the detail sufficient for ACGME review?), 
Classification (is the procedure correctly categorized?).
Case: {case_data}
Respond as JSON: {completeness, specificity, classification, overall, suggestions}`;
```

### 6.2 AI Competency Gap Analysis

**New edge function**: `supabase/functions/ai-gap-analysis/index.ts`

```typescript
// Input: resident_id, tenant_id
// Fetch: resident's case_entries + milestones + goals + duty_hours
// AI prompt: "Analyze this resident's competency data. Identify gaps
//   between current case volumes and ACGME minimums. Suggest rotations
//   or procedures to close gaps before the next CCC review."
// Output: { gaps: [{competency, current, target, recommendation}], summary }
```

### 6.3 Cross-Institution Benchmarking

**Migration**: `00092_benchmarking.sql`

```sql
-- Anonymous benchmarking aggregation (PHI-safe)
CREATE TABLE public.benchmark_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  specialty TEXT NOT NULL,
  procedure_type TEXT NOT NULL,
  avg_cases_per_resident NUMERIC(5,1),
  tenant_count INTEGER NOT NULL,
  total_residents INTEGER NOT NULL,
  period TEXT NOT NULL, -- '2026-Q3' etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(specialty, procedure_type, period)
);

-- Materialized view for fast aggregation
CREATE MATERIALIZED VIEW public.benchmark_mv AS
SELECT
  t.specialty,
  t.name as procedure_type,
  AVG(ce_count) as avg_cases,
  COUNT(DISTINCT tenant_id) as tenant_count,
  SUM(resident_count) as total_residents
FROM (
  SELECT
    ct.specialty,
    ct.name as tenant_name,
    ce.tenant_id,
    COUNT(ce.id) as ce_count,
    COUNT(DISTINCT ce.resident_id) as resident_count
  FROM case_entries ce
  JOIN case_templates ct ON ce.template_id = ct.id
  WHERE ce.deleted_at IS NULL AND ce.status = 'approved'
  GROUP BY ct.specialty, ct.name, ce.tenant_id
) t
GROUP BY t.specialty, t.name;

-- Refresh weekly via cron
SELECT cron.schedule('refresh-benchmarks', '0 3 * * 1', 'SELECT refresh_benchmark_mv();');
```

### 6.4 White-Label / Custom Branding

**Migration**: `00093_white_label.sql`

```sql
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS custom_branding JSONB DEFAULT '{}';
-- custom_branding: {
--   "primary_color": "#007AFF",
--   "logo_url": "https://...",
--   "institution_name": "Johns Hopkins",
--   "footer_text": "Powered by E-Logbook"
-- }
```

**Web**: Dynamic CSS variables from `custom_branding`:
```tsx
// In [tenant]/layout.tsx:
const branding = auth.tenant.custom_branding || {};
const primaryColor = branding.primary_color || '#007AFF';
// Set as CSS variable:
<style>{`:root { --color-primary: ${primaryColor}; }`}</style>
```

---

<a id="phase-7"></a>
## PHASE 7 — Performance & Polish

### 7.1 Dashboard Query Optimization

**Problem**: Dashboard page makes 4+ count queries + join queries. Can be replaced with a single RPC.

**Migration**: `00094_dashboard_rpc.sql`

```sql
CREATE OR REPLACE FUNCTION public.get_dashboard_data(p_tenant_id UUID, p_resident_id UUID, p_role TEXT)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'stats', jsonb_build_object(
      'draft', (SELECT COUNT(*) FROM case_entries WHERE tenant_id = p_tenant_id AND status = 'draft' AND deleted_at IS NULL AND (p_role = 'resident' AND resident_id = p_resident_id OR p_role != 'resident')),
      'pending', (SELECT COUNT(*) FROM case_entries WHERE tenant_id = p_tenant_id AND status = 'pending' AND deleted_at IS NULL AND (p_role = 'resident' AND resident_id = p_resident_id OR p_role != 'resident')),
      'approved', (SELECT COUNT(*) FROM case_entries WHERE tenant_id = p_tenant_id AND status = 'approved' AND deleted_at IS NULL AND (p_role = 'resident' AND resident_id = p_resident_id OR p_role != 'resident')),
      'rejected', (SELECT COUNT(*) FROM case_entries WHERE tenant_id = p_tenant_id AND status = 'rejected' AND deleted_at IS NULL AND (p_role = 'resident' AND resident_id = p_resident_id OR p_role != 'resident'))
    ),
    'recent_cases', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', ce.id, 'case_date', ce.case_date, 'status', ce.status, 'template_name', ct.name, 'template_specialty', ct.specialty))
      FROM case_entries ce
      JOIN case_templates ct ON ce.template_id = ct.id
      WHERE ce.tenant_id = p_tenant_id AND ce.deleted_at IS NULL
        AND (p_role = 'resident' AND ce.resident_id = p_resident_id OR p_role != 'resident')
      ORDER BY ce.created_at DESC LIMIT 5
    ), '[]'::jsonb),
    'pending_approvals', (SELECT COUNT(*) FROM case_entries WHERE tenant_id = p_tenant_id AND status = 'pending' AND deleted_at IS NULL),
    'total_residents', (SELECT COUNT(*) FROM profiles WHERE tenant_id = p_tenant_id AND role = 'resident' AND deleted_at IS NULL)
  );
$$;
```

**File**: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`

Replace 5+ queries with single RPC call:
```typescript
const { data } = await supabase.rpc('get_dashboard_data', {
  p_tenant_id: auth.tenant.id,
  p_resident_id: auth.profile.id,
  p_role: auth.profile.role,
});
```

### 7.2 Add Loading="lazy" to Images

**All images**: Use Next.js `<Image>` with `loading="lazy"`.

### 7.3 Add ETags for API Routes

**File**: `apps/web/app/api/[tenant]/compliance/export/route.ts` (and all CSV exports)

```typescript
// Add ETag header to GET responses:
const etag = `"${crypto.randomUUID()}"`;
response.headers.set('ETag', etag);
if (request.headers.get('If-None-Match') === etag) {
  return new Response(null, { status: 304 });
}
```

### 7.4 Add Prefetch on Route Hover

**File**: `apps/web/components/Sidebar.tsx`

```tsx
// Add to each NavLink:
onMouseEnter={() => router.prefetch(link.href)}
```

### 7.5 Bundle Size Optimization

**File**: `apps/web/next.config.mjs`

```javascript
// Add:
experimental: {
  optimizePackageImports: ['@heroui/react', 'framer-motion', '@sentry/nextjs'],
},
```

### 7.6 Mobile Keyboard Handling Fix

**File**: `apps/mobile/app/(tabs)/log-case.tsx`

```tsx
// Add KeyboardAvoidingView wrapper to form:
<KeyboardAvoidingView
  behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  keyboardVerticalOffset={90}
>
  {/* existing form fields */}
</KeyboardAvoidingView>
```

### 7.7 Mobile Offline Cache Size Limit

**File**: `apps/mobile/lib/sync.ts`

```typescript
// Add max cache size check:
const MAX_LOCAL_CASES = 500;

async pullCases(residentId: string) {
  const localCount = await db.get<CaseEntry>('case_entries').query().fetch().length;
  if (localCount > MAX_LOCAL_CASES) {
    // Remove oldest synced cases (keep drafts and recent 500)
    const oldCases = await db.get<CaseEntry>('case_entries')
      .query(Q.where('local_sync_status', 'synced'))
      .sortBy('created_at')
      .then(cases => cases.slice(0, cases.length - MAX_LOCAL_CASES));
    await db.write(async () => {
      for (const c of oldCases) await c.destroyPermanently();
    });
  }
  // ... existing pull logic
}
```

### 7.8 Add Sentry Performance Monitoring to Edge Functions

**File**: Each edge function `index.ts`

```typescript
// At top of each edge function:
import * as Sentry from 'https://js.sentry.io/...deno'; // or Sentry Deno SDK

// Wrap main logic:
Sentry.startSpan({ name: 'ai-insights', op: 'function' }, async () => {
  // ... existing function logic
});
```

### 7.9 Add Health Check Deep Check

**File**: `apps/web/app/api/health/route.ts`

```typescript
// Upgrade from simple DB connectivity to deep check:
const checks = await Promise.allSettled([
  supabase.from('tenants').select('id').limit(1).single(),     // DB
  supabase.auth.getSession(),                                    // Auth
  fetch(`${SUPABASE_URL}/functions/v1/ai-insights`, { method: 'OPTIONS' }), // Edge Functions
]);

const status = checks.every(r => r.status === 'fulfilled') ? 'healthy' : 'degraded';
return Response.json({
  status,
  checks: {
    database: checks[0].status === 'fulfilled' ? 'ok' : 'error',
    auth: checks[1].status === 'fulfilled' ? 'ok' : 'error',
    edgeFunctions: checks[2].status === 'fulfilled' ? 'ok' : 'error',
  },
  timestamp: new Date().toISOString(),
}, { status: status === 'healthy' ? 200 : 503 });
```

---

<a id="verification"></a>
## VERIFICATION CHECKLIST

After completing each phase, run ALL of these:

```bash
# 1. TypeScript — 0 errors
pnpm -r typecheck

# 2. Lint — 0 errors
pnpm lint:all

# 3. Tests — all pass
pnpm test

# 4. Build — web builds successfully
pnpm build:web

# 5. Deploy to Vercel
vercel --prod

# 6. Browser check — login page loads
curl -s https://elogbook-two.vercel.app/login | grep "E-Logbook"

# 7. Health check
curl -s https://elogbook-two.vercel.app/api/health | grep "healthy"

# 8. DB check — all tables present
psql ... -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
# Should be 40+ tables (was 33, +7+ new tables)
```

### Manual Verification (Browser)
1. Login as each demo role (resident, supervisor, director, institution_admin, admin)
2. Each dashboard loads without error
3. Create case → submit → approve flow works
4. AI insights query returns response
5. Admin → SSO, webhooks, SCIM, AI config pages load
6. Reports page exports CSV
7. Billing page shows plans
8. New: Rotations calendar page loads
9. New: Milestones matrix page loads
10. New: Evaluation forms page loads
11. New: Onboarding wizard appears for new users

### Manual Verification (Mobile — if EAS configured)
1. Login with magic link
2. Dashboard shows stats
3. Create case offline → go online → syncs
4. New: Rotations tab visible
5. New: Evaluations tab visible
6. New: Push notification received on case approval

---

## SUMMARY — What This Plan Delivers

| Phase | What | New Tables | New Files | Impact |
|-------|------|-----------|-----------|--------|
| 0 | Bug fixes | 0 | ~8 edits | Foundation stability |
| 1 | DB schema | 7 | 7 migrations | Rotations, Milestones, Evaluations, Codes, Notifications, Comments, Onboarding |
| 2 | Security | 1 | ~4 edits | MFA enforcement, webhook retry, rate limiting |
| 3 | Web UI | 0 | ~15 new pages/components | Onboarding, rotations, milestones, evaluations, CPT browser, analytics, notifications, CSV import, comments |
| 4 | Mobile | 0 | ~6 new screens | Rotations, milestones, evaluations, push notifications, sync upgrade |
| 5 | Competitor parity | 3 | ~5 edge functions | WebADS export, GMC/CanMEDS, scholarly, enhanced PDF |
| 6 | Differentiators | 2 | ~3 edge functions | AI quality scoring, gap analysis, benchmarking, white-label |
| 7 | Performance | 0 | ~10 edits | Dashboard RPC, lazy loading, ETags, prefetch, bundle optimization |
| **Total** | | **13 new tables** | **~50 new/edited files** | **Enterprise-grade SaaS** |

### Competitive Position After This Plan

| Capability | Before | After |
|-----------|--------|-------|
| Procedure Logging | ✅ | ✅ + CPT/ICD codes |
| Rotation Scheduling | ❌ | ✅ |
| ACGME Milestones | ❌ | ✅ (22 × 5 matrix) |
| Mini-CEX/DOPS/CBD | ❌ | ✅ |
| CanMEDS | ❌ | ✅ |
| GMC/ISCP (UK) | ❌ | ✅ |
| WebADS Export | ❌ | ✅ |
| Scholarly Activity | ❌ | ✅ |
| AI Case Scoring | ✅ (basic) | ✅ + quality scoring + gap analysis |
| Benchmarking | ❌ | ✅ |
| White-Label | ❌ | ✅ |
| Notifications (Realtime) | ❌ | ✅ |
| Onboarding | ❌ | ✅ |
| Comments on Cases | ❌ | ✅ |
| Bulk Import | ❌ | ✅ |
| Offline-First Mobile | ✅ | ✅ + rotations/evals/milestones |
| Push Notifications | ❌ | ✅ |

**Result**: E-Logbook goes from "best AI + offline logbook" to "full enterprise residency management platform that also has AI and offline-first" — a position no competitor can match.