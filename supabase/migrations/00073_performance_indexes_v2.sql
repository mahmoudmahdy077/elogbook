-- ============================================================================
-- 00073_performance_indexes_v2.sql
--
-- Phase 7 — Second wave of performance indexes for query optimization.
-- Closes HIGH- and MEDIUM-priority index gaps identified by analyzing
-- dashboard queries, approval workflows, RLS policy patterns, and
-- scheduled batch jobs against production query patterns.
--
-- Every index below was identified by tracing real application queries
-- (page.tsx, ApprovalsDashboard.tsx, trigger functions, RLS policies)
-- and matching against the existing index catalog.
-- ============================================================================

-- ============================================================================
-- 1. goal_progress(resident_id)
--    Dashboard (page.tsx line 91): queries goal_progress by resident_id
--    for each resident to display progress toward program goals.
--    The table has ZERO indexes besides the implicit PK and FK-UNIQUE
--    on goal_id — every resident query forces a sequential scan.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_goal_progress_resident
  ON public.goal_progress(resident_id);

-- ============================================================================
-- 2. case_entries(tenant_id, status, created_at DESC) WHERE deleted_at IS NULL
--    ApprovalsDashboard (line 97-99): fetches pending entries ordered by
--    created_at DESC within a tenant. The existing
--    idx_case_entries_tenant_status (from 00011) covers tenant + status
--    but lacks the ORDER BY column, forcing a filesort of matching rows.
--    This partial index lets PostgreSQL return rows in ORDER BY order
--    directly from the index, skipping both the sort and soft-deleted rows.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_case_entries_tenant_status_created
  ON public.case_entries(tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- 3. case_entries(tenant_id, status) WHERE deleted_at IS NULL (partial)
--    Dashboard (page.tsx lines 69-72): runs count(*) queries with
--    .eq('tenant_id', tenantId).eq('status', X).is('deleted_at', null).
--    Existing idx_case_entries_tenant_status is NOT a partial index, so
--    it includes soft-deleted rows. This compact partial index serves
--    exactly the rows the count queries need — smaller B-tree, faster scans.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_case_entries_tenant_status_active
  ON public.case_entries(tenant_id, status)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- 4. one_time_purchases(tenant_id)
--    tenant_id was added to one_time_purchases in 00028 for direct RLS
--    tenant isolation, but NO index was created. Every RLS check +
--    supervisor/read query filters by tenant_id.
--    The only existing index is idx_one_time_purchases_resident (00029).
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_one_time_purchases_tenant
  ON public.one_time_purchases(tenant_id);

-- ============================================================================
-- 5. case_attachments(tenant_id)
--    Same pattern as #4: tenant_id added in 00028 for RLS, no index.
--    Every case_attachments query evaluates a USING (tenant_id = ...)
--    RLS clause. Without this index, every access does a seq scan.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_case_attachments_tenant
  ON public.case_attachments(tenant_id);

-- ============================================================================
-- 6. subscriptions(tenant_id, created_at DESC)
--    block_lapsed_tenant_submit() trigger (00055, line 280) runs:
--      SELECT s.status, t.tenant_type FROM subscriptions s
--      JOIN tenants t ON t.id = s.tenant_id
--      WHERE s.tenant_id = NEW.tenant_id
--      ORDER BY s.created_at DESC LIMIT 1;
--    The existing idx_subscriptions_tenant_status only covers
--    (tenant_id, status) — no created_at ordering, so PostgreSQL must
--    sort all matching rows to pick the latest one.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_created
  ON public.subscriptions(tenant_id, created_at DESC);

-- ============================================================================
-- 7. faculty_evaluations(evaluator_id)
--    The RLS policy (00072) references evaluator_id in subqueries:
--      tenant_id = (SELECT tenant_id FROM profiles WHERE id = evaluator_id)
--    No index on evaluator_id exists — every evaluation lookup for
--    write-check performs a sequential scan on the profiles table.
--    Additionally, the view resident_evaluation_averages GROUP BY
--    resident_id, so compound indexes help there too.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_faculty_evaluations_evaluator
  ON public.faculty_evaluations(evaluator_id);

-- ============================================================================
-- 8. faculty_evaluations(tenant_id, resident_id)
--    The view resident_evaluation_averages groups by resident_id and
--    RLS filters by tenant_id. A compound index lets PostgreSQL
--    satisfy both conditions efficiently for aggregate queries.
--    Existing single-column indexes are less selective.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_faculty_evaluations_tenant_resident
  ON public.faculty_evaluations(tenant_id, resident_id);

-- ============================================================================
-- 9. ai_config(tenant_id) WHERE is_active = true (partial)
--    Common application query: "find the active AI config for this tenant"
--    (ai_config has UNIQUE(tenant_id) which gives a full index, but most
--    tenants have only one active config. The partial index is ~1/N the size.)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ai_config_tenant_active
  ON public.ai_config(tenant_id)
  WHERE is_active = true;

-- ============================================================================
-- 10. payment_gateway_config(tenant_id) WHERE is_active = true (partial)
--     Same pattern as #9: most tenants have one active payment config.
--     Queried during checkout/purchase flows by tenant_id + is_active.
--     UNIQUE(tenant_id) exists but lacks the is_active filter.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_payment_gateway_config_tenant_active
  ON public.payment_gateway_config(tenant_id)
  WHERE is_active = true;

-- ============================================================================
-- 11. consent_records(tenant_id, consent_type, granted_at DESC)
--     enforce_data_retention() deletes consent_records WHERE granted_at < cutoff,
--     and admin UIs query by tenant_id + consent_type for consent dashboards.
--     Existing index on (tenant_id, user_id) doesn't help type-filtered queries.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_consent_records_tenant_type_granted
  ON public.consent_records(tenant_id, consent_type, granted_at DESC);

-- ============================================================================
-- 12. profiles(tenant_id) WHERE role = 'resident' AND deleted_at IS NULL
--     Dashboard (page.tsx lines 106-110): profiles query:
--       .select('id, full_name, specialty')
--       .eq('tenant_id', tenantId)
--       .eq('role', 'resident')
--     The existing idx_profiles_tenant_role (00066) covers (tenant_id, role)
--     but is NOT a partial index — it includes deleted supervisors/directors.
--     This smaller partial index serves exactly the resident-list query.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_active_resident
  ON public.profiles(tenant_id)
  WHERE role = 'resident' AND deleted_at IS NULL;

-- ============================================================================
-- 13. duty_periods(tenant_id, resident_id, shift_date) INCLUDE (hours_worked)
--     The duty_weekly_violations view (00069/00071) does:
--       SELECT tenant_id, resident_id, week_start, SUM(hours_worked)
--       FROM (SELECT ..., DATE_TRUNC('week', shift_date) AS week_start, ...)
--       GROUP BY tenant_id, resident_id, week_start
--     Dashboard queries filter by resident_id or tenant_id, then the view
--     scans all matching duty_periods to compute SUM. This covering index
--     allows index-only scans for the view query — no heap lookups needed.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_duty_periods_tenant_resident_shift
  ON public.duty_periods(tenant_id, resident_id, shift_date)
  INCLUDE (hours_worked);

-- ============================================================================
-- 14. program_goals(director_id)
--     Directors query their own created goals and the RLS checks reference
--     director_id. No index exists for director-based filtering; the only
--     program_goals index is the compound idx_program_goals_tenant_resident.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_program_goals_director
  ON public.program_goals(director_id);

-- ============================================================================
-- 15. ai_query_logs(tenant_id, created_at DESC)
--     enforce_data_retention() (00055, line 367) deletes ai_query_logs
--     WHERE created_at < v_cutoff. When scanning across all tenants,
--     this needs an efficient range scan on created_at. Existing indexes
--     only cover created_at broadly, not per-tenant ordering for
--     individual tenant purge queries.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_tenant_created
  ON public.ai_query_logs(tenant_id, created_at DESC);

-- ============================================================================
-- 16. resident_ai_toggle(tenant_id)
--     Admin UIs list AI toggles per tenant to see which residents have
--     AI enabled/disabled. The UNIQUE(tenant_id, resident_id) index
--     works but is resident-centric; this index speeds up tenant-level
--     aggregation queries.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_resident_ai_toggle_tenant
  ON public.resident_ai_toggle(tenant_id);

-- ============================================================================
-- Summary of indexes created
-- ============================================================================
-- 1  idx_goal_progress_resident                    goal_progress(resident_id)
-- 2  idx_case_entries_tenant_status_created        case_entries(tenant_id, status, created_at DESC) WHERE deleted_at IS NULL
-- 3  idx_case_entries_tenant_status_active          case_entries(tenant_id, status) WHERE deleted_at IS NULL
-- 4  idx_one_time_purchases_tenant                 one_time_purchases(tenant_id)
-- 5  idx_case_attachments_tenant                   case_attachments(tenant_id)
-- 6  idx_subscriptions_tenant_created               subscriptions(tenant_id, created_at DESC)
-- 7  idx_faculty_evaluations_evaluator              faculty_evaluations(evaluator_id)
-- 8  idx_faculty_evaluations_tenant_resident         faculty_evaluations(tenant_id, resident_id)
-- 9  idx_ai_config_tenant_active                    ai_config(tenant_id) WHERE is_active = true
-- 10 idx_payment_gateway_config_tenant_active        payment_gateway_config(tenant_id) WHERE is_active = true
-- 11 idx_consent_records_tenant_type_granted         consent_records(tenant_id, consent_type, granted_at DESC)
-- 12 idx_profiles_tenant_active_resident             profiles(tenant_id) WHERE role = 'resident' AND deleted_at IS NULL
-- 13 idx_duty_periods_tenant_resident_shift          duty_periods(tenant_id, resident_id, shift_date) INCLUDE (hours_worked)
-- 14 idx_program_goals_director                      program_goals(director_id)
-- 15 idx_ai_query_logs_tenant_created                ai_query_logs(tenant_id, created_at DESC)
-- 16 idx_resident_ai_toggle_tenant                   resident_ai_toggle(tenant_id)
