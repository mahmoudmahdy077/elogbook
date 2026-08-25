-- TEMP: disable all custom triggers on case_entries for bisection experiment
ALTER TABLE public.case_entries DISABLE TRIGGER set_updated_at;
ALTER TABLE public.case_entries DISABLE TRIGGER trg_audit_case_entry;
ALTER TABLE public.case_entries DISABLE TRIGGER trg_auto_approve_individual;
ALTER TABLE public.case_entries DISABLE TRIGGER trg_block_lapsed_tenant_submit;
ALTER TABLE public.case_entries DISABLE TRIGGER trg_enforce_case_quota;
ALTER TABLE public.case_entries DISABLE TRIGGER trg_enforce_case_status_transition;
ALTER TABLE public.case_entries DISABLE TRIGGER trg_scan_field_values_phi;
ALTER TABLE public.case_entries DISABLE TRIGGER trg_update_goal_progress;
ALTER TABLE public.case_entries DISABLE TRIGGER trg_write_once_submitted_check;
