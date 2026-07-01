-- ============================================================================
-- 00066_performance_indexes.sql
--
-- Phase 6 — Performance to Enterprise Standard
-- Closes HIGH-priority index gaps and removes orphaned schema objects.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop orphaned materialized view + refresh function
--    case_stats_mv was replaced by get_case_stats() RPC in 00055; the MV
--    and its refresh function are dead schema objects.  Must drop before
--    referencing FK-adjacent objects (none in this case — MV has no FK refs).
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS public.case_stats_mv CASCADE;
DROP FUNCTION IF EXISTS public.refresh_case_stats_mv();

-- ---------------------------------------------------------------------------
-- 2. Missing compound index: profiles(tenant_id, role)
--    Every supervisor/director lookup (case submission, dashboard) filters
--    by tenant_id then role IN (...).  Without this, every query does a
--    sequential scan filtered by tenant alone.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_role
  ON public.profiles(tenant_id, role);

-- ---------------------------------------------------------------------------
-- 3. Missing compound index: audit_logs(tenant_id, created_at)
--    Every audit-trail page queries WHERE tenant_id = ? ORDER BY created_at DESC.
--    Individual indexes exist on each column; a compound B-tree index allows
--    index-only scans for the most common audit page query.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
  ON public.audit_logs(tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Missing index: approval_requests(tenant_id)
--    tenant_id was added to approval_requests in 00028 and used in RLS
--    policies, but no single-column index exists.  Every RLS check forces
--    a sequential scan.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_approval_requests_tenant
  ON public.approval_requests(tenant_id);
