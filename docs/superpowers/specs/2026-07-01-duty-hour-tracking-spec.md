# Duty/Hour Tracking — Design Spec

## Problem

Residents must track duty hours for ACGME/institutional compliance. Common violations:
- >80 hours/week average (including call)
- >24 consecutive hours
- Missing rest period between shifts

Program directors need visibility into violations.

## Phase 1: Schema (migration 00069)

**Table: duty_periods**

```sql
CREATE TABLE duty_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  hours_worked DECIMAL(4,2) NOT NULL CHECK (hours_worked >= 0 AND hours_worked <= 24),
  shift_type TEXT NOT NULL CHECK (shift_type IN ('call', 'clinic', 'vacation', 'weekend', 'regular')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_duty_periods_tenant_date ON duty_periods(tenant_id, shift_date);
```

**Violation detection view:**

```sql
CREATE OR REPLACE VIEW duty_weekly_violations AS
SELECT resident_id, week_start, SUM(hours_worked) AS total_hours
FROM (
  SELECT resident_id, shift_date,
         date_trunc('week', shift_date)::date AS week_start,
         hours_worked FROM duty_periods
) sub
GROUP BY resident_id, week_start
HAVING SUM(hours_worked) > 80;
```

## Phase 2: Logging UI

**Mobile route:** `app/(tabs)/duty-hours.tsx`
- Date picker (React Native)
- Hours input (number, step 0.25)
- Shift type selector (call, clinic, vacation, weekend, regular)
- Notes optional
- Submit to `duty_periods` table via Supabase

**Web page:** `(authenticated)/[tenant]/resident/duty-hours/page.tsx`
- Same form structure
- List past entries (table with date, hours, type, edit/delete)

## Phase 3: Dashboard

**Mobile:** Add tab or embed in resident dashboard
**Web:** `/(authenticated)/[tenant]/reports/duty-hours/page.tsx`

**Components:**
- Weekly calendar grid (7x24) showing hours per day
- Violation badge (red) when >80 hrs/week
- 4-week average trend (sparkline SVG)
- Export CSV per-resident per-week

## Types (packages/shared/src/types/database.ts)

```ts
export interface DutyPeriod {
  id: string;
  tenant_id: string;
  resident_id: string;
  shift_date: string;
  hours_worked: number;
  shift_type: 'call' | 'clinic' | 'vacation' | 'weekend' | 'regular';
  notes: string | null;
  created_at: string;
  updated_at: string;
}
```

## Testing

- Migration: verify weekly_violations view returns violations correctly
- API route tests: CSV export returns proper data
- Component tests: DutyHoursForm validates inputs