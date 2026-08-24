-- ============================================================================
-- FIX: set_user_consent always fails with tenant_mismatch.
--
-- Found Cycle 44 (live probe): grant/revoke raise tenant_mismatch for a
-- legitimate resident whose JWT tenant matches p_tenant_id.
--
-- Root cause: the membership check joins profiles.id = auth.uid(), but in
-- this schema profiles.id is the PROFILES primary key, not the auth user id;
-- the correct column is profiles.user_id. Every legitimate call therefore
-- finds no matching profile and raises — consent toggling is broken at
-- runtime for all users (the exact bug this RPC was added to fix).
--
-- Fix: join on profiles.user_id = auth.uid().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_user_consent(
  p_tenant_id UUID,
  p_consent_type TEXT,
  p_grant BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Must match consent_records_consent_type_check (00013 + 00060).
  IF p_consent_type NOT IN (
    'data_processing', 'ai_insights', 'data_export', 'marketing',
    'research', 'analytics', 'data_sharing'
  ) THEN
    RAISE EXCEPTION 'invalid_consent_type';
  END IF;

  -- Defense in depth: caller must belong to the tenant (SECURITY DEFINER
  -- bypasses RLS, so verify membership explicitly).
  -- FIX: profiles.user_id references auth.users.id; profiles.id does NOT.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = v_user_id AND p.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'tenant_mismatch';
  END IF;

  INSERT INTO public.consent_records (tenant_id, user_id, consent_type, revoked_at)
  VALUES (
    p_tenant_id,
    v_user_id,
    p_consent_type,
    CASE WHEN p_grant THEN NULL ELSE NOW() END
  );

  RETURN json_build_object('success', TRUE, 'granted', p_grant);
END;
$$;
