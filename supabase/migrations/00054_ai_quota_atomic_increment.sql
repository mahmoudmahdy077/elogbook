-- ============================================================================
-- 00054_ai_quota_atomic_increment.sql
--
-- Phase 2 / P2.2
--
-- Atomic AI quota enforcement. The previous code path:
--
--   1. Read quota_used and quota_limit
--   2. Check quota_used >= quota_limit (race condition: two concurrent
--      requests both pass the check)
--   3. Read/insert the AI response
--   4. UPDATE quota_used = quota_used + 1
--
-- was non-atomic and the check was never followed by an increment in
-- the migration set (audit findings flagged quota_used as never
-- incremented). This migration:
--
--   1. Creates a SECURITY DEFINER function `consume_ai_quota` that
--      performs the check + increment in a single UPDATE statement.
--      The function is the ONLY way to consume quota.
--   2. Creates `grant_ai_quota` to reset quota (for admin/payment).
--   3. Revokes the prior direct UPDATE on resident_ai_toggle from
--      authenticated (only the function can mutate it now).
--
-- Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. consume_ai_quota(p_resident_id, p_count) — atomic check + increment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_ai_quota(
  p_resident_id UUID,
  p_count INT DEFAULT 1
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_new_used INT;
  v_limit INT;
  v_enabled BOOLEAN;
  v_actor_id UUID := auth.uid();
  v_owner_profile_id UUID;
BEGIN
  -- Caller must be authenticated.
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthenticated', 'code', 'auth');
  END IF;

  -- The resident_id must belong to the caller (or caller is supervisor+
  -- on the same tenant — that gate is enforced at the edge function;
  -- here we allow same-tenant supervisor+ by checking role).
  SELECT id INTO v_owner_profile_id FROM public.profiles WHERE user_id = v_actor_id LIMIT 1;
  IF v_owner_profile_id IS NULL OR v_owner_profile_id != p_resident_id THEN
    IF get_user_role() NOT IN ('supervisor', 'director', 'institution_admin', 'admin') THEN
      RETURN jsonb_build_object('error', 'cannot consume quota for another resident', 'code', 'forbidden');
    END IF;
    -- For supervisor+ acting on behalf, still require same tenant.
    IF NOT EXISTS (
      SELECT 1 FROM public.resident_ai_toggle r
      WHERE r.resident_id = p_resident_id
        AND r.tenant_id = get_tenant_id()
    ) THEN
      RETURN jsonb_build_object('error', 'cross-tenant quota consumption', 'code', 'forbidden');
    END IF;
  END IF;

  -- Atomic check + increment.
  UPDATE public.resident_ai_toggle
     SET quota_used = quota_used + p_count,
         updated_at = now()
   WHERE resident_id = p_resident_id
     AND enabled = true
     AND (quota_limit = 0 OR quota_used + p_count <= quota_limit)
  RETURNING quota_used, quota_limit, enabled
    INTO v_new_used, v_limit, v_enabled;

  IF NOT FOUND THEN
    -- Either the toggle doesn't exist, AI is disabled, or quota exhausted.
    RETURN jsonb_build_object('error', 'quota exceeded or ai disabled', 'code', 'quota_exceeded', 'quota_used', 0, 'quota_limit', 0);
  END IF;

  RETURN jsonb_build_object('success', true, 'code', 'ok', 'quota_used', v_new_used, 'quota_limit', v_limit);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_ai_quota FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. grant_ai_quota — admin-only quota reset / top-up
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_ai_quota(
  p_resident_id UUID,
  p_new_limit INT,
  p_reset BOOLEAN DEFAULT true
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_role TEXT := get_user_role();
BEGIN
  IF v_actor_role NOT IN ('director', 'institution_admin', 'admin') THEN
    RETURN jsonb_build_object('error', 'forbidden', 'code', 'forbidden');
  END IF;

  UPDATE public.resident_ai_toggle
     SET quota_limit = p_new_limit,
         quota_used = CASE WHEN p_reset THEN 0 ELSE quota_used END,
         enabled = true,
         updated_at = now()
   WHERE resident_id = p_resident_id
     AND tenant_id = get_tenant_id();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'resident not found in tenant', 'code', 'not_found');
  END IF;

  RETURN jsonb_build_object('success', true, 'resident_id', p_resident_id, 'quota_limit', p_new_limit);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_ai_quota FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_ai_quota TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Lock down direct writes — only the SECURITY DEFINER functions can
--    modify quota_used.
-- ---------------------------------------------------------------------------
-- (Policies on resident_ai_toggle are defined in 00002. We additionally
-- revoke UPDATE at the privilege level for non-service roles.)
REVOKE UPDATE ON public.resident_ai_toggle FROM authenticated;
-- RLS policies still permit reads. The functions above operate
-- SECURITY DEFINER (owner-bypasses-RLS) and re-verify authorization
-- in their bodies.
