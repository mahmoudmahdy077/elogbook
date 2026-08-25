-- CRITICAL: re-enable all case_entries triggers disabled by 160000 experiment,
-- normalize global-community MRN salt, and drop temporary swarm debug objects.
ALTER TABLE public.case_entries ENABLE TRIGGER set_updated_at;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_audit_case_entry;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_auto_approve_individual;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_block_lapsed_tenant_submit;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_enforce_case_quota;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_enforce_case_status_transition;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_scan_field_values_phi;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_update_goal_progress;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_write_once_submitted_check;

UPDATE public.tenants
SET mrn_hash_salt = encode(extensions.gen_random_bytes(32), 'hex')
WHERE slug = 'global-community'
  AND (mrn_hash_salt IS NULL OR mrn_hash_salt !~ '^[0-9a-f]{64}$');

DROP FUNCTION IF EXISTS public.debug_swarm_introspect(TEXT, UUID);
DROP FUNCTION IF EXISTS public.debug_swarm_introspect();
DROP FUNCTION IF EXISTS public.debug_wave2_introspect();
DROP FUNCTION IF EXISTS public.debug_policies_full();
DROP FUNCTION IF EXISTS public.debug_exp_tombstone();
