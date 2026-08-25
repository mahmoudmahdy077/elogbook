-- ============================================================================
-- 20260825010000_reassert_case_soft_delete_policies.sql
--
-- Swarm Wave-1 finding F2 (P2): resident/supervisor REST tombstones on
-- case_entries return 42501 even though 20260824040000 created matching
-- policies. Live behavior contradicts migration state -> policy set drifted.
-- This migration deterministically re-asserts ALL FOUR intended UPDATE
-- policies (same shapes as the consolidation, re-applied idempotently).
-- ============================================================================

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='case_entries' AND cmd='UPDATE'
      AND policyname IN (
        'residents update own draft or rejected entries',
        'supervisor+ update pending tenant entries',
        'residents soft delete own entries',
        'supervisor+ soft delete tenant entries'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.case_entries', pol.policyname);
  END LOOP;
END $$;

-- 1. Resident: edit own draft/rejected
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

-- 2. Supervisor+: review pending tenant entries
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

-- 3. Resident: pure tombstone of own entry (any status)
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

-- 4. Supervisor+: pure tombstone of any tenant entry
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
