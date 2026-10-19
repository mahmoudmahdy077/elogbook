CREATE OR REPLACE FUNCTION public.audit_metadata_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_action TEXT;
  v_changed_fields TEXT[] := ARRAY[]::TEXT[];
  v_resource_id UUID;
  v_tenant_id UUID;
  v_entry_id UUID;
BEGIN
  v_action := LOWER(TG_OP);

  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'case_entries' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'case_attachments' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      v_entry_id := NEW.entry_id;
    ELSIF TG_TABLE_NAME = 'case_templates' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'program_goals' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'approval_requests' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      v_entry_id := NEW.entry_id;
    ELSIF TG_TABLE_NAME = 'notifications' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'evaluation_forms' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'rotations' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'shifts' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'milestones' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'comments' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'profiles' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'ai_config' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'payment_gateway_config' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_TABLE_NAME = 'stripe_events' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
    ELSE
      RAISE EXCEPTION 'metadata audit table is not allowlisted';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'case_entries' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'case_attachments' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
      v_entry_id := OLD.entry_id;
    ELSIF TG_TABLE_NAME = 'case_templates' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'program_goals' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'approval_requests' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
      v_entry_id := OLD.entry_id;
    ELSIF TG_TABLE_NAME = 'notifications' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'evaluation_forms' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'rotations' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'shifts' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'milestones' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'comments' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'profiles' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'ai_config' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'payment_gateway_config' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSIF TG_TABLE_NAME = 'stripe_events' THEN
      v_resource_id := OLD.id;
      v_tenant_id := OLD.tenant_id;
    ELSE
      RAISE EXCEPTION 'metadata audit table is not allowlisted';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'case_entries' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.template_id IS DISTINCT FROM OLD.template_id THEN v_changed_fields := array_append(v_changed_fields, 'template_id'); END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN v_changed_fields := array_append(v_changed_fields, 'status'); END IF;
      IF NEW.is_deidentified IS DISTINCT FROM OLD.is_deidentified THEN v_changed_fields := array_append(v_changed_fields, 'is_deidentified'); END IF;
      IF NEW.case_date IS DISTINCT FROM OLD.case_date THEN v_changed_fields := array_append(v_changed_fields, 'case_date'); END IF;
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN v_changed_fields := array_append(v_changed_fields, 'deleted_at'); END IF;
      IF NEW.client_operation_id IS DISTINCT FROM OLD.client_operation_id THEN v_changed_fields := array_append(v_changed_fields, 'client_operation_id'); END IF;
    ELSIF TG_TABLE_NAME = 'case_attachments' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      v_entry_id := NEW.entry_id;
      IF NEW.entry_id IS DISTINCT FROM OLD.entry_id THEN v_changed_fields := array_append(v_changed_fields, 'entry_id'); END IF;
      IF NEW.file_type IS DISTINCT FROM OLD.file_type THEN v_changed_fields := array_append(v_changed_fields, 'file_type'); END IF;
      IF NEW.file_size IS DISTINCT FROM OLD.file_size THEN v_changed_fields := array_append(v_changed_fields, 'file_size'); END IF;
      IF NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN v_changed_fields := array_append(v_changed_fields, 'uploaded_by'); END IF;
    ELSIF TG_TABLE_NAME = 'case_templates' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.specialty IS DISTINCT FROM OLD.specialty THEN v_changed_fields := array_append(v_changed_fields, 'specialty'); END IF;
      IF NEW.name IS DISTINCT FROM OLD.name THEN v_changed_fields := array_append(v_changed_fields, 'name'); END IF;
    ELSIF TG_TABLE_NAME = 'program_goals' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.director_id IS DISTINCT FROM OLD.director_id THEN v_changed_fields := array_append(v_changed_fields, 'director_id'); END IF;
      IF NEW.resident_id IS DISTINCT FROM OLD.resident_id THEN v_changed_fields := array_append(v_changed_fields, 'resident_id'); END IF;
      IF NEW.target_count IS DISTINCT FROM OLD.target_count THEN v_changed_fields := array_append(v_changed_fields, 'target_count'); END IF;
      IF NEW.specialty IS DISTINCT FROM OLD.specialty THEN v_changed_fields := array_append(v_changed_fields, 'specialty'); END IF;
      IF NEW.deadline IS DISTINCT FROM OLD.deadline THEN v_changed_fields := array_append(v_changed_fields, 'deadline'); END IF;
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN v_changed_fields := array_append(v_changed_fields, 'deleted_at'); END IF;
    ELSIF TG_TABLE_NAME = 'approval_requests' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      v_entry_id := NEW.entry_id;
      IF NEW.entry_id IS DISTINCT FROM OLD.entry_id THEN v_changed_fields := array_append(v_changed_fields, 'entry_id'); END IF;
      IF NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id THEN v_changed_fields := array_append(v_changed_fields, 'supervisor_id'); END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN v_changed_fields := array_append(v_changed_fields, 'status'); END IF;
      IF NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN v_changed_fields := array_append(v_changed_fields, 'requested_at'); END IF;
      IF NEW.resolved_at IS DISTINCT FROM OLD.resolved_at THEN v_changed_fields := array_append(v_changed_fields, 'resolved_at'); END IF;
    ELSIF TG_TABLE_NAME = 'notifications' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN v_changed_fields := array_append(v_changed_fields, 'user_id'); END IF;
      IF NEW.type IS DISTINCT FROM OLD.type THEN v_changed_fields := array_append(v_changed_fields, 'type'); END IF;
      IF NEW.read_at IS DISTINCT FROM OLD.read_at THEN v_changed_fields := array_append(v_changed_fields, 'read_at'); END IF;
    ELSIF TG_TABLE_NAME = 'evaluation_forms' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.resident_id IS DISTINCT FROM OLD.resident_id THEN v_changed_fields := array_append(v_changed_fields, 'resident_id'); END IF;
      IF NEW.evaluator_id IS DISTINCT FROM OLD.evaluator_id THEN v_changed_fields := array_append(v_changed_fields, 'evaluator_id'); END IF;
      IF NEW.form_type IS DISTINCT FROM OLD.form_type THEN v_changed_fields := array_append(v_changed_fields, 'form_type'); END IF;
      IF NEW.encounter_date IS DISTINCT FROM OLD.encounter_date THEN v_changed_fields := array_append(v_changed_fields, 'encounter_date'); END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN v_changed_fields := array_append(v_changed_fields, 'status'); END IF;
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN v_changed_fields := array_append(v_changed_fields, 'deleted_at'); END IF;
    ELSIF TG_TABLE_NAME = 'rotations' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.resident_id IS DISTINCT FROM OLD.resident_id THEN v_changed_fields := array_append(v_changed_fields, 'resident_id'); END IF;
      IF NEW.title IS DISTINCT FROM OLD.title THEN v_changed_fields := array_append(v_changed_fields, 'title'); END IF;
      IF NEW.specialty IS DISTINCT FROM OLD.specialty THEN v_changed_fields := array_append(v_changed_fields, 'specialty'); END IF;
      IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN v_changed_fields := array_append(v_changed_fields, 'start_date'); END IF;
      IF NEW.end_date IS DISTINCT FROM OLD.end_date THEN v_changed_fields := array_append(v_changed_fields, 'end_date'); END IF;
      IF NEW.site IS DISTINCT FROM OLD.site THEN v_changed_fields := array_append(v_changed_fields, 'site'); END IF;
      IF NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id THEN v_changed_fields := array_append(v_changed_fields, 'supervisor_id'); END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN v_changed_fields := array_append(v_changed_fields, 'status'); END IF;
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN v_changed_fields := array_append(v_changed_fields, 'deleted_at'); END IF;
    ELSIF TG_TABLE_NAME = 'shifts' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.rotation_id IS DISTINCT FROM OLD.rotation_id THEN v_changed_fields := array_append(v_changed_fields, 'rotation_id'); END IF;
      IF NEW.resident_id IS DISTINCT FROM OLD.resident_id THEN v_changed_fields := array_append(v_changed_fields, 'resident_id'); END IF;
      IF NEW.shift_date IS DISTINCT FROM OLD.shift_date THEN v_changed_fields := array_append(v_changed_fields, 'shift_date'); END IF;
      IF NEW.start_time IS DISTINCT FROM OLD.start_time THEN v_changed_fields := array_append(v_changed_fields, 'start_time'); END IF;
      IF NEW.end_time IS DISTINCT FROM OLD.end_time THEN v_changed_fields := array_append(v_changed_fields, 'end_time'); END IF;
      IF NEW.shift_type IS DISTINCT FROM OLD.shift_type THEN v_changed_fields := array_append(v_changed_fields, 'shift_type'); END IF;
      IF NEW.location IS DISTINCT FROM OLD.location THEN v_changed_fields := array_append(v_changed_fields, 'location'); END IF;
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN v_changed_fields := array_append(v_changed_fields, 'deleted_at'); END IF;
    ELSIF TG_TABLE_NAME = 'milestones' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.resident_id IS DISTINCT FROM OLD.resident_id THEN v_changed_fields := array_append(v_changed_fields, 'resident_id'); END IF;
      IF NEW.competency_area IS DISTINCT FROM OLD.competency_area THEN v_changed_fields := array_append(v_changed_fields, 'competency_area'); END IF;
      IF NEW.sub_competency IS DISTINCT FROM OLD.sub_competency THEN v_changed_fields := array_append(v_changed_fields, 'sub_competency'); END IF;
      IF NEW.level IS DISTINCT FROM OLD.level THEN v_changed_fields := array_append(v_changed_fields, 'level'); END IF;
      IF NEW.assessor_id IS DISTINCT FROM OLD.assessor_id THEN v_changed_fields := array_append(v_changed_fields, 'assessor_id'); END IF;
      IF NEW.assessment_date IS DISTINCT FROM OLD.assessment_date THEN v_changed_fields := array_append(v_changed_fields, 'assessment_date'); END IF;
      IF NEW.evidence_entry_id IS DISTINCT FROM OLD.evidence_entry_id THEN v_changed_fields := array_append(v_changed_fields, 'evidence_entry_id'); END IF;
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN v_changed_fields := array_append(v_changed_fields, 'deleted_at'); END IF;
    ELSIF TG_TABLE_NAME = 'comments' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.entry_id IS DISTINCT FROM OLD.entry_id THEN v_changed_fields := array_append(v_changed_fields, 'entry_id'); END IF;
      IF NEW.evaluation_id IS DISTINCT FROM OLD.evaluation_id THEN v_changed_fields := array_append(v_changed_fields, 'evaluation_id'); END IF;
      IF NEW.author_id IS DISTINCT FROM OLD.author_id THEN v_changed_fields := array_append(v_changed_fields, 'author_id'); END IF;
      IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN v_changed_fields := array_append(v_changed_fields, 'parent_id'); END IF;
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN v_changed_fields := array_append(v_changed_fields, 'deleted_at'); END IF;
    ELSIF TG_TABLE_NAME = 'profiles' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN v_changed_fields := array_append(v_changed_fields, 'tenant_id'); END IF;
      IF NEW.role IS DISTINCT FROM OLD.role THEN v_changed_fields := array_append(v_changed_fields, 'role'); END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN v_changed_fields := array_append(v_changed_fields, 'status'); END IF;
      IF NEW.specialty IS DISTINCT FROM OLD.specialty THEN v_changed_fields := array_append(v_changed_fields, 'specialty'); END IF;
      IF NEW.onboarding_completed IS DISTINCT FROM OLD.onboarding_completed THEN v_changed_fields := array_append(v_changed_fields, 'onboarding_completed'); END IF;
      IF NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN v_changed_fields := array_append(v_changed_fields, 'invited_by'); END IF;
    ELSIF TG_TABLE_NAME = 'ai_config' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.provider IS DISTINCT FROM OLD.provider THEN v_changed_fields := array_append(v_changed_fields, 'provider'); END IF;
      IF NEW.model IS DISTINCT FROM OLD.model THEN v_changed_fields := array_append(v_changed_fields, 'model'); END IF;
      IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN v_changed_fields := array_append(v_changed_fields, 'is_active'); END IF;
      IF NEW.key_version IS DISTINCT FROM OLD.key_version THEN v_changed_fields := array_append(v_changed_fields, 'key_version'); END IF;
    ELSIF TG_TABLE_NAME = 'payment_gateway_config' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.provider IS DISTINCT FROM OLD.provider THEN v_changed_fields := array_append(v_changed_fields, 'provider'); END IF;
      IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN v_changed_fields := array_append(v_changed_fields, 'is_active'); END IF;
      IF NEW.mode IS DISTINCT FROM OLD.mode THEN v_changed_fields := array_append(v_changed_fields, 'mode'); END IF;
      IF NEW.key_version IS DISTINCT FROM OLD.key_version THEN v_changed_fields := array_append(v_changed_fields, 'key_version'); END IF;
    ELSIF TG_TABLE_NAME = 'stripe_events' THEN
      v_resource_id := NEW.id;
      v_tenant_id := NEW.tenant_id;
      IF NEW.processed IS DISTINCT FROM OLD.processed THEN v_changed_fields := array_append(v_changed_fields, 'processed'); END IF;
      IF NEW.processed_at IS DISTINCT FROM OLD.processed_at THEN v_changed_fields := array_append(v_changed_fields, 'processed_at'); END IF;
      IF NEW.status IS DISTINCT FROM OLD.status THEN v_changed_fields := array_append(v_changed_fields, 'status'); END IF;
      IF NEW.signature_valid IS DISTINCT FROM OLD.signature_valid THEN v_changed_fields := array_append(v_changed_fields, 'signature_valid'); END IF;
    ELSE
      RAISE EXCEPTION 'metadata audit table is not allowlisted';
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  IF v_tenant_id IS NULL AND v_entry_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.case_entries
    WHERE id = v_entry_id;
  END IF;

  IF v_resource_id IS NOT NULL AND v_tenant_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      action,
      resource_type,
      resource_id,
      changes
    )
    VALUES (
      v_tenant_id,
      auth.uid(),
      v_action,
      TG_TABLE_NAME,
      v_resource_id,
      jsonb_build_object('changed_fields', to_jsonb(v_changed_fields))
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_metadata_only() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_table TEXT;
  v_trigger TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'case_entries',
    'case_attachments',
    'case_templates',
    'program_goals',
    'approval_requests',
    'notifications',
    'evaluation_forms',
    'rotations',
    'shifts',
    'milestones',
    'comments',
    'profiles',
    'ai_config',
    'payment_gateway_config',
    'stripe_events'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    v_trigger := 'trg_audit_' || v_table;
    IF v_table = 'case_entries' THEN
      v_trigger := 'trg_audit_case_entry';
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_trigger, v_table);
    IF v_table = 'profiles' THEN
      EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_profile ON public.profiles';
    END IF;
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_metadata_only()',
      v_trigger,
      v_table
    );
  END LOOP;
END;
$$;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM service_role;

CREATE OR REPLACE FUNCTION public.reject_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Audit rows are immutable once written.';
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_audit_truncate ON public.audit_logs;
CREATE TRIGGER trg_reject_audit_truncate
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
