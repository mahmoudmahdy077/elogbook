-- Isolation experiment: with ONLY the resident-tombstone policy present,
-- does an impersonated tombstone succeed?
DO $$
DECLARE
  v_uid UUID := 'f2a0d3a0-b3a0-4026-bdfa-ba0a4688a783';
  v_tenant UUID := '9cd50d60-febe-4adf-be0f-a36bf82762f6';
  v_claims JSONB := jsonb_build_object('aud','authenticated','role','authenticated','sub',v_uid,
    'app_metadata', jsonb_build_object('tenant_id',v_tenant,'user_role','resident'));
  v_id UUID; v_keep JSONB;
  r RECORD;
BEGIN
  -- stash all four UPDATE policies
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name',policyname,'cmd',cmd,'roles',roles,'qual',qual,'wc',with_check)),'[]'::jsonb)
    INTO v_keep FROM pg_policies
   WHERE schemaname='public' AND tablename='case_entries' AND cmd='UPDATE';

  DELETE FROM public._swarm_debug_results;

  -- wipe ALL update policies, recreate ONLY P3
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='case_entries' AND cmd='UPDATE'
  LOOP EXECUTE format('DROP POLICY %I ON public.case_entries', r.policyname); END LOOP;
  EXECUTE $fn$CREATE POLICY "residents soft delete own entries" ON public.case_entries
    FOR UPDATE TO authenticated
    USING (resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
           AND tenant_id = get_tenant_id() AND deleted_at IS NULL)
    WITH CHECK (resident_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
           AND tenant_id = get_tenant_id() AND deleted_at IS NOT NULL)$fn$;

  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims::text, true);

  IF v_pid IS NOT NULL THEN
    INSERT INTO public.case_entries (tenant_id,resident_id,template_id,case_date,field_values,status,accreditation_mappings,is_deidentified,patient_mrn,patient_dob,patient_age_years,patient_hash)
  VALUES (v_tenant,(SELECT id FROM public.profiles WHERE user_id=v_uid),(SELECT id FROM public.case_templates LIMIT 1),CURRENT_DATE,jsonb_build_object('procedure_name','iso'),'draft','[]'::jsonb,TRUE,NULL,NULL,NULL,'x')
  RETURNING id INTO v_id;
  END IF;

  BEGIN
    UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_id;
    INSERT INTO public._swarm_debug_results VALUES (10, jsonb_build_object('isolated-p3','OK'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (10, jsonb_build_object('isolated-p3','FAIL','state',SQLSTATE,'msg',SQLERRM));
  END;

  RESET ROLE;

  -- restore stashed policies
  FOR r IN SELECT * FROM jsonb_to_recordset(v_keep) AS x(name text, roles jsonb, qual text, wc text)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.case_entries', r.name);
    EXECUTE format($p$CREATE POLICY %I ON public.case_entries FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)$p$, r.name, r.qual, r.wc);
  END LOOP;
END $$;
