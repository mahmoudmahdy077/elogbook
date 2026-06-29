# E-Logbook Enterprise Transformation Plan

> **Generated**: 2026-06-24 | **Scope**: Full-stack enterprise hardening | **Target**: Production-ready medical logbook
>
> **WARNING**: This is a MEDICAL application handling PHI (Protected Health Information). Every issue marked CRITICAL must be resolved before production deployment. This plan is organized by priority — start with Phase 1 and do NOT skip phases.

---

## How To Use This Plan

### For Small/Simple LLM Agents

Each task follows this format:

```
### T-NNN: Short Action Title
**Files**: [file paths]
**Severity**: critical/high/medium/low
**Domain**: security/code/ui/performance/sync

**What to do**:
[Clear, step-by-step instructions that any agent can follow]

**Verification**:
[Exact commands to run to verify the fix worked]

**Double-Check**:
[What to confirm before marking done — prevents common mistakes]
```

### Execution Rules

1. **Do NOT skip phases** — Phase 1 must be completed before Phase 2
2. **Run verification after EVERY task** — do not claim success without running the verification step
3. **Double-check before marking done** — read the "Double-Check" section carefully
4. **If verification fails**, re-read the task instructions and try again. Do not proceed to the next task.
5. **If a task seems unclear**, re-read the exact file content referenced before making changes
6. **Never modify a file without reading it first**
7. **Never guess file paths** — use glob/grep to confirm they exist
8. **After ALL tasks in a phase complete**, run the phase-level verification

---

## Consolidated Issue Count

| Domain | Critical | High | Medium | Low | Total |
|--------|----------|------|--------|-----|-------|
| Web App | 9 | 8 | 11 | 5 | 33 |
| Mobile App | 6 | 12 | 14 | 11 | 43 |
| Supabase Backend | 10 | 9 | 12 | 8 | 39 |
| Shared Package | 5 | 8 | 7 | 5 | 25 |
| Security Posture | 4 | 5 | 3 | 2 | 14 |
| Design System | 3 | 6 | 6 | 3 | 18 |
| Build/CI/Config | 10+ | 5+ | 8+ | 5+ | 28+ |
| Offline Sync | 5 | 6 | 7 | 4 | 22 |
| **TOTAL** | **~52** | **~59** | **~68** | **~43** | **~222** |

---

# PHASE 1: CRITICAL SECURITY & DATA INTEGRITY (Week 1)

> These issues could cause data loss, PHI exposure, privilege escalation, or complete billing failure. They block production deployment.

---

## 1.1 Edge Function Auth Bypass (Service Role + user_metadata)

### T-001: Remove user_metadata fallback from edge function auth
**Files**: `supabase/functions/_shared/auth.ts`
**Severity**: CRITICAL — Security
**Domain**: Security

**What to do**:
1. Read `supabase/functions/_shared/auth.ts`
2. Find the `authenticate()` function
3. Remove the `user_metadata` fallback for both `tenant_id` and `role`:
   - Change `tenantId` extraction to ONLY use `app_metadata`
   - Change `role` extraction to ONLY use `app_metadata`
   - If `app_metadata` is missing required fields, return 403 immediately
4. The current code (approximately line 60-61):
   ```typescript
   const tenantId = user.app_metadata?.tenant_id ?? user.user_metadata?.tenant_id;
   const role = user.app_metadata?.role ?? user.user_metadata?.role ?? 'resident';
   ```
   Should become:
   ```typescript
   const tenantId = user.app_metadata?.tenant_id;
   const role = user.app_metadata?.user_role;
   if (!tenantId || !role) {
     return new Response(JSON.stringify({ error: 'Missing tenant or role in auth' }), {
       status: 403, headers: { 'Content-Type': 'application/json' }
     });
   }
   ```

**Verification**:
- Run: `pnpm --filter @elogbook/web typecheck` and `pnpm --filter @elogbook/shared typecheck`
- Read the file and confirm user_metadata is no longer used as fallback

**Double-Check**:
- RLS helper function `get_user_role()` reads `user_role` — make sure the edge function reads the SAME claim name
- The JWT `app_metadata` field is `user_role`, NOT `role`

---

### T-002: Use anon-key client instead of service-role client in edge functions
**Files**: `supabase/functions/_shared/auth.ts`
**Severity**: CRITICAL — Security
**Domain**: Security

**What to do**:
1. Read `supabase/functions/_shared/auth.ts`
2. The `authenticate()` function currently returns a service-role admin client that bypasses ALL RLS
3. Change to return a user-scoped client using the anon key + user's JWT:
   ```typescript
   // Instead of:
   const adminClient = createClient(envVars.url, envVars.serviceRoleKey);
   
   // Do:
   const userClient = createClient(envVars.url, envVars.anonKey, {
     global: { headers: { Authorization: `Bearer ${jwt}` } },
   });
   ```
4. Rename the return property from `supabase` to `supabase` but with the user client
5. For functions that need admin access (payment-webhook), create a SEPARATE function or accept a second parameter for admin client creation

**Verification**:
- Read the auth.ts file and verify the service-role key is no longer used for user-scoped operations
- Verify each edge function import still works with the new return shape

**Double-Check**:
- The `payment-webhook` function needs service-role for idempotency — create a SEPARATE admin client ONLY there
- The `create-checkout` function reads `payment_gateway_config` which has RLS restricting to institution_admin — verify the user client has the right role JWT to access this via RLS

---

## 1.2 Critical Database Security Fixes

### T-003: Fix consent_records RLS policy broken JOIN
**Files**: `supabase/migrations/00013_audit_phi_redaction.sql:127-134`
**Severity**: CRITICAL — Security
**Domain**: Security

**What to do**:
1. Read the migration file around line 127-134
2. Find the policy `"Admin can read all tenant consent records"`
3. The query uses `p.id = auth.uid()` which compares `profiles.id` (UUID PK) with `auth.users.id` — these are NEVER equal
4. Change `p.id = auth.uid()` → `p.user_id = auth.uid()`
5. Create a NEW migration file (00019) to apply this fix — do NOT edit existing migration files

**Verification**:
- Read the new migration and confirm the SQL uses `p.user_id = auth.uid()`
- Simulate with: `supabase db reset` and check the policy definition

**Double-Check**:
- `profiles.id` is the primary key UUID of the profiles table (a different ID from auth.users.id)
- `profiles.user_id` is the foreign key to `auth.users.id` — THIS is the correct field

---

### T-004: Add SECURITY DEFINER search_path to ALL functions
**Files**: `supabase/migrations/00001_schema.sql` through `00018_ai_response_cache.sql` (all SECURITY DEFINER functions)
**Severity**: CRITICAL — Security
**Domain**: Security

**What to do**:
1. Search for ALL `SECURITY DEFINER` functions across all migrations
2. For EACH one, add `SET search_path = ''` (empty string prevents schema hijacking)
3. Create a single NEW migration (00020) that does CREATE OR REPLACE for each function with the search_path added

Functions to fix (approximately 15):
- `update_updated_at()` in 00001
- `get_tenant_id()` in 00002
- `get_user_role()` in 00002
- `audit_case_entry()` in 00003
- `auto_approve_individual()` in 00003
- `recalc_goal_progress()` in 00003
- `get_case_stats()` in 00003/00012/00016
- `write_once_submitted_check()` in 00003
- `handle_new_user()` in 00004
- `hash_patient_mrn()` in 00007
- `approve_case()` in 00009
- `reject_case()` in 00009
- `block_lapsed_tenant_submit()` in 00010
- `enforce_case_status_transition()` in 00011
- `enforce_data_retention()` in 00013
- `refresh_case_stats_mv()` in 00016
- `cleanup_ai_response_cache()` in 00018

**Verification**:
- Read the new migration and confirm EVERY function has search_path set
- Count the functions — should match the list above

