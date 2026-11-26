-- ============================================================================
-- 20261126000700_submit_case_rpc.sql
--
-- The 20261126000500 policy let an individual-tenant resident set
-- status='approved' directly on their own row. That is their own data, but it
-- bypassed the submit route's checks (lapsed-subscription gate) and the
-- case.submitted webhook, and it made "approved" a client-writable state.
--
-- Fix: residents may again only write draft/pending through PostgREST, and the
-- draft -> submitted transition moves into a SECURITY DEFINER RPC that owns
-- the checks: caller identity, ownership, current state, and subscription.
-- The auto-approve trigger still turns pending -> approved for individual
-- tenants inside the RPC.
--
-- destructive: no — policy restored, one function added.
-- ============================================================================

DROP POLICY IF EXISTS "residents update own draft or rejected entries" ON public.case_entries;
CREATE POLICY "residents update own draft or rejected entries" ON public.case_entries
  FOR UPDATE TO authenticated
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
    AND status IN ('draft', 'pending')
  );

CREATE OR REPLACE FUNCTION public.submit_case(p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_entry   public.case_entries%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_role    text;
  v_status  text;
  v_sub     text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_entry
  FROM public.case_entries
  WHERE id = p_entry_id AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '42501';
  END IF;

  v_role := COALESCE(v_profile.role, 'resident');

  IF v_profile.id <> v_entry.resident_id
     AND v_role NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
    RAISE EXCEPTION 'you can only submit your own draft cases' USING ERRCODE = '42501';
  END IF;

  IF v_profile.tenant_id <> v_entry.tenant_id THEN
    RAISE EXCEPTION 'cross-tenant submit denied' USING ERRCODE = '42501';
  END IF;

  IF v_entry.status <> 'draft' THEN
    RAISE EXCEPTION 'case is not a draft (status=%)', v_entry.status USING ERRCODE = '22000';
  END IF;

  SELECT status INTO v_sub FROM public.subscriptions WHERE tenant_id = v_entry.tenant_id LIMIT 1;
  IF v_sub IN ('past_due', 'unpaid') THEN
    RAISE EXCEPTION 'subscription lapsed — case submission disabled' USING ERRCODE = '42501';
  END IF;

  UPDATE public.case_entries
     SET status = 'pending'
   WHERE id = v_entry.id
  RETURNING status INTO v_status;

  RETURN jsonb_build_object(
    'status', v_status,
    'auto_approved', v_status = 'approved'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_case(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_case(uuid) TO authenticated;
