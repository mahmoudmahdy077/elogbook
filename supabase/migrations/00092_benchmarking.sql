-- Migration 00092: Cross-Institution Benchmarking (Phase 6 - Enterprise)
CREATE TABLE IF NOT EXISTS public.benchmark_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  specialty TEXT NOT NULL,
  procedure_type TEXT NOT NULL,
  avg_cases_per_resident NUMERIC(5,1),
  tenant_count INTEGER NOT NULL,
  total_residents INTEGER NOT NULL,
  period TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(specialty, procedure_type, period)
);

-- Materialized view for fast aggregation
CREATE MATERIALIZED VIEW IF NOT EXISTS public.benchmark_mv AS
SELECT
  specialty,
  procedure_type,
  avg_cases,
  tenant_count,
  total_residents
FROM (
  SELECT
    specialty,
    procedure_type,
    AVG(ce_count)::NUMERIC(5,1) as avg_cases,
    COUNT(DISTINCT tenant_id) as tenant_count,
    SUM(resident_count) as total_residents
  FROM (
    SELECT
      ct.specialty,
      ct.name as procedure_type,
      ce.tenant_id,
      COUNT(ce.id) as ce_count,
      COUNT(DISTINCT ce.resident_id) as resident_count
    FROM case_entries ce
    JOIN case_templates ct ON ce.template_id = ct.id
    WHERE ce.deleted_at IS NULL AND ce.status = 'approved'
    GROUP BY ct.specialty, ct.name, ce.tenant_id
  ) t
  GROUP BY specialty, procedure_type
) t;

CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmark_mv_unique ON public.benchmark_mv(specialty, procedure_type);