**Double-Check**:
- IMMUTABLE functions like `hash_patient_mrn()` also need this fix (it's currently IMMUTABLE but should be STABLE — see T-005)
- The syntax is: `CREATE OR REPLACE FUNCTION foo() RETURNS ... LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$ ... $$;`

---

### T-005: Fix hash_patient_mrn IMMUTABLE → STABLE
**Files**: `supabase/migrations/00011_critical_schema_fixes.sql:167-178`
**Severity**: HIGH — Data Integrity
**Domain**: Security

**What to do**:
1. Read the function definition for `hash_patient_mrn()`
2. Change `IMMUTABLE` → `STABLE` — the function uses `current_setting('app.mrn_salt')` which can change at runtime
3. Need to ensure this function is NOT used in index expressions (IMMUTABLE is required for index usage)

**Verification**:
- Check if `hash_patient_mrn` appears in any CREATE INDEX statement across all migrations
- Read the new migration and confirm the volatility change

**Double-Check**:
- If the function IS used in an index, you must either: (a) find an alternative to the index, or (b) make the salt truly immutable via a compile-time constant
- If the function is NOT used in an index, change to STABLE is safe

---

## 1.3 Critical Billing Infrastructure Fixes

### T-006: Create stripe_events table
**Files**: `supabase/functions/payment-webhook/index.ts:74-96`
**Severity**: CRITICAL — Functionality
**Domain**: Code

**What to do**:
1. Create migration 00021 to add `stripe_events` table:
   ```sql
   CREATE TABLE stripe_events (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     stripe_event_id TEXT UNIQUE NOT NULL,
     type TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'processing',
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     processed_at TIMESTAMPTZ
   );
   ```
2. Add RLS policy (only service-role can access this since webhooks use service-role):
   ```sql
   ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Only service role can manage stripe_events"
     ON stripe_events FOR ALL USING (current_user = 'service_role');
   ```

**Verification**:
- Read the migration file and confirm all columns match what the webhook code expects
- Check that `stripe_event_id TEXT UNIQUE NOT NULL` exists (this is used for idempotency)

**Double-Check**:
- The webhook code references `supabase.from('stripe_events')` — the table name must match exactly
- The `UNIQUE` constraint on `stripe_event_id` is critical for idempotency

---

### T-007: Add UNIQUE(tenant_id) constraint to subscriptions table
**Files**: `supabase/functions/payment-webhook/index.ts:121-129`, `supabase/migrations/00001_schema.sql`
**Severity**: CRITICAL — Functionality
**Domain**: Code

**What to do**:
1. Create migration 00022:
   ```sql
   -- Add unique constraint on tenant_id for upsert conflict resolution
   ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_tenant_id_key UNIQUE (tenant_id);
   
   -- Also add gateway_subscription_id for cross-reference
   CREATE INDEX IF NOT EXISTS idx_subscriptions_gateway_id
     ON subscriptions (gateway_subscription_id);
   ```

**Verification**:
- Run: `supabase db reset` and verify no errors
- Read the migration and confirm the constraint name matches what the webhook `onConflict` uses

**Double-Check**:
- The webhook uses `onConflict: 'tenant_id'` — this requires a unique constraint on the `tenant_id` column
- Currently there is NO unique constraint, so the upsert always fails on the second call

---

## 1.4 Critical Data Integrity Fixes

### T-008: Fix write_once_submitted_check to allow rejected→draft transition
**Files**: `supabase/migrations/00003_triggers.sql:250-266` and `00011_critical_schema_fixes.sql:130-161`
**Severity**: CRITICAL — Functionality
**Domain**: Code

**What to do**:
1. Create migration 00023:
   ```sql
   CREATE OR REPLACE FUNCTION write_once_submitted_check()
   RETURNS TRIGGER AS $$
   DECLARE
     v_role TEXT;
   BEGIN
     v_role := get_user_role();
     
     IF v_role = 'resident' THEN
       -- Allow rejected→draft transition (resubmit)
       IF OLD.status = 'rejected' AND NEW.status = 'draft' THEN
         RETURN NEW;
       END IF;
       
       -- Block all other modifications to non-draft entries
       IF OLD.status != 'draft' THEN
         RAISE EXCEPTION 'Cannot modify a submitted case. Only rejected cases can be edited for resubmission.'
           USING ERRCODE = 'P0001';
       END IF;
     END IF;
     
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';
   ```

**Verification**:
- Read the migration and confirm the logic: `OLD.status = 'rejected' AND NEW.status = 'draft'` allows the transition
- Any other modification by a resident on a non-draft entry is blocked

**Double-Check**:
- The trigger firing order: `write_once_submitted_check` fires BEFORE UPDATE in 00003. `enforce_case_status_transition` fires BEFORE UPDATE in 00011. Both must allow rejected→draft. Check 00011's function too.
- Also verify migration 00011's `enforce_case_status_transition` allows rejected→draft

---

### T-009: Add quota_used column and atomic decrement
**Files**: `supabase/migrations/00001_schema.sql:193-201`, `supabase/functions/ai-insights/index.ts:147,159`
**Severity**: CRITICAL — Functionality
**Domain**: Code

**What to do**:
1. Create migration 00024:
   ```sql
   ALTER TABLE resident_ai_toggle 
     ADD COLUMN IF NOT EXISTS quota_used INTEGER NOT NULL DEFAULT 0;
   
   -- Add CHECK constraint to prevent negative quota
   ALTER TABLE resident_ai_toggle 
     ADD CONSTRAINT quota_used_non_negative CHECK (quota_used >= 0);
   ```
2. Update the AI insights edge function to use atomic UPDATE:
   ```sql
   -- Instead of SELECT then check, use:
   UPDATE resident_ai_toggle 
   SET quota_used = quota_used + 1 
   WHERE resident_id = $1 AND tenant_id = $2 AND quota_used < quota_limit
   RETURNING *;
   ```

**Verification**:
- Read the migration and confirm the column and constraint are added
- Verify the edge function sends a single atomic SQL statement

**Double-Check**:
- The edge function currently queries `quota_used` which doesn't exist in the table — this means quota check always evaluates `quota_used >= quota_limit` as `null >= number` = `false`, so quota was NEVER enforced
- The atomic UPDATE prevents race conditions where concurrent requests both pass the check

---

## 1.5 Critical Offline Sync Fixes

### T-010: Fix pull overwriting local unsynced modifications
**Files**: `apps/mobile/lib/db/storage.ts:106-128`, `apps/mobile/lib/sync.ts:87-112`
**Severity**: CRITICAL — Data Loss
**Domain**: Sync

**What to do**:
1. Read `storage.ts` and find the `upsertCaseEntry()` function
2. Before overwriting a local record, check its `localSyncStatus`:
   ```typescript
   // In upsertCaseEntry, before creating/updating:
   const existing = await db.get<CaseEntry>('case_entries')
     .query(Q.where('id', serverData.id))
     .fetch();
   
   if (existing.length > 0) {
     const localStatus = existing[0].localSyncStatus;
     if (localStatus === 'draft' || localStatus === 'modified' || localStatus === 'created') {
       // Skip pull overwrite — local changes take priority
       // The push phase will handle this
       return existing[0];
     }
   }
   ```
3. Apply the same pattern to `upsertTemplate()` and `upsertProgramGoal()`

**Verification**:
- Read the modified file and confirm the check exists BEFORE the create/update logic
- Trace the logic: pull → upsertCaseEntry → checks localSyncStatus → skips if local has pending changes

**Double-Check**:
- The push phase (pushCases) handles pushing local changes. After push succeeds, the next pull cycle will see updated_at changed and sync correctly.
- The 'conflict' status should also be preserved — conflicts must be manually resolved, not auto-overwritten

---

### T-011: Fix WatermelonDB raw.id override (use proper create pattern)
**Files**: `apps/mobile/lib/db/storage.ts:133,173,205`
**Severity**: CRITICAL — Data Integrity
**Domain**: Sync

**What to do**:
1. Read the `upsertCaseEntry`, `upsertTemplate`, and `upsertProgramGoal` functions
2. Currently they use: `db.write(() => { const record = collection.create(entry => { ... }); record._raw.id = String(serverData.id); })`
3. This uses a private API (`_raw`) and is unsupported
4. Change to use the second parameter of `create()`:
   ```typescript
   // Correct pattern:
   await db.write(async () => {
     const record = await collection.create(entry => {
       entry._raw.id = String(serverData.id); // Still using _raw but WatermelonDB docs show this
       // ... set all fields
     });
   });
   ```
   Actually, the CORRECT WatermelonDB pattern is:
   ```typescript
   await db.write(async () => {
     // For batch operations, use prepareCreate + batch
     const record = collection.create(entry => {
       entry._raw.id = String(serverData.id); // WatermelonDB supports setting id in create callback
       entry._raw._changed = 'created';
       // ... other fields
     });
   });
   ```

**Verification**:
- Read the WatermelonDB documentation for sync patterns
- Confirm the code uses the documented API, not private internal properties

**Double-Check**:
- WatermelonDB's own synchronizer example uses `collection.create(record => { ... }, id)` but the `id` as second parameter may not be supported in all versions
- The `_raw` property is explicitly documented as internal API that may change between versions
- Safer alternative: use `batch()` with `prepareCreate()` and `prepareUpdate()`

---

### T-012: Implement proper conflict detection with updated_at comparison
**Files**: `apps/mobile/lib/sync.ts:195-204`
**Severity**: CRITICAL — Data Integrity
**Domain**: Sync

**What to do**:
1. Currently the code checks for `result.error.code === '409'` but Supabase REST API does NOT return 409 for row conflicts
2. Replace with a Supabase RPC that implements optimistic concurrency:
   ```sql
   -- Create migration 00025:
   CREATE OR REPLACE FUNCTION push_case_entry(
     p_id UUID,
     p_data JSONB,
     p_updated_at TIMESTAMPTZ,
     p_tenant_id UUID,
     p_resident_id UUID
   ) RETURNS JSONB
   LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
   AS $$
   DECLARE
     v_existing_updated_at TIMESTAMPTZ;
     v_result JSONB;
   BEGIN
     SELECT updated_at INTO v_existing_updated_at
     FROM case_entries WHERE id = p_id AND tenant_id = p_tenant_id;
     
     IF v_existing_updated_at IS NULL THEN
       -- New record — insert
       -- ... INSERT logic ...
       RETURN jsonb_build_object('status', 'created');
     ELSIF v_existing_updated_at <= p_updated_at THEN
       -- Local is newer or same — update
       -- ... UPDATE logic ...
       RETURN jsonb_build_object('status', 'updated');
     ELSE
       -- Server is newer — conflict
       RETURN jsonb_build_object('status', 'conflict', 'server_updated_at', v_existing_updated_at);
     END IF;
   END;
   $$;
   ```

**Verification**:
- Read the RPC and confirm it returns `{ status: 'created' | 'updated' | 'conflict' }`
- Confirm the mobile code calls this RPC instead of direct upsert

**Double-Check**:
- This RPC must be accessible to authenticated users (not just service-role)
- The mobile code must handle all three response statuses
- For 'conflict' status, the mobile code should update `localSyncStatus = 'conflict'` and show the conflict banner

---

### T-013: Add WatermelonDB schema migration handler
**Files**: `apps/mobile/lib/db/database.ts`
**Severity**: HIGH — Data Integrity
**Domain**: Sync

**What to do**:
1. Create `apps/mobile/lib/db/migrations.ts`:
   ```typescript
   import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations';
   
   export const migrations = schemaMigrations({
     migrations: [
       // Define migrations for future schema changes here
       // Example:
       // {
       //   toVersion: 3,
       //   steps: [
       //     addColumns({
       //       table: 'case_entries',
       //       columns: [
       //         { name: 'region', type: 'string', isOptional: true },
       //       ],
       //     }),
       //   ],
       // },
     ],
   });
   ```
2. Update `database.ts` to pass migrations to the adapter:
   ```typescript
   import { migrations } from './migrations';
   
   const adapter = new SQLiteAdapter({
     schema,
     migrations, // <-- ADD THIS
     jsi: true,
     onSetUpError: (error) => {
       console.error('Database setup error:', error);
     },
   });
   ```

**Verification**:
- Read database.ts and confirm `migrations` is passed to the SQLiteAdapter
- Read migrations.ts and confirm it doesn't crash at import time (it can be an empty migration set)

**Double-Check**:
- The current schema version is 2 (defined in schema.ts line 4)
- If no migrations are defined, the app works normally. The fix just enables future migrations.

---

# PHASE 2: HIGH-SEVERITY CODE & SECURITY (Week 2-3)

> These issues could cause data leakage, inconsistent state, poor UX, or compliance gaps.

---

## 2.1 Web App: Critical Code Quality

### T-014: Delete all dead code in web components
**Files**: `apps/web/components/case-form/CaseDetailsForm.tsx`, `PatientInfoForm.tsx`, `ReviewSummary.tsx`, `SubmissionActions.tsx`, `TemplateSelector.tsx`, `useCaseFormKeyboard.ts`, `useCaseFormSubmission.ts`, `useCaseFormValidation.ts`, `apps/web/components/ApprovalsDashboard.tsx` (root), `apps/web/components/dashboard/*.tsx`
**Severity**: HIGH — Code Quality
**Domain**: Code

**What to do**:
1. FIRST, verify each file is dead code:
   - Use grep to search for import references of each file
   - Use grep to search for any export usage from each file
2. Delete confirmed dead files (MAKE A BACKUP FIRST — copy to a backup folder)
3. Files to check and likely delete:
   - `components/case-form/CaseDetailsForm.tsx` — if unused
   - `components/case-form/PatientInfoForm.tsx` — if unused
   - `components/case-form/ReviewSummary.tsx` — if unused
   - `components/case-form/SubmissionActions.tsx` — if unused
   - `components/case-form/TemplateSelector.tsx` — if unused
   - `components/case-form/useCaseFormKeyboard.ts` — if unused
   - `components/case-form/useCaseFormSubmission.ts` — if unused
   - `components/case-form/useCaseFormValidation.ts` — if unused
   - `components/ApprovalsDashboard.tsx` — the ROOT one (approvals/page.tsx imports from `approvals/ApprovalsDashboard`)
   - `components/dashboard/WelcomeHeader.tsx` — if unused
   - `components/dashboard/KPIRing.tsx` — if unused
   - `components/dashboard/KPIRingGrid.tsx` — if unused
   - `components/dashboard/ProgressBar.tsx` — if unused
   - `components/dashboard/RecentCasesPanel.tsx` — if unused
   - `components/dashboard/ResidentGoalsPanel.tsx` — if unused
   - `components/dashboard/RoleSpecificPanel.tsx` — if unused
   - `components/dashboard/SupervisorApprovalsPanel.tsx` — if unused
   - `components/dashboard/DirectorResidentsPanel.tsx` — if unused

**Verification**:
- Run: `pnpm --filter @elogbook/web typecheck` — must pass with no errors
- Run: `pnpm --filter @elogbook/web lint` — must pass with no errors about missing imports

**Double-Check**:
- Do NOT delete files that are imported by other components — verify EACH file with grep
- Keep a backup of deleted files for at least 1 week

---

### T-015: Fix stale closure in CaseForm.tsx keyboard handler
**Files**: `apps/web/components/CaseForm.tsx:217-240`
**Severity**: HIGH — Code Quality
**Domain**: Code

**What to do**:
1. Read `CaseForm.tsx` and find the `handleKeyDown` useEffect
2. Wrap `canProceed` in `useCallback`:
   ```typescript
   const canProceed = useCallback((stepIndex: number): boolean => {
     // existing logic...
   }, [step, patientMrn, patientDob, patientHash, selectedTemplateId, caseDate,
       procedureName, diagnosis, findings]);
   ```
3. Add `canProceed` to the keyboard handler's dependency array:
   ```typescript
   useEffect(() => {
     const handleKeyDown = (e: KeyboardEvent) => {
       // existing logic using canProceed
     };
     document.addEventListener('keydown', handleKeyDown);
     return () => document.removeEventListener('keydown', handleKeyDown);
   }, [step, confirmSubmit, submitted, canProceed]);
   ```

**Verification**:
- Run: `pnpm --filter @elogbook/web typecheck` — must pass
- Read the code and confirm `canProceed` is wrapped in `useCallback` and added to deps

**Double-Check**:
- The `canProceed` dependencies must include ALL state variables it reads
- Missing a dependency means the keyboard handler will still have a stale closure

---

### T-016: Add RPC error handling in CaseForm.tsx
**Files**: `apps/web/components/CaseForm.tsx:165-168,199-203`
**Severity**: HIGH — Code Quality
**Domain**: Code

**What to do**:
1. Read `CaseForm.tsx` and find `handleSaveDraft` and `handleSubmit` functions
2. Both call `supabase.rpc('hash_patient_mrn', ...)` without checking for errors
3. Add error handling:
   ```typescript
   const { data: hash, error: hashError } = await supabase.rpc('hash_patient_mrn', {
     p_mrn: patientMrn,
     p_tenant_id: tenantId,
   });
   
   if (hashError) {
     setError('Failed to generate patient hash. Please try again.');
     setSavingDraft(false); // or setLoading(false) for submit
     return;
   }
   ```

**Verification**:
- Read the modified file and confirm both `handleSaveDraft` and `handleSubmit` have error checks after the RPC call
- If hash fails, the function should return early with an error message, not proceed with `hash || ''`

**Double-Check**:
- The `setError(...)` function must be defined or created for this component
- The error message must be user-visible (not just console.error)

---

### T-017: Add error feedback to ApprovalActions.tsx
**Files**: `apps/web/components/ApprovalActions.tsx:36-39`
**Severity**: HIGH — Code Quality
**Domain**: Code

**What to do**:
1. Read `ApprovalActions.tsx` and find `handleAction` function
2. Currently it silently swallows errors (just sets `loading(null)` and returns)
3. Add user-visible error feedback:
   ```typescript
   if (error) {
     setError(error.message || 'Failed to process approval. Please try again.');
     setLoading(null);
     return;
   }
   ```
4. Also call `router.refresh()` only on success:
   ```typescript
   if (!error) {
     onActionComplete?.(action);
     router.refresh();
   }
   ```

**Verification**:
- Read the modified file and confirm error is shown to user (toast, inline message, or alert)
- Confirm `router.refresh()` only fires on success

**Double-Check**:
- The component needs access to a toast/notification system or have its own error state
- Check if `Toast.tsx` is available in the component tree

---

### T-018: Remove 'unsafe-eval' from production CSP
**Files**: `apps/web/next.config.js:14`
**Severity**: HIGH — Security
**Domain**: Security

**What to do**:
1. Read `next.config.js`
2. Remove `'unsafe-eval'` from `script-src` — it's only needed for React dev mode
3. Make it conditional:
   ```javascript
   const isDev = process.env.NODE_ENV === 'development';
   
   const scriptSrc = [
     "'self'",
     "'unsafe-inline'", // Keep for now — Next.js needs it for inline scripts
     ...(isDev ? ["'unsafe-eval'"] : []),
   ];
   
   // In ContentSecurityPolicy:
   script-src ${scriptSrc.join(' ')};
   ```
4. Add `Strict-Transport-Security` header:
   ```
   Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
   ```

**Verification**:
- Read next.config.js and confirm `unsafe-eval` is only present in dev mode
- Run: `pnpm build:web` — must succeed

**Double-Check**:
- In production, Next.js uses `strict-dynamic` when nonces are configured. Without nonces, `'unsafe-inline'` is required for inline scripts.
- Consider using `experimental.strictServerHandshake` in future Next.js versions for better CSP

---

## 2.2 Mobile App: Critical Code Quality

### T-019: Fix StatusBadge color string concatenation
**Files**: `apps/mobile/components/StatusBadge.tsx:20-48`
**Severity**: CRITICAL — Visual
**Domain**: UI

**What to do**:
1. Read `StatusBadge.tsx` and find the status config object
2. The current code concatenates rgba string with hex alpha: `'rgba(245, 158, 11, 0.45)66'` which is invalid
3. Fix by computing proper rgba values:
   ```typescript
   // Instead of template literals that mix rgba + hex:
   const statusConfig = {
     pending: {
       label: 'Pending',
       dot: '#FCD34D',
       bg: 'rgba(252, 211, 77, 0.15)',
       border: 'rgba(252, 211, 77, 0.3)',
     },
     approved: {
       label: 'Approved',
       dot: '#6EE7B7',
       bg: 'rgba(110, 231, 183, 0.15)',
       border: 'rgba(16, 185, 129, 0.3)',
     },
     // ... etc
   };
   ```

**Verification**:
- Run: `pnpm --filter @elogbook/mobile typecheck` — must pass
- Read the file and confirm all rgba strings are valid (no concatenation of different formats)

**Double-Check**:
- React Native does NOT support hex alpha suffixes like `#FF000080` — use `rgba()` instead
- The draft variant currently works because it uses a simple hex value — keep it consistent

---

### T-020: Fix log-case.tsx stale closure in setTimeout
**Files**: `apps/mobile/app/(tabs)/log-case.tsx:194-205`
**Severity**: HIGH — Data Loss
**Domain**: Code

**What to do**:
1. Read `log-case.tsx` around line 194-205 where `setTimeout` is used
2. Replace the state-based `confirmationSuccess` with a ref:
   ```typescript
   const confirmationTypeRef = useRef<'offline' | 'submitted' | null>(null);
   
   // In the submit handler:
   confirmationTypeRef.current = isOnline ? 'submitted' : 'offline';
   
   // In setTimeout:
   setTimeout(() => {
     if (confirmationTypeRef.current === 'submitted') {
       // Reset form
     }
     confirmationTypeRef.current = null;
     setConfirmationSuccess(false);
   }, 2000);
   ```

**Verification**:
- Read the modified file and confirm a ref is used instead of relying on state within setTimeout
- The ref ensures the callback reads the LATEST value, not a stale closure

**Double-Check**:
- Refs don't trigger re-renders — this is the correct behavior here since we only need to read the value in the timeout callback
- The state-based approach would capture the value at the time the setTimeout was scheduled, which could be stale

---

### T-021: Fix sync status color replacement in log-case.tsx
**Files**: `apps/mobile/app/(tabs)/log-case.tsx:284`
**Severity**: HIGH — Visual
**Domain**: UI

**What to do**:
1. Read the line around 284, find the sync status icon color logic
2. Currently: `color={c.color.replace('text-', '#') || '#fff'}` produces invalid colors like `#blue-400`
3. Replace with a proper color map:
   ```typescript
   const syncColorMap: Record<string, string> = {
     'text-blue-400': '#60A5FA',
     'text-green-400': '#34D399',
     'text-yellow-400': '#FBBF24',
     'text-red-400': '#F87171',
   };
   
   color={syncColorMap[c.color] || '#FFFFFF'}
   ```

**Verification**:
- Read the file and confirm all sync colors resolve to valid hex strings
- The `|| '#FFFFFF'` fallback should be a valid hex color

**Double-Check**:
- Add ALL possible sync status colors that could come from the status config
- The sync status types are: 'synced' (blue), 'syncing' (yellow), 'error' (red), 'offline' (yellow?)

---

### T-022: Extract auth/profile into React Context
**Files**: `apps/mobile/app/(tabs)/*.tsx` (all 7 screen files)
**Severity**: HIGH — Performance
**Domain**: Code

**What to do**:
1. Create `apps/mobile/lib/AuthContext.tsx`:
   ```typescript
   import React, { createContext, useContext, useEffect, useState } from 'react';
   import { supabase } from './supabase';
   import { Profile } from '@elogbook/shared';
   
   interface AuthContextValue {
     user: User | null;
     profile: Profile | null;
     tenantId: string | null;
     role: string | null;
     loading: boolean;
     refresh: () => Promise<void>;
   }
   
   const AuthContext = createContext<AuthContextValue>({
     user: null, profile: null, tenantId: null, role: null,
     loading: true,
     refresh: async () => {},
   });
   
   export function AuthProvider({ children }: { children: React.ReactNode }) {
     const [user, setUser] = useState<User | null>(null);
     const [profile, setProfile] = useState<Profile | null>(null);
     const [loading, setLoading] = useState(true);
     
     const loadProfile = useCallback(async () => {
       const { data: { user } } = await supabase.auth.getUser();
       if (!user) { setLoading(false); return; }
       setUser(user);
       
       const { data: profile } = await supabase.from('profiles')
         .select('*').eq('user_id', user.id).single();
       setProfile(profile);
       setLoading(false);
     }, []);
     
     useEffect(() => { loadProfile(); }, [loadProfile]);
     
     return (
       <AuthContext.Provider value={{
         user, profile,
         tenantId: profile?.tenant_id,
         role: profile?.role,
         loading, refresh: loadProfile,
       }}>
         {children}
       </AuthContext.Provider>
     );
   }
   
   export const useAuth = () => useContext(AuthContext);
   ```
2. Wrap the `_layout.tsx` with `<AuthProvider>` 
3. Replace `supabase.auth.getUser()` + profile fetch in EVERY screen with `const { user, profile, tenantId, role } = useAuth()`
4. Remove the duplicated auth code from all 7 screen files

**Verification**:
- Run: `pnpm --filter @elogbook/mobile typecheck` — must pass
- Check each screen file: confirm the independent auth fetching code is removed and replaced with `useAuth()`

**Double-Check**:
- The `AuthContext` must handle loading state — screens should show a loading spinner while auth is initializing
- Add `onAuthStateChange` listener to refresh profile when session changes
- Make sure `useCallback` and `useEffect` are imported

---

### T-023: Add date picker and validation for case_date
**Files**: `apps/mobile/app/(tabs)/log-case.tsx:452-461`
**Severity**: HIGH — UX
**Domain**: UI

**What to do**:
1. Read the case date input section
2. Replace `TextInput` with a date picker:
   ```typescript
   import DateTimePicker from '@react-native-community/datetimepicker';
   
   // State:
   const [caseDate, setCaseDate] = useState(new Date());
   const [showDatePicker, setShowDatePicker] = useState(false);
   
   // In the render:
   <TouchableOpacity onPress={() => setShowDatePicker(true)}>
     <Text className="text-text-primary font-body">{caseDate.toISOString().split('T')[0]}</Text>
   </TouchableOpacity>
   
   {showDatePicker && (
     <DateTimePicker
       value={caseDate}
       mode="date"
       maximumDate={new Date()}
       onChange={(event, date) => {
         setShowDatePicker(false);
         if (date) setCaseDate(date);
       }}
     />
   )}
   ```
3. Add validation: date should not be in the future, and should be within reasonable range (e.g., not before 1900)

**Verification**:
- Run: `pnpm --filter @elogbook/mobile typecheck` — must pass
- Read the code and confirm the date picker is within the `KeyboardAvoidingView` or `ScrollView`

**Double-Check**:
- `@react-native-community/datetimepicker` must be added to `package.json` as a dependency
- Check if `expo-date-time-picker` is already available or if another date library is used
- The `maximumDate={new Date()}` prevents future dates (clinical constraint)

---

### T-024: Fix rejection always sending empty comment
**Files**: `apps/mobile/app/(tabs)/case-detail.tsx:127-129`, `apps/mobile/app/(tabs)/approvals.tsx:117-119`
**Severity**: HIGH — UX
**Domain**: Code

**What to do**:
1. Read both files for the rejection comment logic
2. Add a comment input before rejection:
   ```typescript
   // In case-detail.tsx and approvals.tsx:
   const [rejectionComment, setRejectionComment] = useState('');
   const [showRejectionDialog, setShowRejectionDialog] = useState(false);
   
   // Reject button handler:
   const handleReject = () => {
     setShowRejectionDialog(true);
   };
   
   // In the rejection dialog:
   <Modal visible={showRejectionDialog} transparent>
     <View className="flex-1 justify-center items-center bg-black/50">
       <View className="bg-panel rounded-xl p-4 w-80">
         <Text className="text-text-primary font-heading text-lg mb-2">Reject Case</Text>
         <Text className="text-text-secondary font-body mb-2">Reason for rejection:</Text>
         <TextInput
           className="bg-neutral-dark text-text-primary rounded-lg p-2 mb-4"
           value={rejectionComment}
           onChangeText={setRejectionComment}
           placeholder="Enter reason..."
           multiline
         />
         <View className="flex-row justify-end gap-2">
           <TouchableOpacity onPress={() => setShowRejectionDialog(false)}>
             <Text className="text-text-muted">Cancel</Text>
           </TouchableOpacity>
           <TouchableOpacity onPress={() => {
             submitRejection(rejectionComment);
             setShowRejectionDialog(false);
             setRejectionComment('');
           }}>
             <Text className="text-danger">Reject</Text>
           </TouchableOpacity>
         </View>
       </View>
     </View>
   </Modal>
   ```

**Verification**:
- Run: `pnpm --filter @elogbook/mobile typecheck` — must pass
- Read the modified files and confirm the rejection sends `p_comment` with the entered text

**Double-Check**:
- The RPC call for reject_case must include `p_comment` parameter
- The server-side `reject_case()` function should handle the comment (check migration 00009)

---

## 2.3 Supabase: Critical Edge Function Fixes

### T-025: Fix CORS origin validation (remove startsWith)
**Files**: `supabase/functions/_shared/auth.ts:76`
**Severity**: HIGH — Security
**Domain**: Security

**What to do**:
1. Read the CORS validation logic
2. Replace `startsWith` with exact match only:
   ```typescript
   const allowedOrigin = origin && ALLOWED_ORIGINS.some((o) => origin === o);
   ```
3. Remove the `origin.startsWith(o)` check which allows subdomain bypass attacks

**Verification**:
- Read the file and confirm only `===` (exact match) is used for origin validation
- Run the edge function locally to verify CORS still works for legitimate origins

**Double-Check**:
- ALLOWED_ORIGINS must contain ALL legitimate origins including `http://localhost:3000`, `https://app.elogbook.com`, etc.
- Check if `exp://` or mobile app origins need to be in the list

---

### T-026: Add SSRF protection for custom AI provider endpoint
**Files**: `supabase/functions/ai-insights/index.ts:351,379-387`
**Severity**: HIGH — Security
**Domain**: Security

**What to do**:
1. Read the custom endpoint URL handling
2. Add URL validation that:
   - Rejects IP addresses (no raw IPs allowed)
   - Rejects private ranges: `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, `169.254.x.x`, `127.x.x.x`
   - Only allows HTTPS URLs
   - Validates against a whitelist of known AI provider domains
   ```typescript
   function isValidEndpoint(url: string): boolean {
     try {
       const parsed = new URL(url);
       if (parsed.protocol !== 'https:') return false;
       
       const hostname = parsed.hostname.toLowerCase();
       
       // Block IP addresses
       const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
       if (ipRegex.test(hostname)) return false;
       
       // Block private domains
       const blockedPatterns = [
         /\.internal$/,
         /\.local$/,
         /localhost$/,
       ];
       if (blockedPatterns.some(p => p.test(hostname))) return false;
       
       // Optionally: check allowed domains
       // const allowedDomains = ['openai.com', 'anthropic.com', 'azure.com', ...];
       // return allowedDomains.some(d => hostname === d || hostname.endsWith('.' + d));
       
       return true;
     } catch {
       return false;
     }
   }
   ```

**Verification**:
- Read the modified edge function and confirm URL validation is called before fetch
- The validation must happen BEFORE the API call, not after

**Double-Check**:
- The safest approach is a domain allowlist for known AI providers
- If custom endpoints must be supported, at minimum block private IP ranges and internal TLDs

---

### T-027: Add rate limiting to AI insights edge function
**Files**: `supabase/functions/ai-insights/index.ts`
**Severity**: HIGH — Security
**Domain**: Security

**What to do**:
1. Add per-user rate limiting using the existing `resident_ai_toggle` table
2. Use atomic UPDATE (as fixed in T-009)
3. Additionally add an in-memory rate limiter:
   ```typescript
   const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
   const RATE_LIMIT = 10; // requests per minute
   const RATE_WINDOW = 60_000; // 1 minute
   
   function checkRateLimit(userId: string): boolean {
     const now = Date.now();
     const entry = rateLimitMap.get(userId);
     
     if (!entry || now > entry.resetAt) {
       rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW });
       return true;
     }
     
     if (entry.count >= RATE_LIMIT) return false;
     entry.count++;
     return true;
   }
   ```
4. Return 429 status when rate limited:
   ```typescript
   if (!checkRateLimit(user.id)) {
     return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }), {
       status: 429,
       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
     });
   }
   ```

**Verification**:
- Read the modified file and confirm rate limiting is checked BEFORE the AI API call
- The rate limit check should be right after authentication

**Double-Check**:
- Rate limitMap must not grow unbounded — add cleanup of old entries every few minutes
- The rate limit is per-user, not per-tenant (prevents one user from exhausting tenant quota)
- Clean the map periodically to prevent memory leak:
  ```typescript
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
      if (now > entry.resetAt) rateLimitMap.delete(key);
    }
  }, 60_000);
  ```

---

### T-028: Fix generate-pdf to verify case ownership server-side
**Files**: `supabase/functions/generate-pdf/index.ts:37-43`
**Severity**: HIGH — Security
**Domain**: Security

**What to do**:
1. Instead of trusting client-supplied case data, re-fetch from DB:
   ```typescript
   // Instead of using client-supplied cases:
   const { cases } = await req.json();
   
   // Re-fetch from database using authenticated user's tenant:
   const { data: dbCases, error } = await supabase
     .from('case_entries')
     .select('*, templates:case_templates(*)')
     .in('id', caseIds)
     .eq('tenant_id', tenantId); // CRITICAL: verify tenant ownership
   
   if (error || !dbCases || dbCases.length !== caseIds.length) {
     return new Response(JSON.stringify({ error: 'Case not found or access denied' }), {
       status: 403,
       headers: { ...corsHeaders, 'Content-Type': 'application/json' },
     });
   }
   ```

**Verification**:
- Read the modified file and confirm cases are re-fetched from DB with tenant_id filter
- The tenant_id comes from the authenticated user, not from the request body

**Double-Check**:
- Use `supabase` from auth context (which should now be anon-key client, not service-role — see T-002)
- If using anon-key client, RLS will automatically enforce tenant isolation
- If using service-role (for admin operations), add explicit `eq('tenant_id', tenantId)` check

---

## 2.4 Supabase: Critical Data Integrity Fixes

### T-029: Validate tenant_id and plan_id in create-checkout webhook
**Files**: `supabase/functions/payment-webhook/index.ts:111-131`
**Severity**: HIGH — Security
**Domain**: Security

**What to do**:
1. Read the checkout.session.completed handler
2. After extracting `tenant_id` and `plan_id` from Stripe metadata, validate:
   ```typescript
   // Verify tenant exists
   const { data: tenant } = await supabase
     .from('tenants')
     .select('id')
     .eq('id', tenant_id)
     .single();
   
   if (!tenant) {
     console.error(`Invalid tenant_id from checkout metadata: ${tenant_id}`);
     break; // or return error
   }
   
   // Verify plan exists
   const { data: plan } = await supabase
     .from('subscription_plans')
     .select('id')
     .eq('id', plan_id)
     .single();
   
   if (!plan) {
     console.error(`Invalid plan_id from checkout metadata: ${plan_id}`);
     break; // or return error
   }
   ```

**Verification**:
- Read the modified file and confirm both tenant and plan are validated before upserting subscription
- The validation must happen BEFORE the subscription upsert

**Double-Check**:
- These queries must use the service-role client since they run during webhook processing
- The service-role client bypasses RLS, so the `eq('id', ...)` filter is the only protection

---

### T-030: Add BRIN indexes for time-series tables
**Files**: `supabase/migrations/00017_missing_indexes.sql`
**Severity**: MEDIUM — Performance
**Domain**: Performance

**What to do**:
1. Create migration 00026:
   ```sql
   -- BRIN indexes for time-range queries on growing tables
   CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_brin 
     ON audit_logs USING BRIN (created_at);
   CREATE INDEX IF NOT EXISTS idx_ai_query_logs_created_at_brin 
     ON ai_query_logs USING BRIN (created_at);
   CREATE INDEX IF NOT EXISTS idx_ai_response_cache_expires_at_brin 
     ON ai_response_cache USING BRIN (expires_at);
   CREATE INDEX IF NOT EXISTS idx_case_entries_created_at_brin 
     ON case_entries USING BRIN (created_at);
   ```
2. Also add B-tree index on `expires_at` for the cache cleanup function:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_ai_response_cache_expires_at 
     ON ai_response_cache USING BTREE (expires_at);
   ```

