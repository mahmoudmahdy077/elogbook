# Faculty Evaluations — Design Spec

## Problem

Program directors need to evaluate residents and track progress. Residents need to see their evaluation scores.

## Scope

Faculty (supervisors/directors) evaluate residents on:
- Clinical skills
- Professionalism
- Procedures logged
- Accreditation milestone progress

## Schema (migration 00070)

**Table: faculty_evaluations**

```sql
CREATE TABLE faculty_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  resident_id UUID NOT NULL REFERENCES profiles(id),
  evaluator_id UUID NOT NULL REFERENCES profiles(id),
  evaluation_date DATE NOT NULL,
  clinical_skills INTEGER CHECK (clinical_skills BETWEEN 1 AND 5),
  professionalism INTEGER CHECK (professionalism BETWEEN 1 AND 5),
  procedures INTEGER CHECK (procedures BETWEEN 1 AND 5),
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Aggregate view
CREATE OR REPLACE VIEW resident_evaluation_averages AS
SELECT resident_id,
  AVG(clinical_skills) AS avg_clinical,
  AVG(professionalism) AS avg_professionalism,
  AVG(procedures) AS avg_procedures,
  COUNT(*) AS evaluation_count
FROM faculty_evaluations
GROUP BY resident_id;
```

## UI

**Evaluate resident page:** `/[tenant]/evaluate/resident/[id]/page.tsx`
- Form with 1-5 rating sliders
- Comments textarea
- Submit to evaluations table

**My evaluations page:** `/[tenant]/resident/evaluations/page.tsx`
- Resident's own scores over time
- Average scores card
- Trend chart

**Aggregate view:** `/[tenant]/reports/evaluations/page.tsx`
- All residents' average scores
- Filter by date range
- Export CSV

## Types (packages/shared/src/types/database.ts)

```ts
export interface FacultyEvaluation {
  id: string;
  tenant_id: string;
  resident_id: string;
  evaluator_id: string;
  evaluation_date: string;
  clinical_skills: number;
  professionalism: number;
  procedures: number;
  comments: string | null;
  created_at: string;
}
```