-- ============================================================================
-- 20260927000003_case_trigger_convergence_guard.sql
--
-- Guard-window close for case_entries triggers.
--
-- Why this exists
-- ---------------
-- 20260824160000 re-asserted trg_scan_field_values_phi after a live probe found
-- the PHI-scan trigger missing while other triggers on the same table still
-- fired. 20260825190000 then re-enabled a set of case_entries triggers that an
-- experiment had left disabled.
--
-- That leaves a window in the migration history where the applied database's
-- trigger state could differ from what the repository describes, and a disabled
-- trigger is invisible to any read of this repository: only the live catalog
-- disagrees. A later re-run of a *converging* migration repairs it, but only if
-- something notices.
--
-- This migration makes the state self-checking instead:
--
--   1. Re-assert the case_entries guard triggers unconditionally, so a fresh
--      bootstrap and a repaired installation reach the same state.
--   2. Read pg_trigger for every guard trigger on the clinical tables and RAISE
--      if any is not enabled. A migration that completes has therefore verified
--      the final state rather than assuming it.
--
-- History is not edited. 20260824160000 and 20260825190000 stay exactly as they
-- were applied; this file is the forward-only repair and the assertion.
--
-- One exception, and it is this file's own body rather than anyone else's: an
-- earlier revision of section 1 replaced the authoritative PHI scan with a
-- weaker inline regex (see the note there). It is corrected in place, because
-- leaving it would make a fresh bootstrap install the downgrade and the forward
-- repair in 20260930000001 would be the only thing standing between the
-- repository and a weaker boundary on every new environment.
--
-- Failure is loud on purpose. A silently disabled PHI-scan or status-transition
-- trigger is a control that is present in the schema and absent in the
-- database, which is the worst of both worlds: every review of the code says the
-- control exists.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Re-assert every case_entries guard trigger.
--
-- The PHI scan body is re-issued VERBATIM from 20260925000004, which is the
-- authoritative de-identified boundary. An earlier revision of this file
-- replaced it with an inline three-regex check:
--
--     v_text ~ '\m\d{6,}\m' OR <ISO date> OR <US date>
--
-- That is a downgrade, not a simplification. It detects a bare digit run and
-- two date shapes and nothing else: not an email address, not a telephone
-- number, not a labelled `MRN: 123456`, and not an unknown key. It also dropped
-- the recursive field_values_contain_phi() walk with its unknown-key
-- allowlist, and it dropped SECURITY DEFINER and the pinned search_path that
-- 20260925000004 gave the function. Re-issuing the authoritative body verbatim
-- is what makes the guard assertion below meaningful: a trigger that exists and
-- is enabled is not a control, and the body is the control.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_field_values_for_phi()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.is_deidentified = true AND public.field_values_contain_phi(NEW.field_values) THEN
    RAISE EXCEPTION 'PHI detected in deidentified field values';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scan_field_values_phi ON public.case_entries;
CREATE TRIGGER trg_scan_field_values_phi
  BEFORE INSERT OR UPDATE ON public.case_entries
  FOR EACH ROW EXECUTE FUNCTION public.scan_field_values_for_phi();

-- The remaining guards are re-enabled, not recreated: their bodies are owned by
-- 20260926000001 and later, and redefining them here would fork the definition
-- the tests assert against.
--
-- trg_case_insert_status is in this list and not in 20260825190000's because it
-- is created LATER: 20260826190000 adds it, after the re-enable pass ran. That is
-- not a reason to leave it out. It is the SEC-002 guard for the INSERT path --
-- the one a live probe found a resident walking straight through with
-- status='approved' -- and a guard that exists, is enabled, and is named by
-- nothing is a control the repository does not claim. Applied history is not
-- edited to claim it; it is asserted here instead.
ALTER TABLE public.case_entries ENABLE TRIGGER set_updated_at;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_audit_case_entry;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_auto_approve_individual;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_block_lapsed_tenant_submit;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_case_insert_status;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_enforce_case_quota;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_enforce_case_status_transition;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_update_goal_progress;
ALTER TABLE public.case_entries ENABLE TRIGGER trg_write_once_submitted_check;

-- The secondary clinical tables' write guards (20260927000002) get the same
-- treatment: a guard that exists in the schema and is off in the database is
-- the failure mode this migration exists to prevent.
ALTER TABLE public.evaluation_forms ENABLE TRIGGER trg_authorize_evalforms_update;
ALTER TABLE public.evaluation_forms ENABLE TRIGGER trg_eval_form_status;
ALTER TABLE public.faculty_evaluations ENABLE TRIGGER trg_authorize_faculty_eval_write;
ALTER TABLE public.rotations ENABLE TRIGGER trg_authorize_rotation_write;

-- ---------------------------------------------------------------------------
-- 2. Assert the final state from the catalog.
--
-- tgenabled is 'O' for a normal origin-enabled trigger, 'D' for disabled, 'R'
-- for replica-only, and 'A' for always. Only 'O' and 'A' mean the trigger runs
-- for a normal write.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(guard.tgname, ', ' ORDER BY guard.tgname)
  INTO v_missing
  FROM unnest(ARRAY[
    'set_updated_at',
    'trg_audit_case_entry',
    'trg_auto_approve_individual',
    'trg_block_lapsed_tenant_submit',
    'trg_case_insert_status',
    'trg_enforce_case_quota',
    'trg_enforce_case_status_transition',
    'trg_scan_field_values_phi',
    'trg_update_goal_progress',
    'trg_write_once_submitted_check'
  ]) AS required(tgname)
  LEFT JOIN pg_trigger AS guard
    ON guard.tgname = required.tgname
   AND guard.tgrelid = 'public.case_entries'::regclass
   AND NOT guard.tgisinternal
  WHERE guard.oid IS NULL OR guard.tgenabled NOT IN ('O', 'A');

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'SEC-012: case_entries guard triggers are missing or disabled: %', v_missing;
  END IF;
END $$;

DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(disabled.guard_name, ', ' ORDER BY disabled.guard_name)
  INTO v_missing
  FROM unnest(ARRAY[
    'evaluation_forms:trg_authorize_evalforms_update',
    'evaluation_forms:trg_eval_form_status',
    'faculty_evaluations:trg_authorize_faculty_eval_write',
    'rotations:trg_authorize_rotation_write'
  ]) AS disabled(guard_name)
  LEFT JOIN LATERAL (
    SELECT trigger_record.tgenabled
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgname = split_part(disabled.guard_name, ':', 2)
      AND trigger_record.tgrelid = format('public.%I', split_part(disabled.guard_name, ':', 1))::regclass
      AND NOT trigger_record.tgisinternal
  ) AS found ON true
  WHERE found.tgenabled IS NULL OR found.tgenabled NOT IN ('O', 'A');

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'SEC-012: secondary clinical write guards are missing or disabled: %', v_missing;
  END IF;
END $$;
