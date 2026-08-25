-- Capture trigger: log OLD/NEW.deleted_at during the failing UPDATE
CREATE OR REPLACE FUNCTION public.dbg_cap_deleted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public._swarm_debug_results VALUES ((SELECT COALESCE(MAX(line),80)+1 FROM public._swarm_debug_results),
      jsonb_build_object('phase','BEFORE','op',TG_OP,'OLD.deleted_at',OLD.deleted_at,'NEW.deleted_at',NEW.deleted_at,'status',NEW.status));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dbg_cap ON public.case_entries;
CREATE TRIGGER trg_dbg_cap BEFORE UPDATE ON public.case_entries
FOR EACH ROW EXECUTE FUNCTION public.dbg_cap_deleted();

-- rerun E2 minimal: WC = deleted_at IS NOT NULL alone
DO $$
DECLARE
  v_uid UUID := 'f2a0d3a0-b3a0-4026-bdfa-ba0a4688a783';
  v_tenant UUID := '9cd50d60-febe-4adf-be0f-a36bf82762f6';
  v_claims JSONB := jsonb_build_object('aud','authenticated','role','authenticated','sub',v_uid,
    'app_metadata', jsonb_build_object('tenant_id',v_tenant,'user_role','resident'));
  v_pid UUID; v_tmpl UUID; v_id UUID;
  r RECORD;
BEGIN
  DELETE FROM public._swarm_debug_results WHERE line >= 2;

  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='case_entries' AND cmd='UPDATE'
  LOOP EXECUTE format('DROP POLICY %I ON public.case_entries', r.policyname); END LOOP;
  EXECUTE 'CREATE POLICY p_v ON public.case_entries FOR UPDATE TO authenticated USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NOT NULL)';

  INSERT INTO public.case_entries (tenant_id,resident_id,template_id,case_date,field_values,status,accreditation_mappings,is_deidentified,patient_mrn,patient_dob,patient_age_years,patient_hash)
  VALUES (v_tenant,v_pid,v_tmpl,CURRENT_DATE,jsonb_build_object('procedure_name','cap'),'draft','[]'::jsonb,TRUE,NULL,NULL,NULL,'x') RETURNING id INTO v_id;

  PERFORM set_config('role','authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims::text, true);

  BEGIN
    UPDATE public.case_entries SET deleted_at = NOW() WHERE id = v_id;
    INSERT INTO public._swarm_debug_results VALUES (99, jsonb_build_object('e2-rerun','OK'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public._swarm_debug_results VALUES (99, jsonb_build_object('e2-rerun','FAIL','msg',SQLERRM));
  END;
  RESET ROLE;
  EXECUTE 'DROP POLICY p_v ON public.case_entries';
END $$;