**Verification**:
- Read the migration and confirm all indexes are created
- Verify the index names don't conflict with existing indexes

**Double-Check**:
- BRIN indexes are much smaller than B-tree for monotonically increasing values like `created_at`
- The cleanup function in 00018 does `DELETE FROM ai_response_cache WHERE expires_at <= NOW()` — needs an index on `expires_at`

---

### T-031: Add PHI CHECK constraint on case_entries
**Files**: `supabase/migrations/00007_enterprise_upgrade.sql`
**Severity**: MEDIUM — Compliance
**Domain**: Security

**What to do**:
1. Create migration 00027:
   ```sql
   -- When is_deidentified = true, patient_mrn and patient_dob MUST be NULL
   ALTER TABLE case_entries ADD CONSTRAINT deidentified_no_phi
     CHECK (NOT is_deidentified OR (patient_mrn IS NULL AND patient_dob IS NULL));
   ```

**Verification**:
- Run: `supabase db reset` and verify no errors with existing seed data
- Read the migration and confirm the check constraint logic

**Double-Check**:
- This constraint ensures that when a case is marked as de-identified, PHI columns are empty
- Existing de-identified records with PHI data will cause migration to fail — need to clean data first:
  ```sql
  UPDATE case_entries 
  SET patient_mrn = NULL, patient_dob = NULL 
  WHERE is_deidentified = true AND (patient_mrn IS NOT NULL OR patient_dob IS NOT NULL);
  ```

