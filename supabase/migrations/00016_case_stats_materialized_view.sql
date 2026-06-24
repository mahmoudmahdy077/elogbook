-- Materialized view for case statistics
CREATE MATERIALIZED VIEW case_stats_mv AS
SELECT 
  ce.tenant_id,
  ce.resident_id,
  COUNT(*) AS total_cases,
  COUNT(*) FILTER (WHERE ce.status = 'draft') AS draft_count,
  COUNT(*) FILTER (WHERE ce.status = 'pending') AS pending_count,
  COUNT(*) FILTER (WHERE ce.status = 'approved') AS approved_count,
  COUNT(*) FILTER (WHERE ce.status = 'rejected') AS rejected_count,
  (
    SELECT jsonb_object_agg(specialty, cnt)
    FROM (
      SELECT ct2.specialty, COUNT(*) AS cnt
      FROM case_entries ce2
      JOIN case_templates ct2 ON ct2.id = ce2.template_id
      WHERE ce2.tenant_id = ce.tenant_id
        AND ce2.resident_id = ce.resident_id
        AND ce2.deleted_at IS NULL
      GROUP BY ct2.specialty
    ) s
  ) AS by_specialty,
  (
    SELECT jsonb_object_agg(month, cnt)
    FROM (
      SELECT to_char(ce2.case_date, 'YYYY-MM') AS month, COUNT(*) AS cnt
      FROM case_entries ce2
      WHERE ce2.tenant_id = ce.tenant_id
        AND ce2.resident_id = ce.resident_id
        AND ce2.deleted_at IS NULL
      GROUP BY month
      ORDER BY month
    ) m
  ) AS by_month
FROM case_entries ce
WHERE ce.deleted_at IS NULL
GROUP BY ce.tenant_id, ce.resident_id;

-- Indexes for fast lookups
CREATE UNIQUE INDEX idx_case_stats_mv_tenant_resident ON case_stats_mv (tenant_id, resident_id);
CREATE INDEX idx_case_stats_mv_tenant ON case_stats_mv (tenant_id);

-- Refresh function
CREATE OR REPLACE FUNCTION refresh_case_stats_mv()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY case_stats_mv;
END;
$$ LANGUAGE plpgsql;

-- Schedule via pg_cron (run every 5 minutes)
-- NOTE: Enable pg_cron extension first if not enabled
-- SELECT cron.schedule('refresh-case-stats', '*/5 * * * *', 'SELECT refresh_case_stats_mv();');

-- Updated get_case_stats() to use materialized view
CREATE OR REPLACE FUNCTION get_case_stats(
  p_resident_id UUID DEFAULT NULL,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_tenant_id UUID;
BEGIN
  v_tenant_id := get_tenant_id();

  -- Base stats from materialized view (instant)
  SELECT jsonb_build_object(
    'total_cases', COALESCE(SUM(total_cases), 0),
    'by_status', jsonb_build_object(
      'draft', COALESCE(SUM(draft_count), 0),
      'pending', COALESCE(SUM(pending_count), 0),
      'approved', COALESCE(SUM(approved_count), 0),
      'rejected', COALESCE(SUM(rejected_count), 0)
    ),
    'by_specialty', COALESCE(
      (SELECT jsonb_object_agg(specialty, cnt) FROM (
        SELECT specialty, SUM(cnt) AS cnt FROM (
          SELECT jsonb_each_text(by_specialty) AS specialty, cnt FROM case_stats_mv
          WHERE tenant_id = v_tenant_id
            AND (p_resident_id IS NULL OR resident_id = p_resident_id)
        ) sub GROUP BY specialty
      ) sub2), '{}'::jsonb
    ),
    'by_month', COALESCE(
      (SELECT jsonb_object_agg(month, cnt) FROM (
        SELECT month, SUM(cnt) AS cnt FROM (
          SELECT jsonb_each_text(by_month) AS month, cnt FROM case_stats_mv
          WHERE tenant_id = v_tenant_id
            AND (p_resident_id IS NULL OR resident_id = p_resident_id)
        ) sub GROUP BY month ORDER BY month
      ) sub2), '{}'::jsonb
    ),
    'pending_approvals', COALESCE((
      SELECT COUNT(*) FROM case_entries ce
      WHERE ce.tenant_id = v_tenant_id
        AND ce.deleted_at IS NULL
        AND ce.status = 'pending'
    ), 0),
    'rejection_rate', CASE
      WHEN (SELECT COUNT(*) FROM case_entries ce
        WHERE ce.tenant_id = v_tenant_id
          AND ce.deleted_at IS NULL
          AND ce.status IN ('approved', 'rejected')) > 0
      THEN ROUND(
        (SELECT COUNT(*) FROM case_entries ce
          WHERE ce.tenant_id = v_tenant_id
            AND ce.deleted_at IS NULL
            AND ce.status = 'rejected')::NUMERIC
        / (SELECT COUNT(*) FROM case_entries ce
            WHERE ce.tenant_id = v_tenant_id
              AND ce.deleted_at IS NULL
              AND ce.status IN ('approved', 'rejected'))::NUMERIC * 100, 2
      )
      ELSE 0
    END
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;