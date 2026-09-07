-- ============================================================================
-- 20260907000007_reconcile_case_update_policies.sql
--
-- Deterministic convergence for case_entries UPDATE policies (T08).
-- The 2026-08-25 temporary diagnostic migrations drop and recreate these
-- policies around impersonated experiments; on a fresh replay their
-- restore loops can silently skip (NULL WITH CHECK renders EXECUTE a
-- no-op) or leave debug policies (p_v/p_ab) behind, and one file drops
-- without restoring at all. Rather than trusting whatever survived,
-- re-assert the exact canonical set from 20260825010000 (the definition
-- 20260825320000 only warns about). DROP+CREATE makes the outcome
-- identical on fresh installs and drifted databases alike. History is
-- untouched; this is convergence, not a rewrite.
-- ============================================================================

DROP POLICY IF EXISTS p_v ON public.case_entries;
DROP POLICY IF EXISTS p_ab ON public.case_entries;
DROP POLICY IF EXISTS "residents update own draft or rejected entries" ON public.case_entries;
DROP POLICY IF EXISTS "supervisor+ update pending tenant entries" ON public.case_entries;
DROP POLICY IF EXISTS "residents soft delete own entries" ON public.case_entries;
DROP POLICY IF EXISTS "supervisor+ soft delete tenant entries" ON public.case_entries;

CREATE POLICY "residents update own draft or rejected entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND status IN ('draft','rejected')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND deleted_at IS NULL
    AND ((status = 'draft') OR (status = 'pending'))
  );

CREATE POLICY "supervisor+ update pending tenant entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor','director','institution_admin','admin')
    AND status = 'pending'
    AND deleted_at IS NULL
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor','director','institution_admin','admin')
    AND deleted_at IS NULL
    AND status IN ('approved','rejected')
  );

CREATE POLICY "residents soft delete own entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND deleted_at IS NULL
  )
  WITH CHECK (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND deleted_at IS NOT NULL
  );

CREATE POLICY "supervisor+ soft delete tenant entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor','director','institution_admin','admin')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor','director','institution_admin','admin')
    AND deleted_at IS NOT NULL
  );