---

# PHASE 3: MEDIUM-SEVERITY HARDENING (Week 3-4)

> These issues affect code quality, design consistency, performance, and developer experience.

---

## 3.1 Web App: Design System & TypeScript

### T-032: Add strict TypeScript types for Supabase queries
**Files**: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx`, all page files with `as unknown as`
**Severity**: MEDIUM — Code Quality
**Domain**: Code

**What to do**:
1. Search for ALL `as unknown as` patterns across the web app
2. For each one, replace with proper typed Supabase queries:
   - Use `supabase.from('table').select('*').returns<YourType>()`
   - Add proper type assertions using the Zod schema validation
   - Example:
     ```typescript
     // Instead of:
     const data = await supabase.from('case_entries').select('*') as unknown as CaseEntry[];
     
     // Do:
     const { data } = await supabase
       .from('case_entries')
       .select('*')
       .returns<CaseEntry[]>();
     
     // Even better: validate with Zod
     const parsed = caseEntrySchema.array().safeParse(data);
     if (!parsed.success) { /* handle validation error */ }
     ```

**Verification**:
- Run: `pnpm --filter @elogbook/web typecheck` — must pass with STRICT mode
- Count number of `as unknown as` before and after — should decrease to 0

**Double-Check**:
- Removing `as unknown as` might reveal real type errors — fix the types, don't add new assertions
- If a Zod schema exists for the data, use `.parse()` or `.safeParse()` for runtime validation

---

### T-033: Fix tailwind.config.ts CJS require in ESM context
**Files**: `apps/web/tailwind.config.ts:2`
**Severity**: MEDIUM — Build
**Domain**: Code

**What to do**:
1. Read `tailwind.config.ts`
2. Replace `require('@elogbook/shared/design-tokens.config.js')` with an ESM import:
   ```typescript
   import { clinicalTokens } from '@elogbook/shared/src/constants/design-tokens';
   ```
3. Or keep the JS config file as a separate import and import it as default

**Verification**:
- Run: `pnpm build:web` — must succeed
- Run: `pnpm --filter @elogbook/web typecheck` — must pass

**Double-Check**:
- The `design-tokens.config.js` file exists for CommonJS compatibility
- For a TypeScript config file, ESM imports are preferred
- The Tailwind config currently uses `require()` which works but violates ESM conventions

---

### T-034: Add missing Tailwind v4 @config directives
**Files**: `apps/web/app/globals.css`, `apps/mobile/global.css`
**Severity**: HIGH — Build
**Domain**: UI

**What to do**:
1. Read web `globals.css` — if it uses `@import "tailwindcss"` without `@config`, add:
   ```css
   @import "tailwindcss";
   @config "../tailwind.config.ts";
   ```
2. Read mobile `global.css` — same:
   ```css
   @import "tailwindcss";
   @config "../tailwind.config.js";
   ```
3. If Tailwind v4 doesn't need explicit @config (auto-loads), document this decision

**Verification**:
- Run: `pnpm build:web` — must succeed with no Tailwind warnings
- Build output should correctly resolve all custom CSS classes

**Double-Check**:
- In Tailwind CSS v4, `tailwind.config.*` is NOT automatically loaded — `@config` directive is required
- If `@theme inline` block in globals.css is the primary token source, the config file may be redundant
- Choose one approach: either `@config` pointing to the config file, or remove the config and use `@theme inline` exclusively

---

### T-035: Add font-heading to @theme inline block
**Files**: `apps/web/app/globals.css:51-78`
**Severity**: MEDIUM — UI
**Domain**: UI

**What to do**:
1. Read the `@theme inline` block in globals.css
2. Add the missing font/heading mapping:
   ```css
   @theme inline {
     --font-sans: var(--font-body);
     --font-mono: var(--font-mono);
     --font-heading: var(--font-heading); /* ADD THIS */
   }
   ```
3. Also add missing shadow/transition tokens if they're used by components

**Verification**:
- Run: `pnpm build:web` — must succeed
- The `font-heading` Tailwind class should now work correctly

**Double-Check**:
- The CSS variable `--font-heading` is defined in the `:root` block (from `layout.tsx` font loading)
- The `@theme inline` mapping makes it available as the Tailwind class `font-heading`

---

## 3.2 Mobile App: UX & Performance

### T-036: Replace all hardcoded hex colors with clinical tokens
**Files**: `apps/mobile/app/(tabs)/*.tsx`, `apps/mobile/app/_layout.tsx`, `apps/mobile/app/login.tsx`
**Severity**: HIGH — UI
**Domain**: UI

**What to do**:
Search ALL mobile screen files for hardcoded hex values and replace:
1. `'#060814'` → `clinicalTokens.colors.backdrop.dark` or `bg-backdrop` NativeWind class
2. `'#0D9488'` → `clinicalTokens.colors.primary.DEFAULT` or `bg-primary`
3. `'#0F172A'` → `clinicalTokens.colors.neutral.dark` or `bg-neutral-dark`
4. `'#666'` (placeholder) → `clinicalTokens.colors.text.muted`
5. `'#F87171'` → `clinicalTokens.colors.danger.DEFAULT`
6. `'#94A3B8'` → `clinicalTokens.colors.text.muted`
7. `'#64748B'` → `clinicalTokens.colors.text.muted`
8. `'#FFFFFF'` → `clinicalTokens.colors.text.onPrimary`
9. All hardcoded hex values listed in the design system audit

For NativeWind users, prefer class-based tokens:
- `bg-slate-900` → `bg-neutral-dark` or `bg-panel`
- `text-gray-400` → `text-text-muted`
- `bg-teal-600` → `bg-primary`
- `bg-indigo-500` → `bg-secondary`
- `text-amber-400` → `text-warning` or `text-[var(--color-pending)]`
- `text-emerald-400` → `text-success` or `text-[var(--color-approved)]`
- `text-red-400` → `text-danger` or `text-[var(--color-rejected)]`
- `border-indigo-500/15` → `border-border-DEFAULT`

**Verification**:
- Run: `pnpm --filter @elogbook/mobile typecheck` — must pass
- Search for `'#` in mobile screens — count should drop significantly
- The app should look VISUALLY THE SAME (test on device or emulator)

**Double-Check**:
- In React Native, you cannot use Tailwind classes with inline `style={{ }}` for NativeWind — use NativeWind class-based styling
- For `placeholderTextColor`, you must use `clinicalTokens.colors.text.muted` directly (inline style)
- For SVG components (Ionicons), the `color` prop accepts inline colors — use `clinicalTokens.colors.text.muted`
- Do NOT use NativeWind `bg-opacity-50` — use clinical token colors with opacity

---

### T-037: Fix NetInfo null handling
**Files**: `apps/mobile/app/(tabs)/index.tsx:36`, `my-cases.tsx:83`, `case-detail.tsx:109`, `approvals.tsx:94`, `ai-insights.tsx:72`
**Severity**: MEDIUM — Code Quality
**Domain**: Code

**What to do**:
1. Search all files for `state.isConnected === false`
2. Replace with `state.isConnected !== true` (which handles `null` correctly)
   ```typescript
   // Instead of:
   if (state.isConnected === false) { /* offline */ }
   
   // Do:
   if (state.isConnected !== true) { /* offline or unknown */ }
   ```

**Verification**:
- Run: `pnpm --filter @elogbook/mobile typecheck` — must pass
- Check all 5 files are updated

**Double-Check**:
- `NetInfoState.isConnected` can be `null` when the network state is unknown (e.g., first load)
- The old code treated `null` as "connected" — the new code treats `null` as "disconnected" (safer for a medical app)

---

### T-038: Fix sync gt(updated_at) to gte — prevent missed records
**Files**: `apps/mobile/lib/sync.ts:95`
**Severity**: HIGH — Sync
**Domain**: Sync

**What to do**:
1. Read `sync.ts` line 95
2. Change `.gt('updated_at', lastSync)` → `.gte('updated_at', lastSync)`
   ```typescript
   // Instead of:
   query = query.gt('updated_at', new Date(lastSync).toISOString());
   
   // Do:
   query = query.gte('updated_at', new Date(lastSync).toISOString());
   ```

**Verification**:
- Read the modified file and confirm `gte` is used instead of `gt`
- This ensures records updated at the exact same millisecond as the last sync are included

**Double-Check**:
- With `gt`, if a record is updated at exactly `T` and the last sync timestamp is also `T`, that record is missed
- With `gte`, it's included. The push phase will handle any deduplication.
- Apply the SAME fix to `pullTemplates()` and `pullGoals()` if they also use `gt`

---

### T-039: Batch WatermelonDB writes in sync operations
**Files**: `apps/mobile/lib/sync.ts:104-107,125-128,143-146`
**Severity**: MEDIUM — Performance
**Domain**: Sync

**What to do**:
1. Read the pull loops in sync.ts
2. Instead of calling `await upsert*()` for each row (serialized writes), batch them:
   ```typescript
   // Instead of per-row:
   for (const caseData of casesData) {
     await upsertCaseEntry(caseData);
   }
   
   // Do batch:
   await db.write(async () => {
     const batch = casesData.map(caseData => {
       const record = collection.prepareCreate(entry => {
         // set all fields
       });
       return record;
     });
     await db.batch(...batch);
   });
   ```
3. Update `storage.ts` to expose `prepareCaseEntry()` functions for batching

**Verification**:
- Run: `pnpm --filter @elogbook/mobile typecheck` — must pass
- Read the modified sync.ts and confirm batching is used

**Double-Check**:
- WatermelonDB's `batch()` is MUCH faster than individual `create()` calls
- For each batch, use `prepareCreate`/`prepareUpdate` then single `batch()` call
- Keep batch size reasonable (e.g., 100 records max per batch)

---

### T-040: Add WatermelonDB Q.where() queries (stop fetching ALL rows)
**Files**: `apps/mobile/lib/db/storage.ts:52-53,58-61,92-95,100-104,108,156,188`
**Severity**: HIGH — Performance
**Domain**: Code

**What to do**:
1. Read ALL query functions in `storage.ts`
2. Replace `.query().fetch().filter(...)` with `Q.where()`:
   ```typescript
   // Instead of:
   const all = await db.get<CaseEntry>('case_entries').query().fetch();
   const filtered = all.filter(e => e.localSyncStatus === 'draft');
   
   // Do:
   const filtered = await db.get<CaseEntry>('case_entries')
     .query(Q.where('local_sync_status', 'draft'))
     .fetch();
   ```
3. Use `Q.oneOf()` for multiple values:
   ```typescript
   .query(Q.where('local_sync_status', Q.oneOf(['draft', 'modified', 'created'])))
   .fetch();
   ```
4. Use `Q.and()` for compound conditions:
   ```typescript
   .query(
     Q.and(
       Q.where('resident_id', userId),
       Q.where('local_sync_status', Q.oneOf(['draft', 'modified', 'conflict'])),
     )
   ).fetch();
   ```

**Verification**:
- Run: `pnpm --filter @elogbook/mobile typecheck` — must pass
- Check that `.filter()` calls are replaced with `Q.where()` in all storage functions

**Double-Check**:
- WatermelonDB `Q.where()` uses column names as defined in the SCHEMA, not the model properties
- The schema column names use `snake_case` (e.g., `local_sync_status`), not `camelCase` (`localSyncStatus`)
- Check `schema.ts` for exact column names

---

### T-041: Add initSync re-entrance guard
**Files**: `apps/mobile/lib/sync.ts:264-293`
**Severity**: MEDIUM — Sync
**Domain**: Sync

**What to do**:
1. Read the `initSync()` method
2. Add a private boolean to prevent concurrent sync:
   ```typescript
   private syncing = false;
   
   async initSync(): Promise<void> {
     if (this.syncing) {
       console.log('Sync already in progress, skipping');
       return;
     }
     
     this.syncing = true;
     try {
       // ... existing sync logic ...
     } catch (error) {
       console.error('Sync failed:', error);
       throw error;
     } finally {
       this.syncing = false;
     }
   }
   ```

**Verification**:
- Read the modified sync.ts and confirm the re-entrance guard
- The `syncing` flag must be set to `true` at the START and `false` in `finally`

**Double-Check**:
- The `finally` block ensures the guard is released even if sync throws
- Without the guard, periodic timer + app foreground could trigger concurrent syncs

---

### T-042: Add max retry limit to sync service
**Files**: `apps/mobile/lib/sync.ts:290-293`
**Severity**: MEDIUM — Sync
**Domain**: Sync

**What to do**:
1. Read the retry logic
2. Add a maximum retry count:
   ```typescript
   private retryCount = 0;
   private readonly MAX_RETRIES = 10;
   
   // In the retry logic:
   if (this.retryCount >= this.MAX_RETRIES) {
     console.error('Sync failed after max retries. Stopping automatic retry.');
     this.setStatus('error');
     this.retryCount = 0; // Reset for next session
     return;
   }
   this.retryCount++;
   ```

**Verification**:
- Read the modified file and confirm max retries is enforced
- After max retries, the sync should stop (not retry forever)

**Double-Check**:
- The current code caps `retryIndex` at 3 (300s delay) and retries indefinitely
- Add a separate `retryCount` for total retry limit
- After max retries, notify the user that manual intervention is needed

---

## 3.3 Shared Package: Type & Schema Alignment

### T-043: Add missing TypeScript types for DB tables
**Files**: `packages/shared/src/types/database.ts`
**Severity**: HIGH — Code Quality
**Domain**: Code

**What to do**:
Add TypeScript interfaces for ALL missing DB tables:
```typescript
export interface Subscription {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing';
  current_period_start: string | null;
  current_period_end: string | null;
  gateway_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  tenant_id: string;
  amount: number;
  currency: string;
  status: string;
  stripe_event_id: string | null;
  created_at: string;
}

