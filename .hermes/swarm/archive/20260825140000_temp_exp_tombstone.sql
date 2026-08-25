-- TEMP diagnostic v4: impersonated tombstone experiment + full policy flags.
-- Runs as migration (postgres). Attempts SET ROLE authenticated (membership
-- permitting); captures exact failure; records permissive flags for every
-- case_entries policy; also tests whether an explicit full-column UPDATE
-- behaves differently from PostgREST's partial SET.
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
  SELECT id INTO v_tmpl FROM public.case_templates LIMIT 1;

  -- policy inventory incl. permissive flag
  INSERT INTO public._swarm_debug_results
  SELECT 0, jsonb_agg(jsonb_build_object(
    'name', policyname, 'cmd', cmd, 'permissive', permissive))
  FROM pg_policies WHERE schemaname='public' AND tablename='case_entries';

  -- seed draft case as postgres
  INSERT INTO public.case_entries (tenant_id,resident_id,template_id,case_date,field_values,status,accreditation_mappings,is_deidentified,patient_mrn,patient_dob,patient_age_years,patient_hash)
  VALUES (v_tenant,v_pid,v_tmpl,CURRENT_DATE,jsonb_build_object('procedure_name','exp4'),'draft','[]'::jsonb,TRUE,NULL,NULL,NULL,'x')
  RETURNING id INTO v_id;
  INSERT INTO public._swarm_debug_results VALUES (1, jsonb_build_object('case',v_id));

  BEGIN
    PERFORM set_config('role','authenticated', true);
    PERFORM set_config('request.jwt.claims', v_claims::text, true);
    INSERT INTO public._swarm_debug_results VALUES (2, jsonb_build_object('role-set','OK'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (2, jsonb_build_object('role-set','FAIL','msg',SQLERRM));
    RETURN;
  END;

  -- experiment A: partial SET (mimics PostgREST PATCH)
  BEGIN
    UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_id;
    INSERT INTO public._swarm_debug_results VALUES (3, jsonb_build_object('partial-tombstone','OK'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (3, jsonb_build_object('partial-tombstone','FAIL','state',SQLSTATE,'msg',SQLERRM));
  END;

  -- experiment B: explicit full-column UPDATE including deleted_at
  BEGIN
    UPDATE public.case_entries SET
      deleted_at=NOW(), tenant_id=v_tenant, resident_id=v_pid, template_id=(SELECT id FROM public.case_templates LIMIT 1),
      case_date=CURRENT_DATE, field_values=jsonb_build_object('procedure_name','exp4'), status='draft',
      accreditation_mappings='[]'::jsonb, is_deidentified=TRUE, patient_mrn=NULL, patient_dob=NULL,
      patient_age_years=NULL, patient_hash='x'
    WHERE id = v_id;
    INSERT INTO public._swarm_debug_results VALUES (4, jsonb_build_object('full-tombstone','OK'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (4, jsonb_build_object('full-tombstone','FAIL','state',SQLSTATE,'msg',SQLERRM));
  END;

  -- experiment C: non-deleted content edit control (should pass)
  BEGIN
    UPDATE public.case_entries SET field_values = jsonb_build_object('procedure_name','exp4-edit') WHERE id = v_id;
    INSERT INTO public._swarm_debug_results VALUES (5, jsonb_build_object('content-edit','OK'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (5, jsonb_build_object('content-edit','FAIL','state',SQLSTATE,'msg',SQLERRM));
  END;

  RESET ROLE;
END $$;

GRANT SELECT ON public._swarm_debug_results TO service_role;
