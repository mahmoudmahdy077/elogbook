# Faculty Evaluations Implementation Plan

**Goal:** Faculty can evaluate residents; residents see their scores; directors see aggregates.

**Architecture:** Three pages (evaluate, my-evaluations, reports) + shared form component.

---

### Task 1: Schema migration (00070)

- [ ] Create `supabase/migrations/00070_faculty_evaluations.sql`
- [ ] Verify SQL syntax
- [ ] Commit

### Task 2: Shared types

- [ ] Add `FacultyEvaluation` interface to `packages/shared/src/types/database.ts`
- [ ] Commit

### Task 3: Evaluation form component

- [ ] Create `apps/web/components/FacultyEvaluationForm.tsx`
- [ ] Slider/rating inputs
- [ ] Submit to `faculty_evaluations`
- [ ] Typecheck + commit

### Task 4: Evaluate resident page

- [ ] Create `apps/web/app/(authenticated)/[tenant]/evaluate/resident/[id]/page.tsx`
- [ ] Uses FacultyEvaluationForm
- [ ] Typecheck + commit

### Task 5: Resident's own evaluations page

- [ ] Create `apps/web/app/(authenticated)/[tenant]/resident/evaluations/page.tsx`
- [ ] Shows scores over time with chart
- [ ] Typecheck + commit

### Task 6: Reports page + CSV export

- [ ] Create `apps/web/app/(authenticated)/[tenant]/reports/evaluations/page.tsx`
- [ ] Create CSV export route
- [ ] Typecheck + final commit

### Task 7: Verification

- [ ] Run all tests
- [ ] Push