export interface OneTimePurchase {
  id: string;
  resident_id: string;
  purchase_type: string;
  amount: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  created_at: string;
}
```

Also add missing fields to existing types:
1. `Institution.tier`: `'free' | 'premium' | 'enterprise' | string`
2. `SubscriptionPlan.stripe_price_id`: `string | null`
3. All `deleted_at` fields to `Profile`, `Tenant`, `CaseEntry`, `CaseTemplate`
4. `CaseEntry.patient_hash`: `string | null`
5. `CaseEntry.is_deidentified`: `boolean`
6. `ResidentAIToggle.quota_used`: `number`

**Verification**:
- Run: `pnpm --filter @elogbook/shared typecheck` — must pass
- Run: `pnpm --filter @elogbook/web typecheck` — must pass (depends on shared)

**Double-Check**:
- Cross-reference with `supabase/migrations/00001_schema.sql` for exact column names and types
- The shared types MUST match the DB schema exactly — mismatches cause silent runtime errors

---

### T-044: Fix Zod schemas to match DB constraints
**Files**: `packages/shared/src/schemas/cases.ts`, `auth.ts`, `subscriptions.ts`
**Severity**: HIGH — Code Quality
**Domain**: Code

**What to do**:
1. Read ALL Zod schemas and compare with DB schema
2. Fix `caseEntryIdentifiedSchema.patient_mrn` — should be nullable (since 00007):
   ```typescript
   patient_mrn: z.string().max(50).nullable(),
   ```
3. Fix `caseEntryIdentifiedSchema.patient_dob` — should be nullable:
   ```typescript
   patient_dob: z.string().nullable(),
   ```
4. Add `tenant_id` to `accreditationFrameworkSchema`:
   ```typescript
   export const accreditationFrameworkSchema = z.object({
     name: z.string().min(1).max(100),
     tenant_id: z.string().uuid(),
     description: z.string().max(500).optional(),
     // ...
   });
   ```
5. Add `quota_used` to `aiQuerySchema` or `residentAiToggleSchema`
6. All schemas should use `.max()` constraints matching DB CHECK constraints
7. Add `stripe_price_id` to `subscriptionPlanSchema`

**Verification**:
- Run: `pnpm --filter @elogbook/shared typecheck` — must pass
- Run: `pnpm --filter @elogbook/web typecheck` — must pass

**Double-Check**:
- The Zod schemas should be the AUTHORITATIVE validation layer
- They must be at least as strict as the DB constraints (preferably stricter for better error messages)
- Add `.describe()` annotations for better error messages

---

### T-045: Fix platform component inconsistencies
**Files**: `packages/shared/src/components/ProgressRing.*.tsx`, `ClinicalText.*.tsx`, `StatusBadge.*.tsx`
**Severity**: MEDIUM — UI
**Domain**: UI

**What to do**:
1. Align ProgressRing default props:
   - Both `.web.tsx` and `.native.tsx` should use the same defaults: `size = 120`, `strokeWidth = 8`
   - Update the web version to match the native version
2. Align ClinicalText font sizes:
   ```typescript
   // Use the SAME values on both platforms:
   const sizeMap = {
     xs: 11,  // was 12 on web
     sm: 13,  // was 14 on web
     md: 15,  // was 16 on web
     lg: 17,  // was 18 on web
     xl: 20,  // was 20 on web (same)
   };
   ```
3. Align StatusBadge border colors:
   - Both platforms should use `rgba(color, 0.3)` for borders

**Verification**:
- Run: `pnpm --filter @elogbook/shared typecheck` — must pass
- Run: `pnpm --filter @elogbook/web typecheck` and `pnpm --filter @elogbook/mobile typecheck`

**Double-Check**:
- Changing default values could break existing consumers that rely on current defaults
- Check ALL files that use ProgressRing, ClinicalText, StatusBadge to ensure they render correctly
- The visual change should be subtle — the goal is CONSISTENCY, not visual redesign

---

### T-046: Fix shared package dependencies (move to proper dep type)
**Files**: `packages/shared/package.json`
**Severity**: MEDIUM — Build
**Domain**: Code

**What to do**:
1. Read `package.json`
2. Move runtime dependencies from `devDependencies` to `dependencies` or `peerDependencies`:
   - `framer-motion` → `peerDependencies` (web consumers need it)
   - `react-native-svg` → `peerDependencies` (native consumers need it)
   - `@react-native-community/blur` → `peerDependencies`
3. Fix the React Native version to match the mobile app:
   - `react-native` → `^0.85.0` (currently `^0.74.0` which is very outdated)
4. Fix `@types/react-native` similarly

**Verification**:
- Run: `pnpm install` — must succeed without warnings
- `pnpm --filter @elogbook/shared typecheck` — must pass

**Double-Check**:
- `peerDependencies` means consumers must have the dep installed themselves
- This is the correct pattern for a shared library package
- The version range should be broad enough to allow flexibility but narrow enough to avoid API mismatches

---

## 3.4 Web App: Code Quality Medium Issues

### T-047: Fix duplicate query condition in dashboard page
**Files**: `apps/web/app/(authenticated)/[tenant]/dashboard/page.tsx:57-58`
**Severity**: MEDIUM — Code Quality
**Domain**: Code

**What to do**:
1. Read the case_entries query in dashboard/page.tsx
2. The query adds `.eq('tenant_id', tenantId)` on line 57, then conditionally adds it again on line 58 for non-residents
3. Remove the duplicate from the conditional branch:
   ```typescript
   let query = supabase.from('case_entries')
     .select(/* ... */)
     .eq('tenant_id', tenantId) // always filter by tenant
     .order('created_at', { ascending: false })
     .limit(100);
   
   if (role === 'resident') {
     query = query.eq('resident_id', userId); // only add resident filter, NOT tenant_id again
   }
   ```

**Verification**:
- Run: `pnpm --filter @elogbook/web typecheck` — must pass
- Read the code and confirm the tenant_id filter is only applied once

**Double-Check**:
- The tenant_id filter is essential for multi-tenant isolation — don't remove it
- The resident_id filter is additional, not a replacement

---

### T-048: Replace unnecessary allEntries fetch with count query
**Files**: `apps/web/components/approvals/useApprovalsData.ts:63-66`
**Severity**: MEDIUM — Performance
**Domain**: Performance

**What to do**:
1. Read the query that fetches ALL entries to compute approval rate
2. Replace with a count query:
   ```typescript
   // Instead of fetching all entries:
   const { data: allEntries } = await supabase
     .from('case_entries')
     .select('id, status');
   
   // Do count query:
   const { count: totalCases, error: countError } = await supabase
     .from('case_entries')
     .select('id', { count: 'exact', head: true })
     .eq('tenant_id', tenantId);
   
   const { count: approvedCases } = await supabase
     .from('case_entries')
     .select('id', { count: 'exact', head: true })
     .eq('tenant_id', tenantId)
     .eq('status', 'approved');
   
   const approvalRate = totalCases > 0 ? Math.round((approvedCases / totalCases) * 100) : 0;
   ```

**Verification**:
- Run: `pnpm --filter @elogbook/web typecheck` — must pass
- Read the code and confirm `head: true` is used (this tells Supabase to only return the count, not the data)

**Double-Check**:
- Using `head: true` with `count: 'exact'` is MUCH faster than fetching all rows
- The `head: true` option executes the query but doesn't return the rows — only the count

---

### T-049: Fix date comparisons to use UTC
**Files**: `apps/web/components/ApprovalsDashboard.tsx:212`, `apps/web/components/approvals/useApprovalsData.ts:135`
**Severity**: MEDIUM — Code Quality
**Domain**: Code

**What to do**:
1. Find all date comparison logic that uses `new Date().toDateString()`
2. Replace with UTC-based comparisons:
   ```typescript
   // Instead of:
   new Date(e.case_date).toDateString() === new Date().toDateString()
   
   // Do:
   const todayUTC = new Date().toISOString().split('T')[0];
   const caseDateUTC = new Date(e.case_date).toISOString().split('T')[0];
   caseDateUTC === todayUTC
   ```
3. Apply the same fix to ALL date comparisons in the web app

**Verification**:
- Run: `pnpm --filter @elogbook/web typecheck` — must pass
- Search for `toDateString()` and `getTimezoneOffset` in the web app and ensure none remain for date logic

**Double-Check**:
- Using local timezone for date comparisons means:
  - A case created at 11 PM UTC on June 1 shows as June 2 in UTC+3
  - The "today" comparison fails for cases created late at night
- Always use UTC for date comparisons in clinical applications

---

### T-050: Add cleanup for async operations on unmount
**Files**: `apps/web/components/CaseForm.tsx`, `apps/web/components/ApprovalsDashboard.tsx`, `apps/mobile/app/(tabs)/log-case.tsx`, etc.
**Severity**: MEDIUM — Code Quality
**Domain**: Code

**What to do**:
1. Search for all components with async state updates that could fire after unmount
2. Add a mounted guard pattern:
   ```typescript
   import { useCallback, useEffect, useRef } from 'react';
   
   function MyComponent() {
     const mountedRef = useRef(true);
     
     useEffect(() => {
       return () => { mountedRef.current = false; };
     }, []);
     
     const handleAsync = useCallback(async () => {
       const result = await someAsyncCall();
       if (mountedRef.current) {
         setState(result);
       }
     }, []);
   }
   ```

**Verification**:
- Run: `pnpm --filter @elogbook/web typecheck` — must pass
- Run: `pnpm --filter @elogbook/mobile typecheck` — must pass

**Double-Check**:
- React 18+ strict mode double-invokes effects in development — this is normal
- The mounted guard prevents `setState` on unmounted components but doesn't cancel the async operation itself
- For actual cancellation, use `AbortController`

---

# PHASE 4: BUILD, CI/CD, TESTING & DEPLOYMENT (Week 4-5)

> These are infrastructure issues that must be resolved for any professional deployment.

---

## 4.1 Testing Infrastructure

### T-051: Install and configure test frameworks
**Severity**: CRITICAL — Process
**Domain**: Code

**What to do**:
1. Add test dependencies to root package.json:
   ```bash
   pnpm add -D -w vitest @vitest/coverage-v8
   pnpm add -D -w @testing-library/react @testing-library/jest-dom
   pnpm add -D -w @testing-library/react-native
   ```
2. Create `vitest.config.ts` at root:
   ```typescript
   import { defineConfig } from 'vitest/config';
   
   export default defineConfig({
     test: {
       globals: true,
       environment: 'node',
       coverage: {
         provider: 'v8',
         reporter: ['text', 'json', 'html'],
         exclude: ['**/node_modules/**', '**/dist/**'],
       },
     },
   });
   ```
3. Add test scripts to root package.json:
   ```json
   "test": "vitest run",
   "test:watch": "vitest",
   "test:coverage": "vitest run --coverage"
   ```
4. Create `apps/web/vitest.config.ts` for React component tests:
   ```typescript
   import { defineConfig } from 'vitest/config';
   
   export default defineConfig({
     test: {
       environment: 'jsdom',
       setupFiles: ['./test-setup.ts'],
       globals: true,
     },
   });
   ```

**Verification**:
- Run: `pnpm test` — should show "No test files found" (no error, just a message)
- Run: `pnpm test:coverage` — should succeed

**Double-Check**:
- Install `jsdom` for web component tests: `pnpm add -D -w jsdom`
- The `test-setup.ts` file should import `@testing-library/jest-dom`

---

### T-052: Add unit tests for Zod schemas
**Files**: `packages/shared/src/schemas/*.ts`
**Severity**: HIGH — Process
**Domain**: Code

**What to do**:
1. Create `packages/shared/src/schemas/__tests__/cases.test.ts`:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { caseEntrySchema, caseEntryIdentifiedSchema, caseEntryDeidentifiedSchema } from '../cases';
   
   describe('caseEntrySchema', () => {
     it('should validate a complete identified case', () => {
       const data = {
         patient_mrn: 'MRN12345',
         patient_dob: '1990-01-15',
         // ... all required fields
       };
       const result = caseEntrySchema.safeParse(data);
       expect(result.success).toBe(true);
     });
     
     it('should reject future dates', () => {
       // ... test logic
     });
     
     it('should reject empty MRN for identified cases', () => {
       // ... test logic
     });
   });
   ```

**Verification**:
- Run: `pnpm --filter @elogbook/shared test` — all tests should pass
- Tests should cover: happy path, validation errors, edge cases (empty, null, wrong types)

**Double-Check**:
- Tests must be deterministic (no random data, no dependency on external state)
- Following testing library: prefer `.safeParse()` over `.parse()` to avoid try/catch in tests
- Cover all schemas: `cases.ts`, `auth.ts`, `subscriptions.ts`

---

### T-053: Add RLS policy tests
**Files**: `supabase/migrations/00002_rls_policies.sql`
**Severity**: HIGH — Security
**Domain**: Security

**What to do**:
1. Create `supabase/tests/rls-policies.sql`:
   ```sql
   -- Test: resident can only see own case_entries
   BEGIN;
   -- Set local context to simulate resident
   -- INSERT into case_entries as resident
   -- Attempt to SELECT as different user
   -- Verify error is thrown
   ROLLBACK;
   ```
2. Test key policies:
   - Resident sees only own cases
   - Supervisor sees all tenant cases
   - Resident cannot modify submitted cases
   - Only admin can read ai_config
   - Deleted records are excluded from SELECT
3. Run with: `supabase db test`

**Verification**:
- All policy tests pass without errors
- Each policy has at least one positive test (should succeed) and one negative test (should fail)

**Double-Check**:
- Supabase provides `supabase db test` for running SQL tests
- Tests should simulate different JWT claims using `set_config('request.jwt.claims', ...)`
- Test file structure in `supabase/tests/` directory

---

## 4.2 CI/CD Pipeline

### T-054: Create GitHub Actions CI workflow
**Files**: `.github/workflows/ci.yml`
**Severity**: CRITICAL — Process
**Domain**: Code

**What to do**:
1. Create `.github/` directory and workflow file:
   ```yaml
   name: CI
   on:
     push:
       branches: [main, develop]
     pull_request:
       branches: [main]
   
   jobs:
     typecheck:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v3
         - uses: actions/setup-node@v4
           with:
             node-version: 20
             cache: 'pnpm'
         - run: pnpm install --frozen-lockfile
         - run: pnpm --filter @elogbook/shared typecheck
         - run: pnpm --filter @elogbook/web typecheck
         - run: pnpm --filter @elogbook/mobile typecheck
   
     lint:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v3
         - uses: actions/setup-node@v4
           with:
             node-version: 20
             cache: 'pnpm'
         - run: pnpm install --frozen-lockfile
         - run: pnpm --filter @elogbook/web lint
         - run: pnpm --filter @elogbook/mobile lint
   
     test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v3
         - uses: actions/setup-node@v4
           with:
             node-version: 20
             cache: 'pnpm'
         - run: pnpm install --frozen-lockfile
         - run: pnpm test
   
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v3
         - uses: actions/setup-node@v4
           with:
             node-version: 20
             cache: 'pnpm'
         - run: pnpm install --frozen-lockfile
         - run: pnpm build:web
   ```

**Verification**:
- Push to a branch and verify the workflow runs
- All checks must pass (typecheck, lint, test, build)

**Double-Check**:
- Node.js version must be 20+ (as specified in PROJECT_ANALYSIS.md)
- `pnpm-lock.yaml` must be committed for `--frozen-lockfile` to work
- Add status badges to README

---

### T-055: Create Dockerfile for web app
**Files**: `Dockerfile`
**Severity**: HIGH — Infrastructure
**Domain**: Code

**What to do**:
1. Create `Dockerfile` at project root:
   ```dockerfile
   FROM node:20-alpine AS base
   RUN npm install -g pnpm@latest
   
   FROM base AS deps
   WORKDIR /app
   COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
   COPY apps/web/package.json ./apps/web/
   COPY apps/mobile/package.json ./apps/mobile/
   COPY packages/shared/package.json ./packages/shared/
   RUN pnpm install --frozen-lockfile
   
   FROM base AS builder
   WORKDIR /app
   COPY --from=deps /app/node_modules ./node_modules
   COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
   COPY . .
   RUN pnpm build:web
   
   FROM base AS runner
   WORKDIR /app
   ENV NODE_ENV production
   COPY --from=builder /app/apps/web/.next/standalone ./
   COPY --from=builder /app/apps/web/public ./apps/web/public
   EXPOSE 3000
   CMD ["node", "apps/web/server.js"]
   ```

**Verification**:
- Run: `docker build -t elogbook-web .` — must succeed
- Run: `docker run -p 3000:3000 elogbook-web` — app must respond at localhost:3000

**Double-Check**:
- The Dockerfile uses `output: 'standalone'` in next.config.js — verify this is set (T-056)
- If standalone is not set, the COPY paths will be wrong

---

### T-056: Add Next.js standalone output and other config
**Files**: `apps/web/next.config.js`
**Severity**: MEDIUM — Infrastructure
**Domain**: Code

**What to do**:
1. Read `next.config.js`
2. Add `output: 'standalone'` for Docker support:
   ```javascript
   module.exports = {
     output: 'standalone',
     // ... existing config
   };
   ```
3. Add compression and security headers:
   ```javascript
   poweredByHeader: false,
   compress: true,
   ```

**Verification**:
- Run: `pnpm build:web` — must succeed and create `.next/standalone/`
- Verify standalone output structure

**Double-Check**:
- `output: 'standalone'` creates a minimal production build that can run with just `node server.js`
- This is REQUIRED for Docker deployments
- The `node_modules` needed are copied into the standalone output

---

## 4.3 ESLint Hardening

### T-057: Re-enable strict ESLint rules
**Files**: `apps/web/eslint.config.mjs`, `apps/mobile/eslint.config.mjs`
**Severity**: HIGH — Code Quality
**Domain**: Code

**What to do**:
1. Read the ESLint config files
2. Remove the rules that disable important checks:
   ```javascript
   // REMOVE these lines:
   '@typescript-eslint/no-explicit-any': 'off',
   '@typescript-eslint/no-unused-vars': 'off',
   '@typescript-eslint/no-require-imports': 'off',
   '@typescript-eslint/no-empty-object-type': 'off',
   'react-hooks/exhaustive-deps': 'off',
   ```
3. Instead, set them to `'warn'` initially (to allow incremental fixes):
   ```javascript
   '@typescript-eslint/no-explicit-any': 'warn',
   '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
   '@typescript-eslint/no-require-imports': 'warn',
   'react-hooks/exhaustive-deps': 'warn',
   ```

**Verification**:
- Run: `pnpm --filter @elogbook/web lint` — should show warnings but not errors
- Fix all warnings iteratively until they can be raised to `'error'`

**Double-Check**:
- Setting rules to `'warn'` first prevents blocking the build while allowing incremental improvement
- After fixing all warnings, change to `'error'`
- `argsIgnorePattern: '^_'` allows unused function parameters prefixed with underscore (common convention)

---

## 4.4 Supabase Config Hardening

### T-058: Complete Supabase config.toml
**Files**: `supabase/config.toml`
**Severity**: HIGH — Infrastructure
**Domain**: Security

**What to do**:
Fill in ALL missing sections:
```toml
[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:8081/*"]
jwt_expiry = 3600
enable_signup = true

[auth.email]
enable_confirmations = false
enable_autoconfirm = true

[auth.sessions]
timebox = false
inactivity_timeout = 86400  # 24 hours

[auth.rate_limit]
token_refresh = 30
signup = 5
login = 10

[api]
enabled = true
port = 54321
schemas = ["public", "storage", "graphql_public"]
extra_search_path = ["public"]

[edge_runtime]
enabled = true
policy = "per_worker"

[analytics]
enabled = false

[storage]
enabled = true
file_size_limit = "20MB"

[functions]
enabled = true
verify_jwt = true
import_map = "./import_map.json"
```

**Verification**:
- Run: `supabase start` — must succeed with no config errors
- Verify the config is properly parsed

**Double-Check**:
- The `verify_jwt = true` setting enables JWT verification for all edge functions
- This is a second layer of protection (in addition to the `authenticate()` function in each edge function)
- For webhook endpoints (payment-webhook), set `verify_jwt = false` and handle auth in the function

---

## 4.5 Expo & Mobile Config Hardening

### T-059: Fix app.json for production deployment
**Files**: `apps/mobile/app.json`
**Severity**: CRITICAL — Infrastructure
**Domain**: Code

**What to do**:
1. Read `app.json` — it has empty `supabaseUrl` and `supabaseAnonKey` and missing Android config
2. Add proper configuration:
   ```json
   {
     "expo": {
       "name": "E-Logbook",
       "slug": "elogbook",
       "version": "1.0.0",
       "orientation": "portrait",
       "icon": "./assets/icon.png",
       "userInterfaceStyle": "dark",
       "splash": {
         "image": "./assets/splash.png",
         "resizeMode": "contain",
         "backgroundColor": "#060814"
       },
       "ios": {
         "supportsTablet": true,
         "bundleIdentifier": "com.elogbook.app",
         "infoPlist": {
           "NSCameraUsageDescription": "Camera is used to attach photos to case entries",
           "NSPhotoLibraryUsageDescription": "Photo library access is used to attach images to case entries"
         }
       },
       "android": {
         "adaptiveIcon": {
           "foregroundImage": "./assets/adaptive-icon.png",
           "backgroundColor": "#060814"
         },
         "package": "com.elogbook.app",
         "permissions": [
           "CAMERA",
           "READ_EXTERNAL_STORAGE",
           "WRITE_EXTERNAL_STORAGE"
         ]
       },
       "plugins": [
         "expo-router",
         "expo-secure-store",
         [
           "expo-camera",
           {
             "cameraPermission": "Camera is used to attach photos to case entries"
           }
         ],
         [
           "expo-image-picker",
           {
             "photosPermission": "Photo library access is used to attach images to case entries"
           }
         ],
         "expo-notifications",
         "expo-haptics"
       ],
       "extra": {
          "supabaseUrl": "<SUPABASE_PROJECT_ID>.supabase.co",
          "supabaseAnonKey": "<SUPABASE_ANON_KEY>"
       },
       "runtimeVersion": {
         "policy": "appVersion"
       },
       "jsEngine": "hermes",
       "newArchEnabled": true
     }
   }
   ```
3. Also ensure the fallback in `lib/supabase.ts` works when these values are not set (for development)

**Verification**:
- Run: `pnpm --filter @elogbook/mobile typecheck` — must pass
- The app should launch on both iOS and Android simulators

**Double-Check**:
- The `supabaseUrl` and `supabaseAnonKey` in `extra` should match the `.env.local` values
- For production builds, these should come from environment variables, not hardcoded in app.json
- The `runtimeVersion` policy enables EAS Update OTA updates

---

# PHASE 5: LOW-SEVERITY POLISH & DOCUMENTATION (Week 5-6)

> These are refinements that improve code quality, developer experience, and maintainability.

---

## 5.1 Low-Severity Cleanup

### T-060: Replace Brand Name String Literals with Constant
**Files**: `apps/web/app/layout.tsx:11`, `apps/web/components/Sidebar.tsx:73`, `apps/web/app/page.tsx:2`
**Severity**: LOW — Code Quality
**Domain**: Code

**What to do**:
1. Create a constant in the shared package: `packages/shared/src/constants/app.ts`:
   ```typescript
   export const APP_NAME = 'E-Logbook';
   export const APP_VERSION = '1.0.0';
   ```
2. Replace all hardcoded `"E-Logbook"` strings with `APP_NAME`

**Verification**:
- Run: `pnpm --filter @elogbook/web typecheck` — must pass
- Search for `'E-Logbook'` and `"E-Logbook"` — should only find the constant definition

**Double-Check**:
- The constant should be the single source of truth for the app name
- This makes rebranding trivial in the future

---

### T-061: Document magic UUID constants
**Files**: `apps/web/components/CaseForm.tsx:19`, `apps/web/components/case-form/useCaseFormSubmission.ts:8`
**Severity**: LOW — Maintainability
**Domain**: Code

**What to do**:
1. Create a named constant in shared package:
   ```typescript
   // packages/shared/src/constants/app.ts (add to existing)
   /**
    * The UUID used for global/shared templates that are available across all tenants.
    * This is NOT a real tenant — it's a sentinel value for querying templates that
    * should be visible to all users regardless of tenant affiliation.
    * @see supabase/migrations/00005_seed_data.sql
    */
   export const GLOBAL_TENANT_ID = '00000000-0000-0000-0000-000000000000';
   ```
2. Replace all hardcoded `'00000000-0000-0000-0000-000000000000'` with `GLOBAL_TENANT_ID`
3. Add a comment explaining WHY this UUID is special

**Verification**:
- Run: `pnpm --filter @elogbook/web typecheck` — must pass
- Search for the magic UUID — should only find the constant definition

**Double-Check**:
- The comment should explain that this is intentionally a nil-UUID sentinel pattern
- Any new developer should understand that this is NOT a bug — it's a design pattern

---

### T-062: Remove unused imports (ProgressRing useEffect, etc.)
**Files**: Various files across web and mobile
**Severity**: LOW — Code Quality
**Domain**: Code

**What to do**:
1. Enable ESLint `no-unused-vars` as WARN (see T-057)
2. Fix all reported unused imports across the codebase
3. Common issues:
   - `useEffect` imported but unused in `apps/mobile/components/ProgressRing.tsx`
   - Various imports in dead code files

**Verification**:
- Run: `pnpm --filter @elogbook/web lint` — no unused import warnings
- Run: `pnpm --filter @elogbook/mobile lint` — no unused import warnings

**Double-Check**:
- Be careful not to remove imports that are used only for their side effects (rare in this codebase)
- Use the ESLint report to find all instances

---

## 5.2 Design Token Consolidation

### T-063: Create single source of truth for design tokens
**Files**: `packages/shared/src/constants/design-tokens.ts`, `packages/shared/design-tokens.config.js`
**Severity**: MEDIUM — Maintainability
**Domain**: UI

**What to do**:
1. The TypeScript file is the source of truth
2. Generate the `.config.js` file from the TypeScript source (or remove it if not needed)
3. If `design-tokens.config.js` is used by Tailwind config, either:
   - Update web and mobile Tailwind configs to import from the TS source (preferred)
   - Or add a build step that generates the JS file from TS
   ```bash
   # Add to root package.json:
   "build:tokens": "node -e \"require('fs').writeFileSync('packages/shared/design-tokens.config.js', 'module.exports = ' + JSON.stringify(require('./packages/shared/src/constants/design-tokens').clinicalTokens))\""
   ```

**Verification**:
- Both web and mobile builds succeed
- Tailwind custom classes still work after the change

**Double-Check**:
- The `.config.js` file is in CommonJS format for tools that don't support ESM
- If Tailwind v4 no longer needs it, the file can be removed entirely
- Verify which files actually import `design-tokens.config.js` before deciding

---

### T-064: Add light mode CSS variables
**Files**: `apps/web/app/globals.css`
**Severity**: LOW — UI
**Domain**: UI

**What to do**:
1. Add `@media (prefers-color-scheme: light)` block to globals.css:
   ```css
   @media (prefers-color-scheme: light) {
     :root {
       --color-backdrop: #F8FAFC;
       --color-neutral: #E2E8F0;
       --color-text-primary: #0F172A;
       --color-text-secondary: #334155;
       --color-text-muted: #64748B;
       /* ... other light mode overrides ... */
     }
   }
   ```
2. Or, if light mode is out of scope, remove the `light` token from `clinicalTokens` to avoid confusion

**Verification**:
- Toggle OS color scheme to light — the app should have a light background and dark text
- All content should remain readable

**Double-Check**:
- Light mode requires COMPLETE color token overrides — not just the backdrop
- Every component that works in dark mode must work in light mode
- If this is too much work, document that light mode is planned but not yet implemented, and remove the light tokens

---

## 5.3 Performance Optimization

### T-065: Add bundle analyzer
**Files**: `apps/web/next.config.js`
**Severity**: LOW — Performance
**Domain**: Performance

**What to do**:
1. Install: `pnpm add -D -w @next/bundle-analyzer`
2. Add to next.config.js:
   ```javascript
   const withBundleAnalyzer = require('@next/bundle-analyzer')({
     enabled: process.env.ANALYZE === 'true',
   });
   
   module.exports = withBundleAnalyzer({
     // ... existing config
   });
   ```
3. Add script to root package.json:
   ```json
   "analyze": "ANALYZE=true pnpm build:web"
   ```

**Verification**:
- Run: `pnpm analyze` — should generate bundle analysis in `.next/analyze/`

**Double-Check**:
- The bundle analyzer is only enabled when `ANALYZE=true` env var is set
- It should never run in CI or production builds

---

### T-066: Add memoization to frequently-rendered components
**Files**: Various components
**Severity**: MEDIUM — Performance
**Domain**: Performance

**What to do**:
1. Identify components that re-render frequently:
   - List items in FlatList/ScrollView (mobile)
   - Dashboard cards and stats
   - Sidebar navigation
2. Wrap with `React.memo()`:
   ```typescript
   export const CaseListItem = React.memo(function CaseListItem({ case: CaseEntry }) {
     // ... render
   });
   ```
3. Use `useMemo` for computed values:
   ```typescript
   const sortedCases = useMemo(() => {
     return [...cases].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
   }, [cases]);
   ```

**Verification**:
- Use React DevTools Profiler to verify reduced re-renders
- The app should feel more responsive, especially on lists

**Double-Check**:
- Don't memoize everything — only components that actually re-render unnecessarily
- Memoization has its own cost (memory + comparison)
- Focus on list items and dashboard components first

---

## 5.4 Documentation

### T-067: Update DESIGN.md with design system governance
**Files**: `DESIGN.md`, `PRODUCT.md`
**Severity**: MEDIUM — Process
**Domain**: Code

**What to do**:
1. Read the existing DESIGN.md
2. Add sections for:
   - Design token usage guidelines (when to use clinical tokens vs hardcoded values)
   - Component pattern documentation (.web.tsx / .native.tsx)
   - GlassPanel usage rules (only for transient overlays)
   - How to add new design tokens
   - How to verify design system compliance
3. Add a checklist for PRs:
   - [ ] No hardcoded hex colors
   - [ ] No Tailwind native palette colors (use clinical tokens)
   - [ ] Platform components are consistent (.web.tsx matches .native.tsx)
   - [ ] glass-panel only for transient overlays

**Verification**:
- Read the updated DESIGN.md — it should be clear and actionable
- The PR checklist should prevent design system drift

**Double-Check**:
- DESIGN.md should be the go-to reference for any frontend work
- Include examples of BAD patterns and GOOD patterns

---

# PHASE-LEVEL VERIFICATION CHECKLIST

After each phase completes, run these verification commands:

## Phase 1 Verification
```bash
# 1. Edge function auth fix
Read supabase/functions/_shared/auth.ts — confirm:
  - No user_metadata fallback
  - 403 on missing app_metadata
  - Anon-key client used instead of service-role

