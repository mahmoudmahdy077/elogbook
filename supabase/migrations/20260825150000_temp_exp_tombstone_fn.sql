-- TEMP diagnostic v5: impersonated tombstone experiments, returned as JSONB.
CREATE OR REPLACE FUNCTION public.debug_exp_tombstone()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, extensions AS $$
DECLARE
  v_uid UUID := 'f2a0d3a0-b3a0-4026-bdfa-ba0a4688a783';
  v_tenant UUID := '9cd50d60-febe-4adf-be0f-a36bf82762f6';
  v_claims JSONB := jsonb_build_object('aud','authenticated','role','authenticated','sub',v_uid,
    'app_metadata', jsonb_build_object('tenant_id',v_tenant,'user_role','resident'));
  v_pid UUID; v_tmpl UUID; v_id UUID;
  v_out JSONB := '[]'::jsonb;
  v_step TEXT; v_ok BOOL; v_state TEXT; v_msg TEXT;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE user_id = v_uid;
  SELECT id INTO v_tmpl FROM public.case_templates LIMIT 1;

  v_step := 'policies';
  BEGIN
    v_out := v_out || jsonb_build_array(jsonb_build_object('step', v_step, 'data',
      (SELECT jsonb_agg(jsonb_build_object('name',policyname,'cmd',cmd,'permissive',permissive))
       FROM pg_policies WHERE schemaname='public' AND tablename='case_entries')));
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object('step', v_step, 'err', SQLERRM));
  END;

  v_step := 'seed';
  IF v_pid IS NOT NULL THEN
    INSERT INTO public.case_entries (tenant_id,resident_id,template_id,case_date,field_values,status,accreditation_mappings,is_deidentified,patient_mrn,patient_dob,patient_age_years,patient_hash)
  VALUES (v_tenant,v_pid,v_tmpl,CURRENT_DATE,jsonb_build_object('procedure_name','exp5'),'draft','[]'::jsonb,TRUE,NULL,NULL,NULL,'x')
  RETURNING id INTO v_id;
  END IF;
  v_out := v_out || jsonb_build_array(jsonb_build_object('step','seed','id',v_id));

  v_step := 'set-role';
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims::text, true);
  v_out := v_out || jsonb_build_array(jsonb_build_object('step','set-role','ok',TRUE));

  v_step := 'partial-tombstone';
  BEGIN
    UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_id;
    v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; v_state := SQLSTATE; v_msg := SQLERRM; END;
  v_out := v_out || jsonb_build_array(jsonb_build_object('step',v_step,'ok',v_ok,'state',v_state,'msg',v_msg));
  v_state := NULL; v_msg := NULL;

  v_step := 'content-edit-control';
  BEGIN
    UPDATE public.case_entries SET field_values = jsonb_build_object('procedure_name','exp5-edit') WHERE id = v_id;
    v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; v_state := SQLSTATE; v_msg := SQLERRM; END;
  v_out := v_out || jsonb_build_array(jsonb_build_object('step',v_step,'ok',v_ok,'state',v_state,'msg',v_msg));

  RESET ROLE;
  -- cleanup seeded row regardless
  DELETE FROM public.case_entries WHERE id = v_id;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.debug_exp_tombstone() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debug_exp_tombstone() TO service_role;
