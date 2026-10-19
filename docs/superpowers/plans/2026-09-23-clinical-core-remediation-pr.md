# Clinical Core Remediation PR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the in-progress remediation set on `remediation/clinical-core-pr`, close the confirmed clinical-core blockers, verify the release gates, and open a GitHub PR that can be merged to `main`.

**Architecture:** Preserve the existing dirty remediation baseline. PostgreSQL remains authoritative for tenant, role, lifecycle, state transitions, and idempotency. Clinical mutations move behind security-definer command RPCs exposed through guarded route handlers; direct browser clinical writes are removed. Forward-only migrations and pgTAP negative tests prove the boundary before release promotion.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase Postgres/Auth/Storage, Deno Edge Functions, Zod, Vitest, pgTAP, pnpm, GitHub Actions, Docker/Caddy, existing `@elogbook/shared` and `@elogbook/ops` packages.

---

## Working rules

- The current branch is `remediation/clinical-core-pr`; the pre-existing working tree is intentional work and must be preserved.
- Never run `git reset`, `git clean`, `git checkout --`, a broad stash, or a revert of unrelated files.
- Stage only reviewed, verified files. Never stage `.env*`, credentials, generated reports, or evidence containing secrets/PHI.
- Do not commit a red baseline. Run verification before each commit and before push/merge.
- The exposed Supabase service-role credential is an external blocker. Rotation requires explicit operator approval and access.
- Database changes are new forward migrations. Applied migration files are not rewritten.

## File map

### Clinical command boundary

- `supabase/migrations/20260926000001_clinical_command_boundary.sql` — submit/decide commands, state-machine guards, policies, audit/outbox writes.
- `supabase/migrations/20260926000003_save_case_draft_command.sql` — draft creation command with required-field and data-mode enforcement.
- `supabase/tests/p1_32_clinical_command_boundary.sql` — command negative/idempotency suite.
- `supabase/tests/p1_34_save_case_draft_command.sql` — draft command suite.
- `apps/web/app/api/[tenant]/cases/[id]/submit/route.ts` — guarded submit route.
- `apps/web/app/api/[tenant]/cases/route.ts` — guarded draft route.
- `apps/web/app/api/[tenant]/approvals/action/route.ts` — AAL2 decision route.
- `apps/web/lib/cases/submit-flow.ts` — create-then-submit flow and command path builder.
- `apps/web/lib/cases/deidentified.ts` — de-identified payload projection.

### Client callers

- `apps/web/components/CaseForm.tsx`
- `apps/web/components/QuickAddCase.tsx`
- `apps/web/components/CasePreviewModal.tsx`
- `apps/web/components/ApprovalActions.tsx`
- `apps/web/components/approvals/ApprovalsDashboard.tsx`
- `apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts` — legacy direct writer.
- `apps/web/app/(authenticated)/[tenant]/cases/[id]/request-verification/route.ts` — legacy direct approval writer.

### Security, lifecycle, and release

