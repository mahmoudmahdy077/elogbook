-- ============================================================================
-- 20260822000000_set_user_consent_rpc.sql
--
-- Adds the missing set_user_consent RPC used by the consent management UI
-- (apps/web/app/(authenticated)/[tenant]/consent/ConsentRow.tsx).
--
-- Bug context (50-cycle production-readiness run, Cycle 2):
--   The client called supabase.rpc('set_user_consent', ...) but no such
--   function existed in any prior migration. Every toggle fell back to a
--   direct insert that omitted NOT NULL user_id — so consent toggling was
--   completely broken at runtime.
--
-- Semantics match the read model in consent/page.tsx: append-only rows,
-- latest row per (user, type) wins, revoked_at IS NULL means granted.
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
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_user_id AND p.tenant_id = p_tenant_id
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
