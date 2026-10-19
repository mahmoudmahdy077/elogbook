# Enterprise Email Phase 3 — Authentication and Transactional Correctness Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair signup, confirmation, magic-link, recovery, invitation, contact, case-notification, and mobile email flows so every state transition and delivery response is truthful and secure.

**Architecture:** Supabase Auth/GoTrue remains the only token issuer. Server routes validate requests, rate-limit by IP and email HMAC, trigger official GoTrue delivery actions, and record sanitized intent. Critical case and invitation business transitions write outbox intent in the same database transaction.

**Tech Stack:** Next.js 16, Supabase Auth/SSR, PostgreSQL RPC, Expo Router, Zod 4, Vitest 4, Playwright, Mailpit.

---

## Files

**Create**

- `supabase/migrations/20260924000006_email_auth_intent.sql`
- `supabase/migrations/20260924000007_email_auth_transactional_rpcs.sql`
- `supabase/migrations/20260924000008_email_legacy_contract.sql`
- `supabase/tests/p1_28_email_auth_intent.sql`
- `supabase/tests/p1_29_email_auth_transactional.sql`
- `supabase/tests/p1_30_email_legacy_contract.sql`
- `apps/web/app/api/auth/signup/route.ts`
- `apps/web/app/api/auth/email/verify/route.ts`
- `apps/web/app/api/auth/email/magic-link/route.ts`
- `apps/web/app/api/auth/email/recovery/route.ts`
- `apps/web/app/api/auth/email/confirmation/route.ts`
- `apps/web/app/api/auth/invitation/accept/route.ts`
- `apps/web/app/api/auth/__tests__/auth-email.test.ts`
- `apps/web/app/auth/callback/__tests__/route.test.ts`
- `apps/web/app/update-password/page.tsx`
- `apps/web/app/update-password/UpdatePasswordForm.tsx`
- `apps/web/app/invite/accept/page.tsx`
- `apps/web/app/invite/accept/InviteAcceptForm.tsx`
- `apps/mobile/app/auth/confirm.tsx`
- `apps/mobile/app/auth/recovery.tsx`
- `apps/mobile/app/auth/update-password.tsx`
- `apps/mobile/lib/auth-links.ts`
- `apps/mobile/lib/__tests__/auth-links.test.ts`
- `apps/mobile/lib/__tests__/linking.test.ts`
- `apps/mobile/app/__tests__/auth-flow.test.ts`
- `apps/web/e2e/auth-email.spec.ts`
- `apps/web/e2e/tenant-invite.spec.ts`

**Modify**

- `apps/web/app/signup/SignupForm.tsx`
- `apps/web/app/signup/page.tsx`
- `apps/web/app/login/page.tsx`
- `apps/web/app/auth/callback/route.ts`
- `apps/web/app/api/[tenant]/admin/invite/route.ts`
- `apps/web/app/api/[tenant]/admin/users/[id]/action/route.ts`
- `apps/web/app/api/contact/route.ts`
- `apps/web/app/contact/page.tsx`
- `apps/web/app/api/[tenant]/approvals/action/route.ts`
- `apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.ts`
- `apps/web/components/InviteMentor.tsx`
- `apps/web/app/(authenticated)/[tenant]/invites/page.tsx`
- `apps/web/lib/rate-limit-redis.ts`
- `apps/web/lib/http/request-guard.ts`
- `apps/web/public/openapi.yaml`
- `apps/web/app/api/[tenant]/admin/users/__tests__/cross-tenant.test.ts`
- `apps/web/app/api/contact/__tests__/route.test.ts`
- `apps/web/app/(authenticated)/[tenant]/cases/[id]/submit/route.test.ts`
- `apps/web/app/api/[tenant]/approvals/action/__tests__/route.test.ts`
- `apps/mobile/app/login.tsx`
- `apps/mobile/lib/linking.ts`
- `apps/mobile/lib/route-guard.ts`
- `apps/mobile/lib/__tests__/route-guard.test.ts`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app.json`

## Task 1: Add auth-delivery intent and invitation lifecycle schema

- [ ] **Step 1: Write failing pgTAP tests**

Assert `email_auth_intents` records action, actor, target user, status, provider request ID, sanitized failure code, and timestamps without a token column. Assert `tenant_invites` has token hash, normalized HMAC, expiry, accepted timestamp, inviter, intended role, delivery version, and explicit failed/superseded statuses. Assert one active invitation per tenant/email HMAC.

- [ ] **Step 2: Run and confirm failure**

```powershell
supabase db test supabase/tests/p1_28_email_auth_intent.sql
```

Expected: FAIL.

- [ ] **Step 3: Create `20260924000006_email_auth_intent.sql`**

Create:

```sql
CREATE TABLE public.email_auth_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('signup_confirmation','confirmation_resend','magic_link','password_recovery','admin_password_recovery','tenant_invitation','tenant_invitation_resend')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('requested','accepted','failed','suppressed')),
  provider_request_id text,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Add invitation columns and a partial unique index on `(tenant_id, normalized_email_hmac)` where status is pending. Replace `handle_new_user()` so it consumes only validated invitation metadata/action state; matching an email to a pending invitation is not sufficient.

