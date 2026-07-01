# C.1 — Error Display Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize all user-facing error messages into a single `toUserMessage()` utility that maps known Supabase/Postgres/network errors to user-friendly copy and logs raw errors to Sentry, and consolidate all raw `<div>{error}</div>` patterns onto the existing `<ErrorDisplay>` component.

**Architecture:** A pure function `toUserMessage(raw: string): string` in `lib/error-messages.ts` replaces the inline `friendlyMessage()` substring matching in `ErrorDisplay.tsx`. Callers continue passing `error.message` (no interface change). 10 raw error display blocks across 11 files are replaced with `<ErrorDisplay>`.

**Tech Stack:** TypeScript, Sentry (`@sentry/nextjs`), Vitest, React

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/web/lib/error-messages.ts` | CREATE | Pure function `toUserMessage()` + code-to-message mapping table |
| `apps/web/lib/__tests__/error-messages.test.ts` | CREATE | Tests for all mapping categories |
| `apps/web/components/ErrorDisplay.tsx` | MODIFY | Replace `friendlyMessage()` with import from `@/lib/error-messages` |
| `apps/web/app/login/page.tsx` | MODIFY | 2 raw `<div>{error}</div>` → `<ErrorDisplay>` |
| `apps/web/app/mfa/verify/page.tsx` | MODIFY | 1 raw `<div>{error}</div>` → `<ErrorDisplay>` |
| `apps/web/app/mfa/enroll/page.tsx` | MODIFY | 1 raw `<div>{error}</div>` → `<ErrorDisplay>` |
| `apps/web/components/ApprovalActions.tsx` | MODIFY | 1 raw `<p>{error}</p>` → `<ErrorDisplay>` |
| `apps/web/components/UserManager.tsx` | MODIFY | 1 raw `<div>{error}</div>` → `<ErrorDisplay>` |
| `apps/web/components/CompetencyManager.tsx` | MODIFY | 1 raw `<div>{error}</div>` → `<ErrorDisplay>` |
| `apps/web/components/GoalForm.tsx` | MODIFY | 1 raw `<div>{error}</div>` → `<ErrorDisplay>` |
| `apps/web/components/TemplateEditor.tsx` | MODIFY | 1 raw `<div>{error}</div>` → `<ErrorDisplay>` |
| `apps/web/app/(authenticated)/[tenant]/admin/retention/RetentionForm.tsx` | MODIFY | 1 raw `<div>{error}</div>` → `<ErrorDisplay>` |
| `apps/web/app/(authenticated)/[tenant]/consent/ConsentRow.tsx` | MODIFY | 1 raw `<p>{error}</p>` → `<ErrorDisplay>` |

---

### Task 1: Create `lib/error-messages.ts`

**Files:**
- Create: `apps/web/lib/error-messages.ts`
- Test: `apps/web/lib/__tests__/error-messages.test.ts` (next task)

- [ ] **Step 1: Write the file**

```typescript
import * as Sentry from '@sentry/nextjs';

const patterns: [RegExp, string][] = [
  // Postgres codes
  [/23505|duplicate key|unique constraint/i, 'This record already exists.'],
  [/42501|permission denied|violates row.level security/i, "You don't have permission to do this."],
  [/23503|foreign key/i, 'This record is linked to other data and cannot be changed.'],
  [/23514|violates check/i, 'The data entered violates a validation rule.'],
  [/22P02|invalid input syntax/i, 'Invalid data format entered.'],
  [/40001|serialization failure/i, 'A conflict occurred. Please try again.'],
  [/40P01|deadlock detected/i, 'A system conflict occurred. Please try again.'],
  // Supabase auth
  [/EmailNotConfirmed/i, 'Please confirm your email address before signing in.'],
  [/InvalidLoginCredentials|invalid_credentials/i, 'Invalid email or password.'],
  [/OtpExpired/i, 'The verification code has expired. Request a new one.'],
  [/SmtpError/i, 'Unable to send email. Please try again later.'],
  [/UserAlreadyRegistered/i, 'An account with this email already exists.'],
  [/RateLimitExceeded/i, 'Too many attempts. Please wait and try again.'],
  // Network
  [/Failed to fetch|NetworkError|Network request failed/i, 'A network error occurred. Check your connection.'],
  [/timeout|Timeout/i, 'The request timed out. Please try again.'],
  [/abort|AbortError/i, 'The request was cancelled.'],
];

