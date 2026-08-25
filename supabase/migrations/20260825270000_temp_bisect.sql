-- Conjunct bisection v5: correct role-reset ordering per variant
DELETE FROM public._swarm_debug_results;

DO $$
DECLARE
  v_uid UUID := 'f2a0d3a0-b3a0-4026-bdfa-ba0a4688a783';
  v_tenant UUID := '9cd50d60-febe-4adf-be0f-a36bf82762f6';
  v_claims JSONB := jsonb_build_object('aud','authenticated','role','authenticated','sub',v_uid,
    'app_metadata', jsonb_build_object('tenant_id',v_tenant,'user_role','resident'));
  v_pid UUID; v_tmpl UUID; v_id UUID;
  v_keep JSONB;
  r RECORD;
BEGIN
  SELECT id INTO v_pid FROM public.profiles WHERE user_id = v_uid;
  SELECT id INTO v_tmpl FROM public.case_templates LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object('name',policyname,'roles',roles,'qual',qual,'wc',with_check))
    INTO v_keep FROM pg_policies
   WHERE schemaname='public' AND tablename='case_entries' AND cmd='UPDATE';

  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='case_entries' AND cmd='UPDATE'
  LOOP EXECUTE format('DROP POLICY %I ON public.case_entries', r.policyname); END LOOP;

  -- ── E2: deleted_at only ──
  EXECUTE 'CREATE POLICY p_v ON public.case_entries FOR UPDATE TO authenticated USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NOT NULL)';
  INSERT INTO public.case_entries (tenant_id,resident_id,template_id,case_date,field_values,status,accreditation_mappings,is_deidentified,patient_mrn,patient_dob,patient_age_years,patient_hash)
  VALUES (v_tenant,v_pid,v_tmpl,CURRENT_DATE,jsonb_build_object('procedure_name','e2'),'draft','[]'::jsonb,TRUE,NULL,NULL,NULL,'x') RETURNING id INTO v_id;
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims::text, true);
  BEGIN
    UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_id;
    INSERT INTO public._swarm_debug_results VALUES (2, jsonb_build_object('e2-deleted-only','OK'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (2, jsonb_build_object('e2-deleted-only','FAIL','msg',SQLERRM));
  END;
  RESET ROLE;
  EXECUTE 'DROP POLICY p_v ON public.case_entries';

  -- ── E3: + tenant ──
  EXECUTE 'CREATE POLICY p_v ON public.case_entries FOR UPDATE TO authenticated USING (true) WITH CHECK (tenant_id = get_tenant_id() AND deleted_at IS NOT NULL)';
  INSERT INTO public.case_entries (tenant_id,resident_id,template_id,case_date,field_values,status,accreditation_mappings,is_deidentified,patient_mrn,patient_dob,patient_age_years,patient_hash)
  VALUES (v_tenant,v_pid,v_tmpl,CURRENT_DATE,jsonb_build_object('procedure_name','e3'),'draft','[]'::jsonb,TRUE,NULL,NULL,NULL,'x') RETURNING id INTO v_id;
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims::text, true);
  BEGIN
    UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_id;
    INSERT INTO public._swarm_debug_results VALUES (3, jsonb_build_object('e3-plus-tenant','OK'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (3, jsonb_build_object('e3-plus-tenant','FAIL','msg',SQLERRM));
  END;
  RESET ROLE;
  EXECUTE 'DROP POLICY p_v ON public.case_entries';

  -- ── E4: + resident scalar subquery (= original P3) ──
  EXECUTE 'CREATE POLICY p_v ON public.case_entries FOR UPDATE TO authenticated USING (deleted_at IS NULL) WITH CHECK (resident_id = (SELECT id FROM profiles WHERE user_id = auth.uid()) AND tenant_id = get_tenant_id() AND deleted_at IS NOT NULL)';
  INSERT INTO public.case_entries (tenant_id,resident_id,template_id,case_date,field_values,status,accreditation_mappings,is_deidentified,patient_mrn,patient_dob,patient_age_years,patient_hash)
  VALUES (v_tenant,v_pid,v_tmpl,CURRENT_DATE,jsonb_build_object('procedure_name','e4'),'draft','[]'::jsonb,TRUE,NULL,NULL,NULL,'x') RETURNING id INTO v_id;
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims::text, true);
  BEGIN
    UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_id;
    INSERT INTO public._swarm_debug_results VALUES (4, jsonb_build_object('e4-scalar-original','OK'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (4, jsonb_build_object('e4-scalar-original','FAIL','state',SQLSTATE,'msg',SQLERRM));
  END;
  RESET ROLE;
  EXECUTE 'DROP POLICY p_v ON public.case_entries';

  -- ── E5: resident EXISTS form ──
  EXECUTE 'CREATE POLICY p_v ON public.case_entries FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = case_entries.resident_id AND profiles.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = case_entries.resident_id AND profiles.user_id = auth.uid()) AND tenant_id = get_tenant_id() AND deleted_at IS NOT NULL)';
  INSERT INTO public.case_entries (tenant_id,resident_id,template_id,case_date,field_values,status,accreditation_mappings,is_deidentified,patient_mrn,patient_dob,patient_age_years,patient_hash)
  VALUES (v_tenant,v_pid,v_tmpl,CURRENT_DATE,jsonb_build_object('procedure_name','e5'),'draft','[]'::jsonb,TRUE,NULL,NULL,NULL,'x') RETURNING id INTO v_id;
  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims::text, true);
  BEGIN
    UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_id;
    INSERT INTO public._swarm_debug_results VALUES (5, jsonb_build_object('e5-exists-form','OK'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (5, jsonb_build_object('e5-exists-form','FAIL','state',SQLSTATE,'msg',SQLERRM));
  END;
  RESET ROLE;
  EXECUTE 'DROP POLICY p_v ON public.case_entries';

  -- restore original four
  FOR r IN SELECT * FROM jsonb_to_recordset(v_keep) AS x(name text, roles jsonb, qual text, wc text)
  LOOP
    EXECUTE format($p$CREATE POLICY %I ON public.case_entries FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)$p$, r.name, r.qual, r.wc);
  END LOOP;
END $$;