- `apps/web/lib/supabase/security-context.ts`, `session-revocation.ts`
- `apps/web/lib/http/request-guard.ts`
- `apps/web/app/api/[tenant]/admin/users/[id]/action/route.ts`
- `supabase/migrations/20260923000001_legacy_rpc_and_grant_containment.sql` through `20260923000011_privileged_aal2.sql`
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/workflows/cd.yml`
- `scripts/verify-test-inventory.mjs`, `verify-release-containment.mjs`, `verify-secret-containment.mjs`, `verify-request-guards.mjs`, `verify-agent-boundaries.mjs`
- `docs/upgrade/evidence/clinical-core/`

---

### Task 0: Lock the baseline and reproduce the blockers

**Files:** Read the current tree; create `docs/upgrade/evidence/clinical-core/baseline.md` after commands run.

- [ ] **Step 1: Record the branch and inventory**

```powershell
git status --short --branch
git diff --stat
git diff --name-only
```

Expected: the current remediation files are present on `remediation/clinical-core-pr`; no destructive Git command has run.

- [ ] **Step 2: Run fast gates before editing**

```powershell
pnpm typecheck
node scripts/verify-test-inventory.mjs
node scripts/verify-release-containment.mjs
node scripts/verify-secret-containment.mjs
```

Expected: failures are explicit, static gates print only rule/path/fingerprint, and any secret finding stops the branch until rotation is recorded.

- [ ] **Step 3: Run focused red tests**

```powershell
pnpm --filter @elogbook/web test -- src/lib/cases/__tests__/submit-flow.test.ts src/lib/__tests__/clinical-command-boundary.test.ts
```

Expected: the known path/idempotency failures are recorded before production code changes.

- [ ] **Step 4: Write the baseline evidence**

Record commands, exit codes, failure names, commit SHA, and the external credential-rotation blocker. Do not include secret values, environment contents, or PHI.

---

### Task 1: Repair the command state machine and pgTAP contract

**Files:** `supabase/migrations/20260926000001_clinical_command_boundary.sql:395-475`; `supabase/tests/p1_32_clinical_command_boundary.sql:66-212`.

- [ ] **Step 1: Keep the failing resubmission test explicit**

The state machine forbids `rejected -> pending`; the command must legally perform `rejected -> draft -> pending` in one transaction. Preserve the assertion:

```sql
SELECT is(
  (SELECT public.submit_case_command(
    '00000000-0000-0000-0000-000000003244', 'p1-32-submit-1', 'rejected') ->> 'status'),
  'pending',
  'the submit command moves a rejected case to pending through the legal draft transition'
);
```

- [ ] **Step 2: Run the disposable database suite to verify red**

```powershell
supabase db reset
supabase db test supabase/tests/p1_32_clinical_command_boundary.sql
```

Expected before the fix: rejected-resubmission and replay assertions fail with a state/internal error.

- [ ] **Step 3: Implement the two-step transition**

Replace the single status update in the existing `<<work>>` block with:

```sql
IF v_case.status = 'rejected' THEN
  UPDATE public.case_entries
  SET status = 'draft', updated_at = NOW()
  WHERE id = v_case.id
    AND tenant_id = v_principal.tenant_id
    AND status = 'rejected';
END IF;

UPDATE public.case_entries
SET status = 'pending', updated_at = NOW()
WHERE id = v_case.id
  AND tenant_id = v_principal.tenant_id
  AND status = 'draft';