export function toUserMessage(raw: string): string {
  Sentry.captureMessage(raw);

  for (const [regex, message] of patterns) {
    if (regex.test(raw)) return message;
  }

  return 'Something went wrong. Please try again. If the problem persists, contact support.';
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/error-messages.ts
git commit -m "feat(lib): add toUserMessage() error mapper"
```

---

### Task 2: Create `lib/__tests__/error-messages.test.ts`

**Files:**
- Create: `apps/web/lib/__tests__/error-messages.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toUserMessage } from '../error-messages';

vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toUserMessage', () => {
  it('maps Postgres unique violation code 23505', () => {
    expect(toUserMessage('23505: duplicate key value')).toBe('This record already exists.');
  });

  it('maps Postgres permission denied via message text', () => {
    expect(toUserMessage('permission denied for table profiles')).toBe("You don't have permission to do this.");
  });

  it('maps RLS violation with technical wording', () => {
    expect(toUserMessage('new row violates row-level security for table audit_logs')).toBe("You don't have permission to do this.");
  });

  it('maps Supabase InvalidLoginCredentials', () => {
    expect(toUserMessage('InvalidLoginCredentials')).toBe('Invalid email or password.');
  });

  it('maps Supabase lowercase invalid_credentials', () => {
    expect(toUserMessage('invalid_credentials')).toBe('Invalid email or password.');
  });

  it('maps Supabase EmailNotConfirmed', () => {
    expect(toUserMessage('EmailNotConfirmed')).toBe('Please confirm your email address before signing in.');
  });

  it('maps Supabase OtpExpired', () => {
    expect(toUserMessage('OtpExpired')).toBe('The verification code has expired. Request a new one.');
  });

  it('maps Supabase RateLimitExceeded', () => {
    expect(toUserMessage('RateLimitExceeded')).toBe('Too many attempts. Please wait and try again.');
  });

  it('maps network Failed to fetch', () => {
    expect(toUserMessage('Failed to fetch')).toBe('A network error occurred. Check your connection.');
  });

  it('maps network timeout', () => {
    expect(toUserMessage('The request timed out after 30s')).toBe('The request timed out. Please try again.');
  });

  it('maps abort error', () => {
    expect(toUserMessage('AbortError: The operation was aborted')).toBe('The request was cancelled.');
  });

  it('returns fallback for unmapped errors', () => {
    expect(toUserMessage('some random error')).toBe('Something went wrong. Please try again. If the problem persists, contact support.');
  });

  it('calls Sentry.captureMessage with the raw message', () => {
    const sentry = require('@sentry/nextjs');
    toUserMessage('test-error');
    expect(sentry.captureMessage).toHaveBeenCalledWith('test-error');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/__tests__/error-messages.test.ts`
Expected: 13 tests passed

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/__tests__/error-messages.test.ts
git commit -m "test(lib): add toUserMessage() tests"
```

---

### Task 3: Update `ErrorDisplay.tsx` to use `toUserMessage`

**Files:**
- Modify: `apps/web/components/ErrorDisplay.tsx`

- [ ] **Step 1: Replace `friendlyMessage()` with `toUserMessage()`**

Current `ErrorDisplay.tsx` has:
```tsx
import React from 'react';

interface ErrorDisplayProps {
  message: string;
  onRetry?: () => void;
}

function friendlyMessage(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('duplicate') || lower.includes('unique'))
    return 'This record already exists. Please check for duplicates.';
  if (lower.includes('permission') || lower.includes('violates row-level security'))
    return 'You don\'t have permission to perform this action. Contact your program director if you need access.';
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('timeout'))
    return 'A network error occurred. Please check your connection and try again.';
  if (lower.includes('not found') || lower.includes('404'))
    return 'The requested information could not be found. It may have been removed.';
  if (lower.includes('validation') || lower.includes('invalid'))
    return 'Some of the information entered is invalid. Please review and correct your entries.';
  return 'Something went wrong. Please try again. If the problem persists, contact support.';
}

export default function ErrorDisplay({ message, onRetry }: ErrorDisplayProps) {
  // ... rest of component
```

Replace the entire file content with:

```tsx
'use client';

import { toUserMessage } from '@/lib/error-messages';

interface ErrorDisplayProps {
  message: string;
  onRetry?: () => void;
}

export default function ErrorDisplay({ message, onRetry }: ErrorDisplayProps) {
  return (
    <div className="danger-banner rounded-lg p-4 text-sm space-y-3" role="alert">
      <div className="flex items-start gap-3">
        <svg className="w-5 h-5 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        <div>
          <p className="font-medium">{toUserMessage(message)}</p>
          <details className="mt-1.5">
            <summary className="text-xs text-neutral-light/50 cursor-pointer hover:text-neutral-light/60">
              Technical details
            </summary>
            <p className="text-xs text-neutral-light/50 mt-1 font-mono break-all">{message}</p>
          </details>
        </div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run existing tests to confirm no regression**

Run: `cd apps/web && npx vitest run`
Expected: All existing tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/ErrorDisplay.tsx
git commit -m "refactor(components): replace friendlyMessage() with toUserMessage()"
```

---

### Task 4: Replace raw error displays — Login + MFA pages (4 raw blocks)

**Files:**
- Modify: `apps/web/app/login/page.tsx`
- Modify: `apps/web/app/mfa/verify/page.tsx`
- Modify: `apps/web/app/mfa/enroll/page.tsx`

These 3 files have 4 raw error blocks (2 in login, 1 in verify, 1 in enroll) that were already sanitized in Phase 5 (raw error strings replaced with friendly messages). Now replace the display container itself with `<ErrorDisplay>`.

- [ ] **Step 1: Update login page — ForgotPasswordForm error block**

In `apps/web/app/login/page.tsx`, find:
```tsx
      {error && (
        <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-xl px-3 py-2 mb-4" role="alert">
          {error}
        </div>
      )}
```

Replace with:
```tsx
      {error && (
        <div className="mb-4">
          <ErrorDisplay message={error} />
        </div>
      )}
```

And add the import at the top of the file (with the other imports):
```tsx
import ErrorDisplay from '@/components/ErrorDisplay';
```

- [ ] **Step 2: Update login page — LoginPage error block**

In the same file, find:
```tsx
                {error && (
                  <div className="bg-danger/10 border border-danger/30 text-danger text-sm rounded-xl px-3 py-2" role="alert" aria-live="assertive" aria-atomic="true">
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                      </svg>
                      <span>{error}</span>
                    </div>
                  </div>
                )}
```

Replace with:
```tsx
                {error && <ErrorDisplay message={error} />}
```

- [ ] **Step 3: Update MFA verify page**

In `apps/web/app/mfa/verify/page.tsx`, add import:
```tsx
import ErrorDisplay from '@/components/ErrorDisplay';
```

Find:
```tsx
            {error && <div className="danger-banner text-xs rounded-lg p-2.5" role="alert">{error}</div>}
```

Replace with:
```tsx
            {error && <ErrorDisplay message={error} />}
```

- [ ] **Step 4: Update MFA enroll page**

In `apps/web/app/mfa/enroll/page.tsx`, add import:
```tsx
import ErrorDisplay from '@/components/ErrorDisplay';
```

Find:
```tsx
            {error && <div className="danger-banner text-xs rounded-lg p-2.5" role="alert">{error}</div>}
```

Replace with:
```tsx
            {error && <ErrorDisplay message={error} />}
```

- [ ] **Step 5: Run tests to confirm no regression**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/login/page.tsx apps/web/app/mfa/verify/page.tsx apps/web/app/mfa/enroll/page.tsx
git commit -m "feat(ui): replace raw error blocks with ErrorDisplay in login/MFA pages"
```

---

### Task 5: Replace raw error displays — Component files (5 files)

**Files:**
- Modify: `apps/web/components/ApprovalActions.tsx`
- Modify: `apps/web/components/UserManager.tsx`
- Modify: `apps/web/components/CompetencyManager.tsx`
- Modify: `apps/web/components/GoalForm.tsx`
- Modify: `apps/web/components/TemplateEditor.tsx`

- [ ] **Step 1: Update ApprovalActions.tsx**

Add import:
```tsx
import ErrorDisplay from '@/components/ErrorDisplay';
```

Find:
```tsx
      {error && (
        <p className="text-danger text-sm" role="alert">{error}</p>
      )}
```

Replace with:
```tsx
      {error && <ErrorDisplay message={error} />}
```

- [ ] **Step 2: Update UserManager.tsx**

Add import:
```tsx
import ErrorDisplay from '@/components/ErrorDisplay';
```

Find:
```tsx
      {error && (
        <div className="bg-danger-50 text-danger p-3 rounded-lg text-sm mb-4">{error}</div>
      )}
```

Replace with:
```tsx
      {error && <ErrorDisplay message={error} />}
```

- [ ] **Step 3: Update CompetencyManager.tsx**

Add import:
```tsx
import ErrorDisplay from '@/components/ErrorDisplay';
```

Find:
```tsx
      {error && (
        <div className="bg-danger-50 text-danger p-3 rounded-lg text-sm mb-4">{error}</div>
      )}
```

Replace with:
```tsx
      {error && <ErrorDisplay message={error} />}
```

- [ ] **Step 4: Update GoalForm.tsx**

Add import:
```tsx
import ErrorDisplay from '@/components/ErrorDisplay';
```

Find:
```tsx
          {error && (
            <div className="text-danger text-sm bg-danger-50 p-2 rounded">{error}</div>
          )}
```

Replace with:
```tsx
          {error && <ErrorDisplay message={error} />}
```

- [ ] **Step 5: Update TemplateEditor.tsx**

Add import:
```tsx
import ErrorDisplay from '@/components/ErrorDisplay';
```

Find:
```tsx
      {error && (
        <div className="bg-danger-50 text-danger p-3 rounded-lg text-sm mb-4">{error}</div>
      )}
```

Replace with:
```tsx
      {error && <ErrorDisplay message={error} />}
```

- [ ] **Step 6: Run tests**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ApprovalActions.tsx apps/web/components/UserManager.tsx apps/web/components/CompetencyManager.tsx apps/web/components/GoalForm.tsx apps/web/components/TemplateEditor.tsx
git commit -m "feat(ui): replace raw error blocks with ErrorDisplay in component files"
```

---

### Task 6: Replace raw error displays — Admin/Consent pages (2 files)

**Files:**
- Modify: `apps/web/app/(authenticated)/[tenant]/admin/retention/RetentionForm.tsx`
- Modify: `apps/web/app/(authenticated)/[tenant]/consent/ConsentRow.tsx`

- [ ] **Step 1: Update RetentionForm.tsx**

Add import:
```tsx
import ErrorDisplay from '@/components/ErrorDisplay';
```

Find:
```tsx
      {error && (
        <div className="danger-banner text-xs rounded-lg p-2.5" role="alert">{error}</div>
      )}
```

Replace with:
```tsx
      {error && <ErrorDisplay message={error} />}
```

- [ ] **Step 2: Update ConsentRow.tsx**

Add import:
```tsx
import ErrorDisplay from '@/components/ErrorDisplay';
```

Find:
```tsx
        {error && (
          <p className="text-xs text-danger mt-2" role="alert">{error}</p>
        )}
```

Replace with:
```tsx
        {error && <ErrorDisplay message={error} />}
```

- [ ] **Step 3: Run tests**

Run: `cd apps/web && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(authenticated)/[tenant]/admin/retention/RetentionForm.tsx apps/web/app/(authenticated)/[tenant]/consent/ConsentRow.tsx
git commit -m "feat(ui): replace raw error blocks with ErrorDisplay in admin/consent pages"
```

---

### Task 7: Verification sweep

- [ ] **Step 1: Verify no remaining raw error patterns outside ErrorDisplay**

Run:
```bash
rg -g "*.tsx" "\{error\}" apps/web/ | Select-String -NotMatch "ErrorDisplay|test|__tests__|\.stories"
```

Expected output: Only lines inside `ErrorDisplay.tsx` itself (the `{toUserMessage(message)}` and `{message}` lines). If there are matches outside, those need fixing.

- [ ] **Step 2: Run full typecheck**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Run full test suite**

```bash
cd apps/web && npx vitest run
```

Expected: All tests pass

- [ ] **Step 4: Run full lint**

```bash
pnpm lint:all
```

Expected: 0 errors, warnings unchanged

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verification sweep after C.1 error display standardization"
```