- [ ] **Step 4: Run pgTAP and migration lint**

```powershell
supabase db reset
supabase db test supabase/tests/p1_28_email_auth_intent.sql
node scripts/lint-migrations.mjs
```

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Confirm no authentication token column exists and invitation matching is not email-only. Do not commit.

## Task 2: Add transactional case and invite RPCs

- [ ] **Step 1: Write failing transactional pgTAP tests**

Prove:

- case submission and outbox intent commit or roll back together
- approval/rejection writes one outbox row
- repeated already-reviewed decision creates no second row
- invite consumption validates token hash, expiry, tenant, email HMAC, intended role, and active status
- consumed invite cannot be reused

- [ ] **Step 2: Run and confirm failure**

```powershell
supabase db test supabase/tests/p1_29_email_auth_transactional.sql
```

Expected: FAIL.

- [ ] **Step 3: Create `20260924000007_email_auth_transactional_rpcs.sql`**

Implement service-role-only RPCs:

```sql
submit_case_for_review(p_actor_id uuid, p_entry_id uuid, p_entry_payload jsonb, p_idempotency_key text) returns table(state text, approval_request_id uuid, outbox_id uuid, code text)
record_case_decision_email_intent(p_actor_id uuid, p_entry_id uuid, p_decision text, p_reviewer_name text, p_case_url text, p_idempotency_key text) returns table(state text, outbox_id uuid, code text)
create_or_refresh_tenant_invitation(p_actor_id uuid, p_tenant_id uuid, p_email text, p_email_hmac text, p_full_name text, p_role text, p_specialty text, p_idempotency_key text) returns table(state text, invite_id uuid, code text)
consume_tenant_invitation(p_token text, p_token_hash text, p_tenant_id uuid, p_email_hmac text, p_role text) returns table(state text, invite_id uuid, auth_user_id uuid, code text)
```

Each RPC uses a fixed `SECURITY DEFINER` search path, validates active tenant/user authority, writes the business transition and `email_outbox` intent in one transaction, and returns sanitized state.

- [ ] **Step 4: Run verification**

```powershell
supabase db reset
supabase db test supabase/tests/p1_28_email_auth_intent.sql supabase/tests/p1_29_email_auth_transactional.sql
```

Expected: PASS.

- [ ] **Step 5: Review checkpoint**

Inspect grants, search paths, and atomic transaction boundaries. Do not commit.

## Task 3: Centralize authentication email requests on the server

- [ ] **Step 1: Write failing route tests**

For signup, confirmation resend, magic link, and recovery, assert:

- Zod validation and body-size limits
- IP and email-HMAC rate limits
- generic response text
- no account enumeration
- magic link uses `shouldCreateUser: false`
- no auth token appears in response, logs, or `email_auth_intents`
- GoTrue failure produces explicit `failed` intent and controlled HTTP response

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/auth/__tests__/auth-email.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement server routes**

Each route uses `guardRequest`, `getClientIp`, `checkRateLimit`, and a server Supabase client. Use these exact response shapes:

