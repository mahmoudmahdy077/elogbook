# C.1 — Error Display Standardization

**Part of:** Market Gap, Feature Completeness & Design Upgrade Plan
**Prerequisites:** Enterprise Master Plan Phases 0-8 (complete)
**Design status:** Approved 2026-07-01

---

## 1. Problem

Raw error strings (`error.message`) are rendered directly to users in 13+ files across the web app. Two parallel error-display patterns exist: a proper `<ErrorDisplay>` component (used in ~15 places but fed raw error messages) and raw `<div>{error}</div>` blocks (~10 places). No centralized mapping of known error codes to user-friendly copy exists.

## 2. Design

### 2.1 New file: `lib/error-messages.ts`

Exports a single function:

```ts
function toUserMessage(raw: string): string
```

**Behavior:**
- Accepts a raw error string (from `error.message`, caught exceptions, etc.)
- Maps known patterns to user-friendly copy using a prioritized rule list
- Always calls `Sentry.captureMessage(raw)` before mapping (observes raw error regardless of output)
- Falls back to generic "Something went wrong. Please try again."
- Purely synchronous, no side effects beyond Sentry

**Mapping priority (first match wins):**

| Category | Pattern | User message |
|---|---|---|
| Postgres code | `23505` / `duplicate key` / `unique constraint` | "This record already exists." |
| Postgres code | `42501` / `permission denied` / `violates row-level security` | "You don't have permission to do this." |
| Postgres code | `23503` / `foreign key` | "This record is linked to other data and cannot be changed." |
| Postgres code | `23514` / `violates check` | "The data entered violates a validation rule." |
| Postgres code | `22P02` / `invalid input syntax` | "Invalid data format entered." |
| Postgres code | `40001` / `serialization failure` | "A conflict occurred. Please try again." |
| Postgres code | `40P01` / `deadlock detected` | "A system conflict occurred. Please try again." |
| Supabase auth | `EmailNotConfirmed` | "Please confirm your email address before signing in." |
| Supabase auth | `InvalidLoginCredentials` | "Invalid email or password." |
| Supabase auth | `OtpExpired` | "The verification code has expired. Request a new one." |
| Supabase auth | `SmtpError` | "Unable to send email. Please try again later." |
| Supabase auth | `UserAlreadyRegistered` | "An account with this email already exists." |
| Supabase auth | `RateLimitExceeded` | "Too many attempts. Please wait and try again." |
| Supabase auth | `invalid_credentials` (lowercase) | "Invalid email or password." |
| Network | `Failed to fetch` / `NetworkError` / `Network request failed` | "A network error occurred. Check your connection." |
| Network | `timeout` / `Timeout` | "The request timed out. Please try again." |
| Network | `abort` / `AbortError` | "The request was cancelled." |
| Generic | catches none of the above | "Something went wrong. Please try again. If the problem persists, contact support." |

### 2.2 Modified file: `components/ErrorDisplay.tsx`

**Changes:**
- Import `{ toUserMessage }` from `@/lib/error-messages`
- Remove `friendlyMessage()` function entirely (logic moves to `toUserMessage`)
- Replace `{friendlyMessage(message)}` call with `{toUserMessage(message)}`
- All other props, JSX, `<details>` expandable pattern remain identical

**No API change** — props remain `{ message: string; onRetry?: () => void }`.

### 2.3 Caller files: raw `<div>{error}</div>` → `<ErrorDisplay>`

Files that currently use raw error display blocks (not already using `ErrorDisplay`):

