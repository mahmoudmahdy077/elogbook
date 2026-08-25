-- TEMPORARY diagnostic v3: run tombstone as impersonated resident INSIDE migration,
-- persist step-by-step results to a debug table.
CREATE TABLE IF NOT EXISTS public._swarm_debug_results(line INT PRIMARY KEY, payload JSONB);
DELETE FROM public._swarm_debug_results;

DO $$
DECLARE
  v_uid UUID := 'f2a0d3a0-b3a0-4026-bdfa-ba0a4688a783';
  v_tenant UUID := '9cd50d60-febe-4adf-be0f-a36bf82762f6';
  v_claims JSONB := jsonb_build_object('aud','authenticated','role','authenticated','sub',v_uid,
    'app_metadata', jsonb_build_object('tenant_id',v_tenant,'user_role','resident'));
  v_pid UUID; v_tmpl UUID; v_id UUID;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE user_id = v_uid;
  SELECT id INTO v_tmpl FROM public.case_templates WHERE tenant_id = '00000000-0000-0000-0000-000000000000' LIMIT 1;

  INSERT INTO public.case_entries (tenant_id,resident_id,template_id,case_date,field_values,status,accreditation_mappings,is_deidentified,patient_mrn,patient_dob,patient_age_years,patient_hash)
  VALUES (v_tenant,v_pid,v_tmpl,CURRENT_DATE,jsonb_build_object('procedure_name','dbg'),'approved','[]'::jsonb,TRUE,NULL,NULL,NULL,'x')
  RETURNING id INTO v_id;
  INSERT INTO public._swarm_debug_results VALUES (0, jsonb_build_object('case',v_id));

  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims::text, true);

  -- predicate diagnostics under impersonation
  DECLARE p1 BOOL; p2 BOOL; p3 BOOL; g UUID;
  BEGIN
    SELECT get_tenant_id() INTO g;
    SELECT (deleted_at IS NULL) INTO p1 FROM public.case_entries WHERE id = v_id;
    INSERT INTO public._swarm_debug_results VALUES (2, jsonb_build_object('get_tenant_id',g,'row_deleted_at_null',p1));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (2, jsonb_build_object('pred_err',SQLERRM));
  END;

  BEGIN
    UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_id AND tenant_id = v_tenant;
    INSERT INTO public._swarm_debug_results VALUES (3, jsonb_build_object('update','OK'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (3, jsonb_build_object('update','FAIL','state',SQLSTATE,'msg',SQLERRM));
  END;
END $$;

GRANT SELECT ON public._swarm_debug_results TO service_role;