```ts
type AuthEmailResponse =
  | { ok: true; state: 'check_email' }
  | { ok: true; state: 'ready_to_sign_in' }
  | { ok: false; state: 'failed'; code: string };
```

`signUp` must include allowlisted `emailRedirectTo`. Magic link must set `shouldCreateUser: false`. Recovery and confirmation resend must call official GoTrue actions.

- [ ] **Step 4: Move browser calls to server routes**

Update `SignupForm.tsx` and `login/page.tsx` to POST to these routes instead of calling browser email SDK methods directly. Preserve honest confirmation-required versus autoconfirm states.

- [ ] **Step 5: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/auth/__tests__/auth-email.test.ts app/signup app/login
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Search changed auth files for direct `signInWithOtp`, `resetPasswordForEmail`, and browser `signUp` calls. Do not commit.

## Task 4: Complete recovery and MFA-safe callback behavior

- [ ] **Step 1: Write failing callback tests**

Test:

- valid signup code with safe `next`
- recovery code redirects only to `/update-password`
- invalid/expired code redirects to login
- magic-link session for MFA-required role cannot bypass MFA through `next`
- unsafe external `next` is rejected

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/auth/callback/__tests__/route.test.ts
```

Expected: FAIL because callback ignores recovery type and checks MFA after redirect.

- [ ] **Step 3: Update callback ordering**

1. exchange code
2. detect `type=recovery`
3. redirect recovery to `/update-password`
4. load profile
5. enforce MFA for required roles
6. honor only an internal allowlisted `next` path after MFA passes

- [ ] **Step 4: Implement update-password screen**

Require a fresh recovery session, validate password confirmation and strength, call `updateUser({ password })`, sign out, clear sensitive URL state, and redirect to `/login?password_updated=1`.

- [ ] **Step 5: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run app/auth/callback/__tests__/route.test.ts app/update-password
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Confirm recovery sessions cannot reach the dashboard before password update. Do not commit.

## Task 5: Replace tenant invitation with one idempotent transaction

- [ ] **Step 1: Write failing invite tests**

Cover first invite, resend, duplicate request, expired invite, wrong email, wrong tenant, wrong token, accepted invite reuse, profile failure rollback, and already-existing Auth user.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/[tenant]/admin/invite/__tests__/route.test.ts
```

Expected: FAIL because current route duplicates the trigger-created profile.

- [ ] **Step 3: Rewrite invite route**

Use `requireTenantAdmin` with AAL2. Call `create_or_refresh_tenant_invitation`, ask GoTrue for the official invitation action, record `email_auth_intents`, and enqueue only minimal delivery intent. Return:

```ts
type InviteMutationResult =
  | { state: 'queued' }
  | { state: 'resent' }
  | { state: 'already_pending' }
  | { state: 'failed'; code: string };
```

Never return the Auth action link.

- [ ] **Step 4: Implement acceptance page**

`/invite/accept` validates the signed invitation token on the server, shows only safe institution/role data, and calls `consume_tenant_invitation`. Password setup uses the official GoTrue recovery/session flow rather than an application password field.

- [ ] **Step 5: Remove browser-direct invite creation**

`InviteMentor.tsx` and the invites page call the authorized route for single and bulk invites. Each result is displayed independently; do not claim failed email sends for database-only rows.

- [ ] **Step 6: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/[tenant]/admin/invite app/invite/accept components/InviteMentor
supabase db test supabase/tests/p1_28_email_auth_intent.sql supabase/tests/p1_29_email_auth_transactional.sql
```

Expected: PASS.

- [ ] **Step 7: Review checkpoint**

Prove no orphan Auth user remains after any failure. Do not commit.

## Task 6: Fix admin password reset truthfully

- [ ] **Step 1: Write failing admin action tests**

Assert reset calls the official GoTrue recovery delivery route, records intent, returns `queued` or `accepted`, and returns `failed` when GoTrue rejects. Assert `generateLink` is not used as a substitute for delivery.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/[tenant]/admin/users/__tests__/cross-tenant.test.ts
```

Expected: FAIL on the current false-success reset path.

- [ ] **Step 3: Implement the route**

