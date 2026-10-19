CREATE TABLE IF NOT EXISTS public.ai_quota_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL,
  quota_count INTEGER NOT NULL CHECK (quota_count > 0 AND quota_count <= 1000),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'released')),
  quota_used_after INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  CHECK ((status = 'reserved' AND released_at IS NULL) OR (status = 'released' AND released_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_ai_quota_reservations_tenant_resident
  ON public.ai_quota_reservations (tenant_id, resident_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_quota_reservations_status
  ON public.ai_quota_reservations (status, created_at);

ALTER TABLE public.ai_quota_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_quota_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_quota_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ai_quota_reservations TO service_role;

DROP FUNCTION IF EXISTS public.release_ai_quota(UUID, INTEGER);

CREATE OR REPLACE FUNCTION public.consume_ai_quota(
  p_resident_id UUID,
  p_count INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_principal RECORD;
  v_target_tenant_id UUID;
  v_new_used INTEGER;
  v_limit INTEGER;
  v_reservation_id UUID;
BEGIN
  IF p_resident_id IS NULL OR p_count IS NULL OR p_count < 1 OR p_count > 1000 THEN
    RAISE EXCEPTION 'invalid quota request' USING ERRCODE = '22023';
  END IF;

  IF auth.uid() IS NULL OR auth.role() = 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated', 'code', 'auth');
  END IF;

  SELECT *
  INTO v_principal
  FROM public.get_authoritative_principal_with_aal()
  LIMIT 1;

  IF NOT FOUND
     OR v_principal.profile_id IS NULL
     OR v_principal.tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'principal_not_found', 'code', 'auth');
  END IF;
  IF v_principal.profile_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'account_suspended', 'code', 'account_suspended');
  END IF;
  IF v_principal.tenant_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'tenant_suspended', 'code', 'tenant_suspended');
  END IF;

  SELECT target_tenant.id
  INTO v_target_tenant_id
  FROM public.profiles AS target_profile
  INNER JOIN public.tenants AS target_tenant ON target_tenant.id = target_profile.tenant_id
  WHERE target_profile.id = p_resident_id
    AND target_profile.role = 'resident'
    AND target_profile.status = 'active'
    AND target_profile.deleted_at IS NULL
    AND target_tenant.status = 'active'
    AND target_tenant.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'resident_not_found', 'code', 'not_found');
  END IF;
  IF v_target_tenant_id IS DISTINCT FROM v_principal.tenant_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'cross_tenant_quota', 'code', 'forbidden');
  END IF;
  IF p_resident_id IS DISTINCT FROM v_principal.profile_id
     AND (
       v_principal.role NOT IN ('supervisor', 'director', 'institution_admin', 'admin')
       OR v_principal.aal IS DISTINCT FROM 'aal2'
       OR (v_principal.role = 'admin' AND NOT public.is_platform_admin())
     ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
  END IF;

  UPDATE public.resident_ai_toggle
  SET quota_used = quota_used + p_count
  WHERE resident_id = p_resident_id
    AND tenant_id = v_target_tenant_id
    AND enabled = TRUE
    AND (quota_limit = 0 OR quota_used + p_count <= quota_limit)
  RETURNING quota_used, quota_limit
  INTO v_new_used, v_limit;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'quota_exceeded_or_ai_disabled',
      'code', 'quota_exceeded',
      'quota_used', 0,
      'quota_limit', 0
    );
  END IF;

  v_reservation_id := gen_random_uuid();
  INSERT INTO public.ai_quota_reservations (
    id,
    tenant_id,
    resident_id,
    actor_profile_id,
    actor_user_id,
    quota_count,
    quota_used_after
  )
  VALUES (
    v_reservation_id,
    v_target_tenant_id,
    p_resident_id,
    v_principal.profile_id,
    v_principal.user_id,
    p_count,
    v_new_used
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'ok',
    'reservation_id', v_reservation_id,
    'resident_id', p_resident_id,
    'tenant_id', v_target_tenant_id,
    'actor_profile_id', v_principal.profile_id,
    'count', p_count,
    'quota_used', v_new_used,
    'quota_limit', v_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_quota(UUID, INTEGER) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_ai_quota(
  p_reservation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_reservation RECORD;
  v_actor_tenant_id UUID;
  v_new_used INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service-role operations context required' USING ERRCODE = '42501';
  END IF;
  IF p_reservation_id IS NULL THEN
    RAISE EXCEPTION 'invalid quota reservation' USING ERRCODE = '22023';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT profile.tenant_id
    INTO v_actor_tenant_id
    FROM public.profiles AS profile
    INNER JOIN public.tenants AS tenant ON tenant.id = profile.tenant_id
    WHERE profile.user_id = auth.uid()
      AND profile.status = 'active'
      AND profile.deleted_at IS NULL
      AND tenant.status = 'active'
      AND tenant.deleted_at IS NULL
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'forbidden');
    END IF;
  END IF;

  SELECT
    reservation.id,
    reservation.tenant_id,
    reservation.resident_id,
    reservation.quota_count,
    reservation.status
  INTO v_reservation
  FROM public.ai_quota_reservations AS reservation
  WHERE reservation.id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'reservation_not_found', 'code', 'not_found');
  END IF;
  IF v_actor_tenant_id IS NOT NULL
     AND v_actor_tenant_id IS DISTINCT FROM v_reservation.tenant_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'cross_tenant_release', 'code', 'forbidden');
  END IF;
  IF v_reservation.status = 'released' THEN
    RETURN jsonb_build_object(
      'success', true,
      'code', 'already_released',
      'reservation_id', p_reservation_id,
      'quota_used', (
        SELECT toggle.quota_used
        FROM public.resident_ai_toggle AS toggle
        WHERE toggle.tenant_id = v_reservation.tenant_id
          AND toggle.resident_id = v_reservation.resident_id
      )
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS target_profile
    INNER JOIN public.tenants AS target_tenant ON target_tenant.id = target_profile.tenant_id
    WHERE target_profile.id = v_reservation.resident_id
      AND target_profile.role = 'resident'
      AND target_profile.status = 'active'
      AND target_profile.deleted_at IS NULL
      AND target_tenant.id = v_reservation.tenant_id
      AND target_tenant.status = 'active'
      AND target_tenant.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'resident_not_found', 'code', 'not_found');
  END IF;

  UPDATE public.ai_quota_reservations
  SET status = 'released',
      released_at = now()
  WHERE id = p_reservation_id
    AND status = 'reserved';

  UPDATE public.resident_ai_toggle
  SET quota_used = GREATEST(0, quota_used - v_reservation.quota_count)
  WHERE tenant_id = v_reservation.tenant_id
    AND resident_id = v_reservation.resident_id
  RETURNING quota_used
  INTO v_new_used;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quota target not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'ok',
    'reservation_id', p_reservation_id,
    'quota_used', v_new_used
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_ai_quota(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ai_quota(UUID) TO service_role;