# 2. Database security fixes
Read supabase/migrations/00019 through 00027 — confirm:
  - Consent records RLS fixed (p.user_id = auth.uid())
  - All SECURITY DEFINER functions have SET search_path = ''
  - hash_patient_mrn is now STABLE
  - stripe_events table exists
  - subscriptions has UNIQUE(tenant_id)
  - rejected→draft transition allowed
  - quota_used column added with CHECK constraint

# 3. Offline sync fixes
Read apps/mobile/lib/db/storage.ts and apps/mobile/lib/sync.ts — confirm:
  - Pull does NOT overwrite local unsynced changes
  - WatermelonDB uses proper create pattern (not _raw.id override)
  - Conflict detection uses updated_at comparison RPC
  - Schema migration handler exists

# 4. Type check
pnpm --filter @elogbook/shared typecheck
pnpm --filter @elogbook/web typecheck
pnpm --filter @elogbook/mobile typecheck
```

## Phase 2 Verification
```bash
# 1. Dead code removed
Check git diff — confirm dead files are deleted

# 2. Stale closure fixed
Read CaseForm.tsx — confirm canProceed is useCallback'd

# 3. Error handling added
Read CaseForm.tsx — confirm hash RPC errors are caught
Read ApprovalActions.tsx — confirm errors are shown to user