```

The row is already locked with `FOR UPDATE`; approval rows, audit, and outbox remain in the same transaction.

- [ ] **Step 4: Correct RLS negative assertions**

`USING` filters `UPDATE` rows and does not raise an exception. Replace synthetic `42501` expectations for filtered rows with state assertions:

```sql
SELECT is(
  (SELECT status FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000003241'),
  'pending',
  'an AAL1 direct approval does not change the case'
);
```

Keep `throws_ok` only where a row passes policy and a trigger/`WITH CHECK` raises. Assert resulting state after every denial.

- [ ] **Step 5: Run the suite to verify green**

```powershell
supabase db test supabase/tests/p1_32_clinical_command_boundary.sql
```

Expected: all assertions pass; replay creates no duplicate approval/outbox rows; no-reviewer submission remains a draft.

- [ ] **Step 6: Commit only the isolated fix**

```powershell
git add supabase/migrations/20260926000001_clinical_command_boundary.sql supabase/tests/p1_32_clinical_command_boundary.sql
git commit -m "fix(db): make clinical resubmission and command tests legal"
```

---

### Task 2: Fix the submit path and approval request IDs

**Files:** `apps/web/lib/cases/submit-flow.ts`; `CaseForm.tsx`; `QuickAddCase.tsx`; `ApprovalActions.tsx`; `CasePreviewModal.tsx`; `ApprovalsDashboard.tsx`; `submit-flow.test.ts`; new `command-path.test.ts`.

- [ ] **Step 1: Write the failing path test**

```ts
import { describe, expect, it } from 'vitest';
import { caseSubmitPath } from '../submit-flow';

describe('caseSubmitPath', () => {
  it('resolves the API route, not a tenant-prefixed page path', () => {
    expect(caseSubmitPath('acme', 'case-123')).toBe('/api/acme/cases/case-123/submit');
  });
});
```

Run `pnpm --filter @elogbook/web test -- src/lib/cases/__tests__/command-path.test.ts`; expect the missing export to fail.

- [ ] **Step 2: Add the path builder and use it everywhere**

```ts
export function caseSubmitPath(tenantSlug: string, caseId: string): string {
  return `/api/${tenantSlug}/cases/${caseId}/submit`;
}
```

Update `CaseForm` and `QuickAddCase` to call this builder. Strengthen the static test to assert the exact `/api/` prefix.

- [ ] **Step 3: Add request IDs to every approval caller**

Each caller generates a fresh idempotency key:

```ts
const requestId = crypto.randomUUID();
body: JSON.stringify({ action, entry_id: id, comment: null, request_id: requestId }),
```

Bulk approval must generate one key per case. Add a test that the three callers contain `request_id` and `crypto.randomUUID()`.

- [ ] **Step 4: Run focused tests and commit**

```powershell
pnpm --filter @elogbook/web test -- src/lib/cases/__tests__ src/components/approvals
git add apps/web/lib/cases apps/web/components/CaseForm.tsx apps/web/components/QuickAddCase.tsx apps/web/components/ApprovalActions.tsx apps/web/components/CasePreviewModal.tsx apps/web/components/approvals/ApprovalsDashboard.tsx
git commit -m "fix(web): route clinical submissions through the API command"
```

---

### Task 3: Remove dead direct clinical writers

**Files:** delete the legacy authenticated submit route and route test; remove or migrate `request-verification/route.ts`; add `apps/web/lib/__tests__/no-direct-clinical-writers.test.ts`.

- [ ] **Step 1: Write the failing static gate**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..', '..');
const routes = [
  'apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts',
  'apps/web/app/(authenticated)/[tenant]/cases/[id]/request-verification/route.ts',
];

describe('clinical writers', () => {
  it.each(routes)('%s does not write clinical state directly', (route) => {
    const source = readFileSync(resolve(root, route), 'utf8');
    expect(source).not.toMatch(/status:\s*'pending'/);
    expect(source).not.toMatch(/approval_requests[\s\S]*\.insert/);
  });
});
```

Run the focused test; expect failure while either legacy route remains.

- [ ] **Step 2: Delete the legacy submit route and its test**

The only submit handler is `apps/web/app/api/[tenant]/cases/[id]/submit/route.ts`.

- [ ] **Step 3: Remove the unowned verification writer**

The request-verification route writes approval rows directly and embeds a resident name in the comment. Remove the route and any caller until a separately designed verification command exists. Do not replace it with a browser insert.

- [ ] **Step 4: Verify and commit**

```powershell
pnpm --filter @elogbook/web test -- src/lib/__tests__/no-direct-clinical-writers.test.ts src/lib/cases/__tests__
git add -A "apps/web/app/(authenticated)/[tenant]/cases" apps/web/lib/__tests__/no-direct-clinical-writers.test.ts apps/web/lib/cases/__tests__
git commit -m "fix(web): remove legacy direct clinical state writers"
```

---

### Task 4: Add the missing `save_case_draft` command

**Files:** create `supabase/migrations/20260926000003_save_case_draft_command.sql`, `supabase/tests/p1_34_save_case_draft_command.sql`, `apps/web/app/api/[tenant]/cases/route.ts`, and its route test; modify `CaseForm.tsx`, `QuickAddCase.tsx`, `CaseImport.tsx` if it still directly inserts.

- [ ] **Step 1: Write failing database assertions**

Cover anonymous caller, cross-tenant template, missing required template field, identifiable payload under de-identified policy, valid de-identified draft, and replay of `(tenant, actor, command, request_id)`. Expected codes are `required_field_missing` (422), `policy_denied` (403), `state_conflict` (409), and `{ success: true, case_id, status: 'draft' }`.

- [ ] **Step 2: Verify the red state**

```powershell
supabase db test supabase/tests/p1_34_save_case_draft_command.sql
```

Expected: failure because `save_case_draft_command` does not exist.

- [ ] **Step 3: Implement the command**

Use this signature:

```sql
public.save_case_draft_command(p_request_id TEXT, p_payload JSONB) RETURNS JSONB
```

The function must load the authoritative active principal, accept only the approved payload keys, reject identifier columns in de-identified mode, load `case_templates.required_fields`, reject a cross-tenant template, insert `status = 'draft'`, write minimal audit/outbox rows, and record the idempotent result under `(tenant_id, actor_profile_id, 'save_case_draft', request_id)`.

- [ ] **Step 4: Verify the database suite**

```powershell
supabase db test supabase/tests/p1_32_clinical_command_boundary.sql supabase/tests/p1_34_save_case_draft_command.sql
```

- [ ] **Step 5: Implement the guarded route and migrate callers**

The route uses `guardRequest`, `getSecurityContext`, `checkRateLimit`, strict Zod parsing, and `supabase.rpc('save_case_draft_command', ...)`. `CaseForm`, `QuickAddCase`, and `CaseImport` call `/api/${tenantSlug}/cases` with a request ID and the de-identified payload from `deidentified.ts`.

- [ ] **Step 6: Run and commit**

```powershell
pnpm --filter @elogbook/web test -- src/app/api/[tenant]/cases src/lib/cases
supabase db test supabase/tests/p1_32_clinical_command_boundary.sql supabase/tests/p1_34_save_case_draft_command.sql
git add supabase/migrations/20260926000003_save_case_draft_command.sql supabase/tests/p1_34_save_case_draft_command.sql apps/web/app/api/[tenant]/cases apps/web/components/CaseForm.tsx apps/web/components/QuickAddCase.tsx apps/web/components/CaseImport.tsx apps/web/lib/cases
git commit -m "feat(clinical): enforce draft creation through a command"
```

---

### Task 5: Close error, lifecycle, and notification gaps

**Files:** `20260926000001_clinical_command_boundary.sql:541-634`; approval route; admin user-action route; `session-revocation.ts`; focused route tests.

- [ ] **Step 1: Add failing tests**

Assert AAL1 returns `403`, suspended profile returns `account_inactive`, suspended tenant returns `tenant_suspended`, and approval notifications use the resident's `profiles.user_id` rather than the profile UUID.

- [ ] **Step 2: Return stable codes from the database**

Replace the two `RAISE EXCEPTION 'forbidden'` blocks in `decide_case_command` with:

```sql
RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
```

Split principal failures into `account_inactive` and `tenant_suspended`; add `tenant_id = v_principal.tenant_id` and `FOR UPDATE` to the approval-request select.

- [ ] **Step 3: Map codes in the route**

Add `account_inactive: 403` and `tenant_suspended: 403` to status/message tables. Keep `internal_error` for unexpected RPC failures only.

- [ ] **Step 4: Revoke sessions on deactivation**

After `admin_set_profile_status` succeeds for `deactivate`, invalidate the target user's Supabase sessions through the service-role admin path. Log only opaque IDs and result category.

- [ ] **Step 5: Fix approval notification ownership**

Resolve `entry.resident_id` to `profiles.user_id` before inserting into `notifications`, or move the notification into the command outbox. Remove `.maybeSingle()` from an insert.

- [ ] **Step 6: Run and commit**

```powershell
pnpm --filter @elogbook/web test -- src/app/api/[tenant]/approvals src/app/api/[tenant]/admin/users
supabase db test supabase/tests/p1_32_clinical_command_boundary.sql
git add supabase/migrations/20260926000001_clinical_command_boundary.sql apps/web/app/api/[tenant]/approvals/action/route.ts apps/web/app/api/[tenant]/admin/users/[id]/action/route.ts apps/web/lib/supabase/session-revocation.ts
git commit -m "fix(security): align clinical errors and session lifecycle"
```

---

### Task 6: Add correlation logging and block static gates in CI

**Files:** submit and approval routes; `apps/web/lib/observability/correlation-id.ts`; `.github/workflows/ci.yml`; `.github/workflows/release.yml`; static gate scripts.

- [ ] **Step 1: Write a failing correlation test**

Assert a server-generated correlation ID is present in structured logs and a client `request_id` is never used as the correlation ID.

- [ ] **Step 2: Implement bounded logging**

Accept a validated `x-correlation-id` or generate a UUID. Log only command, opaque case ID, tenant ID, duration, result code, and correlation ID. Never log field values, rejection text, or provider responses.

- [ ] **Step 3: Register missing gates**

Run `verify-request-guards.mjs` and `verify-agent-boundaries.mjs` in a required CI job. No `continue-on-error` or environment bypass is allowed.

- [ ] **Step 4: Run and commit**

```powershell
node scripts/verify-request-guards.mjs
node scripts/verify-agent-boundaries.mjs
pnpm typecheck
pnpm lint:all
git add apps/web/app/api/[tenant]/cases apps/web/app/api/[tenant]/approvals apps/web/lib/observability .github/workflows/ci.yml .github/workflows/release.yml scripts/verify-request-guards.mjs scripts/verify-agent-boundaries.mjs
git commit -m "chore(release): block clinical and boundary gates"
```

---

### Task 7: Full verification, evidence, and PR promotion

**Files:** `docs/upgrade/evidence/clinical-core/verification.md`; `docs/superpowers/specs/2026-09-23-clinical-core-remediation-design.md`; existing workflow files.

- [ ] **Step 1: Run the complete local verification**

```powershell
pnpm typecheck
pnpm lint:all
pnpm test
pnpm build:web
node scripts/verify-test-inventory.mjs
node scripts/verify-release-containment.mjs
node scripts/verify-secret-containment.mjs
node scripts/verify-request-guards.mjs
node scripts/verify-agent-boundaries.mjs
```

Expected: every command exits 0. Record blocked Docker/Supabase/E2E checks as blocked, never as passes.

- [ ] **Step 2: Run database and container qualification**

On a disposable environment:

```powershell
supabase db reset
supabase db test
```

Build and boot the qualified Caddy/Next/Supabase profile and require `/api/ready` to return 200. If Docker is unavailable locally, record the exact prerequisite and require CI to run the gate.

- [ ] **Step 3: Run the non-skipped clinical journey**

Playwright must cover operator-provisioned tenant, invitation, resident draft, submit, supervisor approve/reject with reason, and director aggregate report. No dynamic skip is allowed for this flow.

- [ ] **Step 4: Review and commit the full remediation baseline**

```powershell
git status --short
git diff --check
git diff --cached --stat
git diff --cached --name-only
git commit -m "chore: add clinical core remediation baseline"
```

Only stage reviewed remediation files. Confirm no `.env*`, secret report, credential-bearing history file, or PHI is staged.

- [ ] **Step 5: Push and open the PR**

```powershell
git push -u origin remediation/clinical-core-pr
gh pr create --base main --head remediation/clinical-core-pr --title "Remediate clinical core security and workflow boundaries" --body-file docs/upgrade/evidence/clinical-core/pr-body.md
```

The PR body must state the blocked external credential rotation, exact test commands, rollback class, and residual risks. Do not merge while any required check is red or the exposed credential remains unrotated.

- [ ] **Step 6: Merge only after green CI and explicit approval**

```powershell
gh pr checks remediation/clinical-core-pr --watch
gh pr merge remediation/clinical-core-pr --squash --delete-branch
```

If checks fail, fix the cause on the same branch; do not bypass a gate. If the credential rotation or GitHub environment protection is unresolved, stop and report the blocker instead of merging.

## Plan self-review

- **Spec coverage:** Containment, database authorization, submit/decide/draft commands, direct-writer removal, lifecycle/error handling, observability, CI gates, and PR promotion map to Tasks 0–7.
- **Placeholder scan:** No unresolved markers or vague implementation steps are used; external blockers are explicit stop conditions.
- **Type consistency:** Command names, route paths, error codes, and idempotency keys are consistent across tasks.
- **Safety:** Every code change has a failing test/verification step; the dirty tree is preserved; no commit is pushed without a fresh verification command.
