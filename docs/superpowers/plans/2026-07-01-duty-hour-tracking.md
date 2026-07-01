# Duty/Hour Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow residents to log duty hours and show violation alerts for >80 hrs/week.

**Architecture:** Three incremental phases delivered as separate commits. Each phase builds on prior.

**Tech Stack:** Supabase (migration + views), React Native + Next.js, Vitest.

---

### Task 1: Schema migration (00069)

**Files:**
- Create: `supabase/migrations/00069_duty_tracking.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE duty_periods (...);
CREATE INDEX ...;

CREATE OR REPLACE VIEW duty_weekly_violations AS ...
```

- [ ] **Step 2: Verify** - no SQL syntax errors

- [ ] **Step 3: Commit**

---

### Task 2: Shared types

**Files:**
- Modify: `packages/shared/src/types/database.ts`

Add `DutyPeriod` interface. Commit.

---

### Task 3: Mobile logging screen

**Files:**
- Create: `apps/mobile/app/(tabs)/duty-hours.tsx`

- [ ] **Step 1: Create form with date, hours, shift type, notes
- [ ] **Step 2: Write to duty_periods via Supabase
- [ ] **Step 3: Typecheck + commit

---

### Task 4: Web logging page

**Files:**
- Create: `apps/web/app/(authenticated)/[tenant]/resident/duty-hours/page.tsx`
- Create: `apps/web/components/DutyHoursForm.tsx`

- [ ] **Step 1: Create DutyHoursForm component
- [ ] **Step 2: Create page
- [ ] **Step 3: Typecheck + tests + commit

---

### Task 5: Violation dashboard

**Files:**
- Create: `apps/web/app/(authenticated)/[tenant]/reports/duty-hours/page.tsx`
- Create: `apps/web/components/DutyHoursChart.tsx`

- [ ] **Step 1: Create chart component (weekly calendar grid)
- [ ] **Step 2: Create dashboard page
- [ ] **Step 3: Typecheck + commit

---

### Task 6: Final verification

- [ ] Run all tests
- [ ] Commit + push