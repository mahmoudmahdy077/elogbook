-- FINAL A/B: E1-exact (postgres seed, no captures) vs E1+captures+authseed
DELETE FROM public._swarm_debug_results WHERE line >= 80;

DO $$
DECLARE
  v_uid UUID := 'f2a0d3a0-b3a0-4026-bdfa-ba0a4688a783';
  v_tenant UUID := '9cd50d60-febe-4adf-be0f-a36bf82762f6';
  v_claims JSONB := jsonb_build_object('aud','authenticated','role','authenticated','sub',v_uid,
    'app_metadata', jsonb_build_object('tenant_id',v_tenant,'user_role','resident'));
  v_pid UUID; v_tmpl UUID; v_id UUID;
  r RECORD;
BEGIN
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims::text, true);
  SELECT id INTO v_pid FROM public.profiles WHERE user_id = auth.uid();
  SELECT id INTO v_tmpl FROM public.case_templates LIMIT 1;
  PERFORM set_config('role','postgres', true);

  -- stash + wipe UPDATE policies
  DECLARE v_keep JSONB;
  BEGIN
    SELECT jsonb_agg(jsonb_build_object('name',policyname,'roles',roles,'qual',qual,'wc',with_check))
      INTO v_keep FROM pg_policies
     WHERE schemaname='public' AND tablename='case_entries' AND cmd='UPDATE';
    FOR r IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename='case_entries' AND cmd='UPDATE'
    LOOP EXECUTE format('DROP POLICY %I ON public.case_entries', r.policyname); END LOOP;

    EXECUTE 'CREATE POLICY p_ab ON public.case_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (true)';

    -- variant 1: seed AS POSTGRES, update AS AUTHENTICATED
    INSERT INTO public.case_entries (tenant_id,resident_id,template_id,case_date,field_values,status,accreditation_mappings,is_deidentified,patient_mrn,patient_dob,patient_age_years,patient_hash)
    VALUES (v_tenant,v_pid,v_tmpl,CURRENT_DATE,jsonb_build_object('procedure_name','ab1'),'draft','[]'::jsonb,TRUE,NULL,NULL,NULL,'x') RETURNING id INTO v_id;
    PERFORM set_config('role','authenticated', true);
    PERFORM set_config('request.jwt.claims', v_claims::text, true);
    BEGIN
      UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_id;
      INSERT INTO public._swarm_debug_results VALUES (81, jsonb_build_object('pg-seeded-auth-upd','OK'));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public._swarm_debug_results VALUES (81, jsonb_build_object('pg-seeded-auth-upd','FAIL','msg',SQLERRM));
    END;
    PERFORM set_config('role','postgres', true);

    -- variant 2: seed AS AUTHENTICATED, update AS AUTHENTICATED
    PERFORM set_config('role','authenticated', true);
    PERFORM set_config('request.jwt.claims', v_claims::text, true);
    INSERT INTO public.case_entries (tenant_id,resident_id,template_id,case_date,field_values,status,accreditation_mappings,is_deidentified,patient_mrn,patient_dob,patient_age_years,patient_hash)
    VALUES (v_tenant,v_pid,v_tmpl,CURRENT_DATE,jsonb_build_object('procedure_name','ab2'),'draft','[]'::jsonb,TRUE,NULL,NULL,NULL,'x') RETURNING id INTO v_id;
    BEGIN
      UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_id;
      INSERT INTO public._swarm_debug_results VALUES (82, jsonb_build_object('auth-seeded-auth-upd','OK'));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public._swarm_debug_results VALUES (82, jsonb_build_object('auth-seeded-auth-upd','FAIL','msg',SQLERRM));
    END;
    PERFORM set_config('role','postgres', true);

    -- restore policies + hard-cleanup probe rows
    FOR r IN SELECT * FROM jsonb_to_recordset(v_keep) AS x(name text, roles jsonb, qual text, wc text)
    LOOP
      EXECUTE format($p$CREATE POLICY %I ON public.case_entries FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)$p$, r.name, r.qual, r.wc);
    END LOOP;
    DELETE FROM public.case_entries WHERE field_values->>'procedure_name' IN ('ab1','ab2');
  END;
END $$;
