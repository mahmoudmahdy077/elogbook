-- ============================================================================
-- 20260825220000_soft_delete_case_rpc.sql
--
-- Repair for the case_entries soft-delete gap: direct REST PATCH of
-- deleted_at fails with 42501 despite permissive UPDATE policies being
-- verbatim-correct (root cause under platform investigation - see
-- .hermes/swarm/state.json). The offline-sync path (sync_push_batch,
-- SECURITY DEFINER) has always worked.
--
-- This RPC gives web/admin a first-class, guaranteed soft-delete surface:
--   * resident may tombstone OWN case in OWN tenant (any status)
--   * supervisor+ may tombstone any case in OWN tenant
--   * pure tombstone only - clinical fields are untouched by construction
-- Idempotent: returns success for already-deleted rows.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_case(p_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_profile_id UUID;
  v_role TEXT;
  v_tenant_id UUID;
  v_row case_entries;
BEGIN
  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid();
  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  v_role := public.get_user_role();
  v_tenant_id := public.get_tenant_id();

  SELECT * INTO v_row FROM public.case_entries
   WHERE id = p_entry_id AND tenant_id = v_tenant_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    -- Distinguish already-deleted vs not-visible/not-found without leaking data
    IF EXISTS (SELECT 1 FROM public.case_entries
                WHERE id = p_entry_id AND tenant_id = v_tenant_id AND deleted_at IS NOT NULL) THEN
      RETURN jsonb_build_object('success', true, 'already_deleted', true);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF v_row.resident_id <> v_profile_id
     AND v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_row.id;

  RETURN jsonb_build_object('success', true, 'id', v_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_case(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_case(UUID) TO authenticated;
