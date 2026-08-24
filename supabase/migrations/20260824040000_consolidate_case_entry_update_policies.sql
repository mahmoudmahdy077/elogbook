-- ============================================================================
-- CONSOLIDATED case_entries UPDATE policies (replaces piecemeal attempts).
--
-- Context: cycles of hotfixes left the live policy set uncertain (a draft→
-- pending update that previously worked began failing). This migration
-- deterministically wipes ALL permissive UPDATE policies on case_entries and
-- creates exactly the intended set:
--
--   1. residents update own draft/rejected entries (pre-existing semantics)
--   2. supervisor+ approve/reject pending entries in tenant (pre-existing)
--   3. residents soft-delete own entries (new — fixes offline-sync tombstones)
--   4. supervisor+ soft-delete tenant entries (new)
--
-- Idempotent: safe to re-run.
-- ============================================================================

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_entries'
      AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.case_entries', pol.policyname);
  END LOOP;
END $$;

-- 1. Resident: edit own draft/rejected (draft→pending submit, rejected→draft resubmit)
CREATE POLICY "residents update own draft or rejected entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND status IN ('draft', 'rejected')
    AND deleted_at IS NULL
  )
  WITH CHECK (
    resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    AND tenant_id = get_tenant_id()
    AND deleted_at IS NULL
    AND (
      (status = 'draft')
      OR (status = 'pending')
    )
  );

-- 2. Supervisor+: review pending entries in tenant (approve/reject via RPC or direct)
CREATE POLICY "supervisor+ update pending tenant entries"
  ON public.case_entries FOR UPDATE TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    AND status = 'pending'
    AND deleted_at IS NULL
  )
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    AND deleted_at IS NULL
    AND status IN ('approved', 'rejected')
  );

-- 3. Resident: soft-delete own entry (any status) — pure tombstone enforced by trigger
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

-- 4. Supervisor+: soft-delete any tenant entry — pure tombstone enforced by trigger
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
  );
