-- p3_08: the live catalog agrees with the repository about which clinical
-- guards are actually running (SEC-012), and the guards that exist are the ones
-- the repository describes.
--
-- A trigger that is DISABLE'd in a migration is invisible to any read of the
-- repository: only the live database disagrees. 20260824160000 re-asserted the
-- PHI-scan trigger after a probe found it missing, and 20260825190000 re-enabled
-- a set of case_entries triggers. This suite reads pg_trigger directly so the
-- final state is asserted rather than assumed, and 20260927000003 makes the
-- migration itself raise if the state is wrong.
--
-- The two UPDATE-only guards are named as BEFORE UPDATE on purpose. Only
-- trg_scan_field_values_phi and trg_case_insert_status are bound to INSERT, and
-- for opposite reasons: an insert is where a de-identified row first carries
-- PHI, and an insert is where a resident reaches `approved` without ever passing
-- the state machine. The state machine and the write-once guard compare a row
-- against itself, so an INSERT has nothing to compare and firing them there
-- would be a no-op that reads like a control.
BEGIN;
SELECT plan(23);

-- 1. Every case_entries guard trigger exists and is enabled for normal writes.
SELECT is_empty(
  $$
    SELECT required.tgname
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
    WHERE guard.oid IS NULL
  $$,
  'every case_entries guard trigger exists in the live catalog'
);

SELECT is_empty(
  $$
    SELECT guard.tgname
    FROM pg_trigger AS guard
    WHERE guard.tgrelid = 'public.case_entries'::regclass
      AND NOT guard.tgisinternal
      AND guard.tgenabled NOT IN ('O', 'A')
  $$,
  'no case_entries trigger is disabled or replica-only'
);

-- 2. The PHI-scan trigger fires on both the write directions that matter.
SELECT is(
  (SELECT COUNT(*)::int FROM pg_trigger
    WHERE tgname = 'trg_scan_field_values_phi'
      AND tgrelid = 'public.case_entries'::regclass
      AND (tgtype & 4) > 0),
  1,
  'trg_scan_field_values_phi is bound to case_entries'
);
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger
    WHERE tgname = 'trg_scan_field_values_phi' AND tgrelid = 'public.case_entries'::regclass),
  'CREATE TRIGGER trg_scan_field_values_phi BEFORE INSERT OR UPDATE ON public.case_entries FOR EACH ROW EXECUTE FUNCTION public.scan_field_values_for_phi()',
  'trg_scan_field_values_phi fires before INSERT OR UPDATE'
);

-- 3. The status state machine and the write-once guard are the current
--    definitions, not superseded ones, and each is bound to the write
--    directions it can actually decide something about.
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger
    WHERE tgname = 'trg_enforce_case_status_transition' AND tgrelid = 'public.case_entries'::regclass),
  'CREATE TRIGGER trg_enforce_case_status_transition BEFORE UPDATE ON public.case_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_case_status_transition()',
  'trg_enforce_case_status_transition runs the AAL2-aware state machine on UPDATE'
);
SELECT is(
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger
    WHERE tgname = 'trg_write_once_submitted_check' AND tgrelid = 'public.case_entries'::regclass),
  'CREATE TRIGGER trg_write_once_submitted_check BEFORE UPDATE ON public.case_entries FOR EACH ROW EXECUTE FUNCTION public.write_once_submitted_check()',
  'trg_write_once_submitted_check runs the approved-record guard on UPDATE'
);
SELECT is(
  (SELECT (guard.tgtype & 4) FROM pg_trigger AS guard
    WHERE guard.tgname = 'trg_enforce_case_status_transition'
      AND guard.tgrelid = 'public.case_entries'::regclass),
  0,
  'the state machine is not bound to INSERT, which would compare a row against nothing'
);
SELECT is(
  (SELECT (guard.tgtype & 4) FROM pg_trigger AS guard
    WHERE guard.tgname = 'trg_write_once_submitted_check'
      AND guard.tgrelid = 'public.case_entries'::regclass),
  0,
  'the write-once guard is not bound to INSERT'
);
-- The SEC-002 insert guard is the mirror image: it exists precisely because the
-- state machine is not bound to INSERT, so an INSERT that arrives pre-approved
-- has to be refused by a different trigger. Reading only the UPDATE bindings
-- would leave the INSERT path unguarded in the catalog and asserted nowhere.
SELECT is(
  (SELECT (guard.tgtype & 4) FROM pg_trigger AS guard
    WHERE guard.tgname = 'trg_case_insert_status'
      AND guard.tgrelid = 'public.case_entries'::regclass),
  4,
  'trg_case_insert_status is bound to INSERT, the direction SEC-002 was reached through'
);
-- A trigger that exists and is enabled is not a control; the body is. This is
-- the assertion a weaker inline regex cannot satisfy: it does not walk
-- field_values_contain_phi, so it detects a digit run and two date shapes and
-- nothing else -- not an email address, not a telephone number, not a labelled
-- MRN, not an unknown key.
SELECT ok(
  position('field_values_contain_phi' IN pg_get_functiondef('public.scan_field_values_for_phi()'::regprocedure)) > 0,
  'the PHI scan walks the recursive field_values_contain_phi detector, not an inline regex'
);
SELECT ok(
  position('SECURITY DEFINER' IN pg_get_functiondef('public.scan_field_values_for_phi()'::regprocedure)) > 0,
  'the PHI scan is SECURITY DEFINER with its locked search_path intact'
);