Use the target Auth user's normalized email through the server recovery endpoint with redirect `/auth/callback?type=recovery`. Never return or log the recovery action link.

- [ ] **Step 4: Update user-management UI**

Show confirmed/pending state, resend confirmation, and resend recovery actions. Return disabled controls for unauthorized roles and display the actual route state.

- [ ] **Step 5: Run verification**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/[tenant]/admin/users app/api/[tenant]/admin/__tests__/role-gating.test.ts
```

Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Confirm admin APIs enforce AAL2 server-side. Do not commit.

## Task 7: Repair contact delivery and case notification transactions

- [ ] **Step 1: Write failing contact tests**

Test form-encoded and JSON bodies, invalid content type, actual body limit, all fields, queue failure, no account enumeration, and no free-text message in outbox context.

- [ ] **Step 2: Write failing case tests**

Test pending case creates approval rows and outbox intent, approval/rejection uses Auth user IDs, repeated decision is idempotent, and email is independent of push-token presence.

- [ ] **Step 3: Run and confirm failure**

```powershell
pnpm --filter @elogbook/web exec vitest run app/api/contact/__tests__/route.test.ts "app/(authenticated)/[tenant]/cases/[id]/submit/route.test.ts" app/api/[tenant]/approvals/action/__tests__/route.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement contact and case fixes**

Contact email contains sender name, masked sender address, timestamp, and secure platform-admin URL only. Case submit and decision routes call the transactional RPCs and inspect returned JSON plus Supabase errors.

- [ ] **Step 5: Run verification**

Repeat the targeted command and pgTAP transactional tests. Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Search for remaining direct browser `tenant_invites` inserts, wrong profile IDs in notification user fields, and ignored queue inserts. Do not commit.

## Task 8: Add mobile universal-link handling

- [ ] **Step 1: Write failing mobile tests**

Test confirmation, recovery, invitation, safe callback, unsupported host rejection, no token logging, and web fallback.

- [ ] **Step 2: Run and confirm failure**

```powershell
pnpm --filter @elogbook/mobile test lib/__tests__/auth-links.test.ts lib/__tests__/linking.test.ts lib/__tests__/route-guard.test.ts app/__tests__/auth-flow.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement auth-link parsing**

`auth-links.ts` allowlists exact HTTPS hosts and routes `/auth/callback`, `/update-password`, and `/invite/accept`. It extracts only supported query keys, strips them from displayed navigation state, and never logs values.

- [ ] **Step 4: Add public mobile auth routes**

Add confirmation, recovery, and update-password screens. Permit them before a session exists. Exchange the official code or token through Supabase Auth using existing mobile auth options.

- [ ] **Step 5: Run verification**

Repeat mobile tests and typecheck. Expected: PASS.

- [ ] **Step 6: Review checkpoint**

Confirm route guard does not reject valid auth links and does not permit arbitrary deep links. Do not commit.

## Task 9: Retire the legacy contract and complete E2E

- [ ] **Step 1: Write legacy contract pgTAP test**

Assert no unconverted `email_queue` rows, no new application producer references, and no required plaintext suppression columns remain before contract.

- [ ] **Step 2: Run verification gates**

```powershell
node scripts/migrate-legacy-email-outbox.mjs --verify
supabase db test supabase/tests/p1_30_email_legacy_contract.sql
pnpm --filter @elogbook/web exec playwright test e2e/auth-email.spec.ts e2e/tenant-invite.spec.ts
```

Expected: PASS with synthetic Mailpit recipients.

- [ ] **Step 3: Create contract migration**

`20260924000008_email_legacy_contract.sql` removes legacy plaintext queue/log/suppression columns and old unused open/click fields only after verification guards pass. Retain the revised template identity table and compatibility routes with explicit retired responses.

- [ ] **Step 4: Run complete Phase 3 gate**

```powershell
pnpm typecheck
pnpm lint:all
pnpm test
pnpm build:web
pnpm audit --prod --audit-level=high
git diff --check
git status --short
```

Confirm no GoTrue token appears in logs, queue payloads, audit metadata, or test artifacts. Do not commit.
