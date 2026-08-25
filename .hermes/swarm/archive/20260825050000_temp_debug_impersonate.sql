-- TEMPORARY diagnostic v2 (service_role only): impersonate resident and try
-- the tombstone + dump per-predicate values.
CREATE OR REPLACE FUNCTION public.debug_swarm_introspect(p_mode TEXT DEFAULT 'all', p_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_uid UUID := 'f2a0d3a0-b3a0-4026-bdfa-ba0a4688a783'; -- resident@demo.com
  v_tenant UUID := '9cd50d60-febe-4adf-be0f-a36bf82762f6';
  v_claims JSONB := jsonb_build_object(
    'aud','authenticated', 'role','authenticated', 'sub', v_uid,
    'app_metadata', jsonb_build_object('tenant_id', v_tenant, 'user_role','resident'));
  v_pid UUID; v_gtid UUID; v_res JSONB;
BEGIN
  IF p_mode = 'tombstone' THEN
    PERFORM set_config('role','authenticated', true);
    PERFORM set_config('request.jwt.claims', v_claims::text, true);
    BEGIN
      UPDATE case_entries SET deleted_at = NOW() WHERE id = p_id AND tenant_id = v_tenant;
      v_res := jsonb_build_object('ok', TRUE);
    EXCEPTION WHEN OTHERS THEN
      v_res := jsonb_build_object('ok', FALSE, 'sqlstate', SQLSTATE, 'errmsg', SQLERRM);
    END;
    RETURN jsonb_build_object('mode','tombstone','result', v_res);
  END IF;

  -- default: predicate diagnostics under impersonation
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims::text, true);
  SELECT id INTO v_pid FROM profiles WHERE user_id = v_uid;
  v_gtid := get_tenant_id();
  RETURN jsonb_build_object(
    'profile_id', v_pid,
    'get_tenant_id', v_gtid,
    'auth_uid_matches', (SELECT user_id FROM profiles WHERE id = v_pid) = v_uid
  );
END $$;

REVOKE ALL ON FUNCTION public.debug_swarm_introspect(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debug_swarm_introspect(TEXT, UUID) TO service_role;
