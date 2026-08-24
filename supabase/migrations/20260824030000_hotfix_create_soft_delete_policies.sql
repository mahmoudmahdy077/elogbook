-- ============================================================================
-- HOTFIX follow-up to 20260824000000 (soft-delete policies never applied —
-- same recorded-migration drift as the write_once hotfix).
--
-- Creates the soft-delete RLS policies on case_entries:
--   - residents: tombstone their OWN entries (any status)
--   - supervisor+: tombstone any entry in their tenant
-- Both restricted to pure deleted_at transitions via the trigger, which now
-- permits them.
-- ============================================================================

DROP POLICY IF EXISTS "residents soft delete own entries" ON public.case_entries;
DROP POLICY IF EXISTS "supervisor+ soft delete tenant entries" ON public.case_entries;

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
    AND status IN ('draft', 'pending', 'approved', 'rejected')
  );

CREATE POLICY "supervisor+ soft delete tenant entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    AND deleted_at IS NOT NULL
    AND status IN ('draft', 'pending', 'approved', 'rejected')
  );