# 4. Mobile fixes
Read StatusBadge.tsx — confirm no invalid rgba+hex concatenation
Read log-case.tsx — confirm setTimeout uses ref, not state
Read AuthContext.tsx — confirm it exists and is used by all screens

# 5. Edge function security fixes
Read _shared/auth.ts — confirm CORS exact match only
Read ai-insights/index.ts — confirm SSRF protection + rate limiting
Read generate-pdf/index.ts — confirm server-side case ownership check
Read payment-webhook/index.ts — confirm tenant/plan validation

# 6. Type check
pnpm --filter @elogbook/shared typecheck
pnpm --filter @elogbook/web typecheck
pnpm --filter @elogbook/mobile typecheck
```

## Phase 3 Verification
```bash
# 1. TypeScript strictness
grep -r "as unknown as" apps/web/ — should be 0 matches

# 2. Design tokens
grep -r "'#[0-9A-Fa-f]\{6\}'" apps/web/components/ — should be minimal
grep -r "'#[0-9A-Fa-f]\{6\}'" apps/mobile/app/ — should be minimal

# 3. Tailwind config
Read apps/web/app/globals.css — @config directive present (if needed)
Read apps/mobile/global.css — @config directive present (if needed)

# 4. Shared package alignment
grep -r "as any" packages/shared/src/components/ — should be 0 matches
Read ProgressRing defaults — should be same on both platforms
Read ClinicalText sizes — should be same on both platforms

