-- 20260812150000_release_ai_quota.sql
-- S8 companion: consume_ai_quota() is atomic; when the provider call fails
-- after consumption, release the reservation.

CREATE OR REPLACE FUNCTION public.release_ai_quota(
  p_resident_id UUID,
  p_count INT DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_owner_profile_id UUID;
  v_new_used INT;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated', 'code', 'auth');
  END IF;

  SELECT id INTO v_owner_profile_id FROM public.profiles WHERE user_id = v_actor_id LIMIT 1;
  IF v_owner_profile_id IS NULL OR v_owner_profile_id != p_resident_id THEN
    IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
      RETURN jsonb_build_object('error', 'cannot release quota for another resident', 'code', 'forbidden');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.resident_ai_toggle r
      WHERE r.resident_id = p_resident_id
        AND r.tenant_id = get_tenant_id()
    ) THEN
      RETURN jsonb_build_object('error', 'cross-tenant quota release', 'code', 'forbidden');
    END IF;
  END IF;

  UPDATE public.resident_ai_toggle
     SET quota_used = GREATEST(0, quota_used - p_count),
         updated_at = now()
   WHERE resident_id = p_resident_id
   RETURNING quota_used INTO v_new_used;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'resident not found', 'code', 'not_found');
  END IF;

  RETURN jsonb_build_object('success', true, 'code', 'ok', 'quota_used', v_new_used);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_ai_quota(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_ai_quota(UUID, INT) TO authenticated;