-- 4. The secondary clinical write guards are present and enabled.
--
--    trg_authorize_faculty_eval_delete is not in the 20260927000003 inventory:
--    20260929000002, which creates it, is applied after that migration. It is
--    listed here instead, so the guard that implements the documented DELETE
--    rule is read from the live catalog rather than assumed from the source.
SELECT is_empty(
  $$
    SELECT required.guard_name
    FROM unnest(ARRAY[
      'evaluation_forms:trg_authorize_evalforms_update',
      'evaluation_forms:trg_eval_form_status',
      'faculty_evaluations:trg_authorize_faculty_eval_write',
      'faculty_evaluations:trg_authorize_faculty_eval_delete',
      'rotations:trg_authorize_rotation_write'
    ]) AS required(guard_name)
    LEFT JOIN LATERAL (
      SELECT trigger_record.tgenabled
      FROM pg_trigger AS trigger_record
      WHERE trigger_record.tgname = split_part(required.guard_name, ':', 2)
        AND trigger_record.tgrelid = format('public.%I', split_part(required.guard_name, ':', 1))::regclass
        AND NOT trigger_record.tgisinternal
    ) AS found ON true
    WHERE found.tgenabled IS NULL OR found.tgenabled NOT IN ('O', 'A')
  $$,
  'every secondary clinical write guard exists and is enabled'
);

-- 5. The guard functions themselves are what the convergence migration asserts,
--    not a local redefinition.
SELECT has_function('public', 'privileged_clinical_write_authorized', ARRAY['uuid'], 'shared AAL2 gate for secondary writes');
SELECT is(
  has_function_privilege('anon', 'public.privileged_clinical_write_authorized(uuid)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute the secondary-write gate'
);
SELECT is_empty(
  $$
    SELECT trigger_record.tgname
    FROM pg_trigger AS trigger_record
    WHERE trigger_record.tgrelid = 'public.faculty_evaluations'::regclass
      AND NOT trigger_record.tgisinternal
      AND trigger_record.tgenabled NOT IN ('O', 'A')
  $$,
  'the faculty evaluation write guard cannot be disabled silently'
);

-- 6. The status guards the convergence migration depends on exist as functions,
--    so a missing body fails here rather than at the next write.
SELECT has_function('public', 'scan_field_values_for_phi', ARRAY[]::text[], 'PHI scan function exists');
SELECT has_function('public', 'enforce_case_status_transition', ARRAY[]::text[], 'case status state machine exists');
SELECT has_function('public', 'write_once_submitted_check', ARRAY[]::text[], 'approved-record write guard exists');
SELECT has_function('public', 'enforce_case_insert_status', ARRAY[]::text[], 'case insert status guard exists');
SELECT has_function('public', 'authorize_evaluation_form_update', ARRAY[]::text[], 'evaluation form update guard exists');
SELECT has_function('public', 'authorize_faculty_evaluation_write', ARRAY[]::text[], 'faculty evaluation write guard exists');
SELECT has_function('public', 'authorize_faculty_evaluation_delete', ARRAY[]::text[], 'faculty evaluation delete guard exists');
SELECT has_function('public', 'authorize_rotation_write', ARRAY[]::text[], 'rotation write guard exists');

ROLLBACK;