# 5. Type check
pnpm --filter @elogbook/shared typecheck
pnpm --filter @elogbook/web typecheck
pnpm --filter @elogbook/mobile typecheck
```

## Phase 4 Verification
```bash
# 1. Test infrastructure
pnpm test — should run without errors

# 2. CI workflow
Read .github/workflows/ci.yml — confirm it exists and has all jobs

# 3. ESLint
pnpm --filter @elogbook/web lint — should show no errors (warnings acceptable)
pnpm --filter @elogbook/mobile lint — should show no errors (warnings acceptable)

# 4. Supabase config
Read supabase/config.toml — confirm all sections filled in

# 5. Mobile config
Read apps/mobile/app.json — confirm no empty config values, Android section present
```

## Phase 5 Verification
```bash
# 1. Code cleanup
grep -r "\"E-Logbook\"" apps/ — should only find constant definition
grep -r "00000000-0000-0000-0000-000000000000" apps/ — should only find constant

# 2. Design documentation
Read DESIGN.md — confirm token governance section exists

# 3. Type check
pnpm --filter @elogbook/shared typecheck
pnpm --filter @elogbook/web typecheck
pnpm --filter @elogbook/mobile typecheck
pnpm lint:all
```

## Final Production Readiness Checklist

Before marking the project as production-ready:

- [ ] All CRITICAL issues resolved (53 found in audit)
- [ ] All HIGH issues resolved or documented as accepted risk (59 found)
- [ ] 80%+ of MEDIUM issues resolved (54 of 68)
- [ ] All TypeScript strict mode violations fixed
- [ ] All ESLint rules set to ERROR (no warnings)
- [ ] CI pipeline passes on main branch
- [ ] Test coverage > 70% for shared package schemas
- [ ] RLS policy tests pass
- [ ] Docker build succeeds
- [ ] Mobile app builds on both iOS and Android
- [ ] No hardcoded secrets or API keys in source code
- [ ] Phased rollback plan exists for each migration
- [ ] Security audit sign-off obtained
- [ ] HIPAA compliance checklist completed

---

## Appendix: Common Mistakes Agents Make

### When modifying migrations
- **WRONG**: Editing existing migration files (breaks reset/reproducibility)
- **RIGHT**: Creating NEW incremental migration files with `CREATE OR REPLACE`

### When fixing TypeScript types
- **WRONG**: Adding `as any` to make the typecheck pass
- **RIGHT**: Correctly typing the data with the proper interface/schema

### When modifying WatermelonDB code
- **WRONG**: Accessing `_raw` properties directly (private API)
- **RIGHT**: Using `Q.where()` for queries, `create()` with proper patterns

### When fixing React hooks
- **WRONG**: Removing deps from useEffect without understanding the closure
- **RIGHT**: Using useCallback + adding the function to deps

### When fixing security issues
- **WRONG**: Adding console logs or error messages that expose internal state
- **RIGHT**: Returning sanitized errors to users, logging internally

### When verifying fixes
- **WRONG**: Running only the typecheck and declaring success
- **RIGHT**: Reading the modified file, running typecheck, AND testing the behavior

---

*End of Enterprise Transformation Plan*
