-- Migration 00069: Duty hour tracking for ACGME compliance

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
CREATE INDEX idx_duty_periods_resident ON duty_periods(resident_id, shift_date);

ALTER TABLE duty_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY duty_periods_tenant_isolation ON duty_periods
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = resident_id))
  WITH CHECK (true);

-- View for weekly violations (>80 hours/week)
CREATE OR REPLACE VIEW duty_weekly_violations AS
SELECT tenant_id, resident_id, week_start, SUM(hours_worked) AS total_hours
FROM (
  SELECT tenant_id, resident_id, shift_date,
         DATE_TRUNC('week', shift_date)::DATE AS week_start,
         hours_worked FROM duty_periods
) sub
GROUP BY tenant_id, resident_id, week_start
HAVING SUM(hours_worked) > 80;

-- Down migration:
-- DROP VIEW IF EXISTS duty_weekly_violations;
-- DROP TABLE IF EXISTS duty_periods;