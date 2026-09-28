-- ============================================================================
-- 20260926000003_consent_tenant_authority.sql
--
-- consent_records: bind the write path to the caller's authoritative tenant.
--
-- Root cause this migration closes
-- ------------------------------
-- 00013 created the insert policy with `user_id` as the only predicate:
--
--   policy "Users can insert own consent records"
--     ON consent_records FOR INSERT
--     WITH CHECK (user_id = auth.uid());
--
-- `user_id` was the only predicate, and `tenant_id` was a free column on the
-- row. Any authenticated principal could therefore write a consent record into
-- an arbitrary tenant:
--
--   POST /rest/v1/consent_records
--   {"tenant_id":"<any tenant>","user_id":"<own uid>","consent_type":"ai_insights"}
--
-- The row is a compliance artifact. A forged row makes a tenant look as if a
-- user consented to AI processing or data export when they never did, and the
-- compliance export (apps/web/app/api/[tenant]/compliance/export/route.ts)
-- reports the forged grant as fact.
--
-- The tenant-binding client fallback in
-- apps/web/app/(authenticated)/[tenant]/consent/ConsentRow.tsx sent the
-- tenant_id straight from the request, so the forgery was reachable from the
-- shipped UI, not just from a hand-rolled request.
--
-- Fix
-- ---
-- 1. The insert policy resolves the caller's tenant from their own profile
--    row. tenant_id is no longer caller-supplied authority.
-- 2. Direct INSERT is revoked from anon and authenticated, so the only write
--    path is public.set_user_consent(), which is SECURITY DEFINER and already
--    verifies membership (20260824140000) before writing.
-- 3. The read model is untouched: SELECT stays with authenticated, so the
--    consent page and the compliance export keep working under RLS.
--
-- Forward-only. No applied history is edited; this converges the final state.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Replace the unbound insert policy with a tenant-bound one.
--
-- profiles.user_id is the FK to auth.users; profiles.id is the profile
-- surrogate key. The join must use user_id (same correction as
-- 20260824140000_fix_set_user_consent_profile_join.sql).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can insert own consent records" ON public.consent_records;

CREATE POLICY "Users insert own consent records in own tenant"
  ON public.consent_records
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = (
      SELECT p.tenant_id
      FROM public.profiles AS p
      WHERE p.user_id = auth.uid()
      LIMIT 1
    )
    AND tenant_id IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 2. The consent RPC is the only write path.
--
-- public.set_user_consent is SECURITY DEFINER, so the table-level privilege
-- revoked here does not affect it. anon never had business calling it and
-- service_role is excluded so a compromised backend client cannot mint consent
-- rows on a tenant's behalf.
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.consent_records FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.consent_records TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. set_user_consent: unchanged semantics, authoritative grants.
--
-- SECURITY DEFINER verifies the caller belongs to p_tenant_id through
-- profiles.user_id = auth.uid() before writing, so the row it inserts already
-- carries the authoritative tenant. Re-declared here so the function body and
-- its grants converge in one forward-only place.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_consent(
  p_tenant_id UUID,
  p_consent_type TEXT,
  p_grant BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- Must match consent_records_consent_type_check (00013 + 00060).
  IF p_consent_type NOT IN (
    'data_processing', 'ai_insights', 'data_export', 'marketing',
    'research', 'analytics', 'data_sharing'
  ) THEN
    RAISE EXCEPTION 'invalid_consent_type' USING ERRCODE = '42501';
  END IF;

  -- Defense in depth: SECURITY DEFINER bypasses RLS, so verify membership
  -- explicitly. profiles.user_id references auth.users.id; profiles.id does not.
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = v_user_id
      AND p.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'tenant_mismatch' USING ERRCODE = '42501';
  END IF;

  -- tenant_id is taken from the caller's own profile, never from the payload.
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

REVOKE ALL ON FUNCTION public.set_user_consent(UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_user_consent(UUID, TEXT, BOOLEAN) TO authenticated;