| File | Pattern | Replace with |
|---|---|---|
| `app/login/page.tsx` (ForgotPasswordForm) | `<div className="bg-danger/10...">{error}</div>` | `<ErrorDisplay message={error} />` |
| `app/login/page.tsx` (LoginPage) | `<div className="bg-danger/10...">{error}</div>` | `<ErrorDisplay message={error} />` |
| `app/mfa/verify/page.tsx` | `<div className="danger-banner...">{error}</div>` | `<ErrorDisplay message={error} />` |
| `app/mfa/enroll/page.tsx` | `<div className="danger-banner...">{error}</div>` | `<ErrorDisplay message={error} />` |
| `components/approvals/ApprovalActions.tsx` | `danger-banner` with `{error}` | `<ErrorDisplay message={error} />` |
| `components/UserManager.tsx` | `danger-banner` with `{error}` | `<ErrorDisplay message={error} />` |
| `components/CompetencyManager.tsx` | `danger-banner` with `{error}` | `<ErrorDisplay message={error} />` |
| `components/GoalForm.tsx` | `danger-banner` with `{error}` | `<ErrorDisplay message={error} />` |
| `components/TemplateEditor.tsx` | `danger-banner` with `{error}` | `<ErrorDisplay message={error} />` |
| `app/(authenticated)/[tenant]/admin/retention/RetentionForm.tsx` | `danger-banner` with `{error}` | `<ErrorDisplay message={error} />` |
| `app/(authenticated)/[tenant]/consent/ConsentRow.tsx` | `danger-banner` with `{error}` | `<ErrorDisplay message={error} />` |

**Self-check rule:** After this pass, `grep -rn --include="*.tsx" "{error}" apps/web | grep -v ErrorDisplay | grep -v test` should return nothing outside `ErrorDisplay`'s own internals.

### 2.4 New file: `lib/__tests__/error-messages.test.ts`

Coverage per mapping category:
- 2 Postgres code tests (exact code match + substring pattern)
- 3 Supabase auth tests (camelCase code, lowercase message, mixed case)
- 2 Network error tests (Failed to fetch, timeout)
- 1 Unmapped error test (generic fallback)
- 1 Test that Sentry.captureMessage is called

### 2.5 Exclusions (explicitly out of scope)

- `ErrorBoundary.tsx` and `app/global-error.tsx` — these catch render exceptions (not API errors) and were already sanitized in Phase 5. They report through a different path.
- Mobile app — the `lib/` path is web-only; mobile error display is a separate concern.

## 3. Files Changed

| File | Action |
|---|---|
| `apps/web/lib/error-messages.ts` | CREATE |
| `apps/web/lib/__tests__/error-messages.test.ts` | CREATE |
| `apps/web/components/ErrorDisplay.tsx` | MODIFY (replace friendlyMessage → toUserMessage) |
| `apps/web/app/login/page.tsx` | MODIFY (2 raw → ErrorDisplay) |
| `apps/web/app/mfa/verify/page.tsx` | MODIFY (raw → ErrorDisplay) |
| `apps/web/app/mfa/enroll/page.tsx` | MODIFY (raw → ErrorDisplay) |
| `apps/web/components/approvals/ApprovalActions.tsx` | MODIFY (raw → ErrorDisplay) |
| `apps/web/components/UserManager.tsx` | MODIFY (raw → ErrorDisplay) |
| `apps/web/components/CompetencyManager.tsx` | MODIFY (raw → ErrorDisplay) |
| `apps/web/components/GoalForm.tsx` | MODIFY (raw → ErrorDisplay) |
| `apps/web/components/TemplateEditor.tsx` | MODIFY (raw → ErrorDisplay) |
| `apps/web/app/(authenticated)/[tenant]/admin/retention/RetentionForm.tsx` | MODIFY (raw → ErrorDisplay) |
| `apps/web/app/(authenticated)/[tenant]/consent/ConsentRow.tsx` | MODIFY (raw → ErrorDisplay) |

## 4. Verification

```sh
# 1. New tests pass
pnpm test -- --run lib/__tests__/error-messages.test.ts

# 2. All existing tests pass
pnpm test

# 3. No remaining raw {error} patterns outside ErrorDisplay
rg --include="*.tsx" "{error}" apps/web | grep -v ErrorDisplay | grep -v test

# 4. Typecheck
pnpm -r typecheck
```
