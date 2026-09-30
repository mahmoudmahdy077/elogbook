-- p3_07: privileged writes to the secondary clinical tables require a live AAL2
-- principal (SEC-010 / SEC-011), and the resident-facing workflows still work.
--
-- The case_entries command boundary made AAL2 authoritative at the state
-- machine. These tables carried the same clinical record with role labels only,
-- so a privileged session at AAL1 could rewrite an evaluation's scores or the
-- rotation schedule that decides credited service.
--
-- The INSERT direction is covered too. 20260927000002 attached the gate to the
-- update trigger only, so filing a completed evaluation at AAL1 stayed open
-- until 20260930000002 bound the same guard to BEFORE INSERT.
BEGIN;
SELECT plan(25);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000003701', 'Secondary Tenant A', 'secondary-tenant-a', 'institution', encode(extensions.gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003702', 'Secondary Tenant B', 'secondary-tenant-b', 'institution', encode(extensions.gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000003711', '00000000-0000-0000-0000-000000000000', 'sec-resident@example.test'),
  ('00000000-0000-0000-0000-000000003712', '00000000-0000-0000-0000-000000000000', 'sec-supervisor@example.test'),
  ('00000000-0000-0000-0000-000000003713', '00000000-0000-0000-0000-000000000000', 'sec-director@example.test'),
  ('00000000-0000-0000-0000-000000003714', '00000000-0000-0000-0000-000000000000', 'sec-peer@example.test'),
  -- A non-privileged evaluator. The evaluator and subject branches of the
  -- guards are resident-facing workflows, so exercising them as a supervisor
  -- would take the privileged AAL2 branch instead and prove nothing.
  ('00000000-0000-0000-0000-000000003715', '00000000-0000-0000-0000-000000000000', 'sec-evaluator@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000003711',
  '00000000-0000-0000-0000-000000003712',
  '00000000-0000-0000-0000-000000003713',
  '00000000-0000-0000-0000-000000003714',
  '00000000-0000-0000-0000-000000003715'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000003721', '00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003711', 'resident', 'Sec Resident', 'active'),
  ('00000000-0000-0000-0000-000000003722', '00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003712', 'supervisor', 'Sec Supervisor', 'active'),
  ('00000000-0000-0000-0000-000000003723', '00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003713', 'director', 'Sec Director', 'active'),
  ('00000000-0000-0000-0000-000000003724', '00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003714', 'resident', 'Sec Peer', 'active'),
  ('00000000-0000-0000-0000-000000003725', '00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003715', 'resident', 'Sec Evaluator', 'active');

-- The signed fixture is evaluated by the supervisor (3731), so the AAL2 gate
-- is what a privileged session hits. A second form carries the non-privileged
-- evaluator, which is the row the resident-facing branches may edit.
INSERT INTO public.evaluation_forms (id, tenant_id, resident_id, evaluator_id, form_type, ratings, overall_score, status)
VALUES
  ('00000000-0000-0000-0000-000000003731', '00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003721', '00000000-0000-0000-0000-000000003722', 'mini_cex', '{"domains":[]}'::jsonb, 3.5, 'completed'),
  ('00000000-0000-0000-0000-000000003732', '00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003721', '00000000-0000-0000-0000-000000003725', 'mini_cex', '{"domains":[]}'::jsonb, 3.0, 'completed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.faculty_evaluations (id, tenant_id, resident_id, evaluator_id, clinical_skills, professionalism, procedures, comments)
VALUES
  ('00000000-0000-0000-0000-000000003741', '00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003721', '00000000-0000-0000-0000-000000003722', 3, 3, 3, 'solid'),
  ('00000000-0000-0000-0000-000000003742', '00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003721', '00000000-0000-0000-0000-000000003725', 3, 3, 3, 'by the peer evaluator')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rotations (id, tenant_id, resident_id, title, start_date, end_date, status)
VALUES ('00000000-0000-0000-0000-000000003751', '00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003721', 'Ward block', '2026-09-01', '2026-10-01', 'scheduled')
ON CONFLICT (id) DO NOTHING;

-- 1. The shared AAL2 gate exists and is not client-callable.
SELECT has_function(
  'public',
  'privileged_clinical_write_authorized',
  ARRAY['uuid'],
  'shared AAL2 gate for secondary clinical writes exists'
);
SELECT is(
  has_function_privilege('anon', 'public.privileged_clinical_write_authorized(uuid)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute the secondary-write gate'
);

-- 2. AAL1 privileged principals are refused on every secondary clinical table.
--    Each case uses a principal whose RLS policy actually admits the row: RLS
--    filters rows before a BEFORE ROW trigger runs, so a caller the policy does
--    not admit would update zero rows and raise nothing, and the assertion would
--    pass or fail for the wrong reason. rotations_update_director admits only a
--    director or institution administrator, so the rotation case runs as the
--    director.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003712","role":"authenticated","aal":"aal1"}';

SELECT throws_ok(
  $$UPDATE public.evaluation_forms SET overall_score = 5.0 WHERE id = '00000000-0000-0000-0000-000000003731'$$,
  '42501',
  NULL,
  'AAL1 supervisor cannot rewrite an evaluation score'
);
SELECT throws_ok(
  $$UPDATE public.faculty_evaluations SET clinical_skills = 5 WHERE id = '00000000-0000-0000-0000-000000003741'$$,
  '42501',
  NULL,
  'AAL1 supervisor cannot rewrite a faculty evaluation score'
);
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003713","role":"authenticated","aal":"aal1"}';
SELECT throws_ok(
  $$UPDATE public.rotations SET status = 'cancelled' WHERE id = '00000000-0000-0000-0000-000000003751'$$,
  '42501',
  NULL,
  'AAL1 director cannot rewrite the rotation schedule'
);

-- 3. The same principals at AAL2 are allowed: the change is the claim, not the role.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003712","role":"authenticated","aal":"aal2"}';
SELECT lives_ok(
  $$UPDATE public.evaluation_forms SET overall_score = 4.0 WHERE id = '00000000-0000-0000-0000-000000003731'$$,
  'AAL2 supervisor can rewrite an evaluation score'
);
-- The rotation policy admits a director or institution administrator, so the
-- positive case runs as the director. Run as a supervisor it would match no row
-- and pass without the trigger ever being consulted.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003713","role":"authenticated","aal":"aal2"}';
SELECT lives_ok(
  $$UPDATE public.rotations SET status = 'active' WHERE id = '00000000-0000-0000-0000-000000003751'$$,
  'AAL2 director can rewrite the rotation schedule'
);
SELECT lives_ok(
  $$INSERT INTO public.faculty_evaluations (tenant_id, resident_id, evaluator_id, clinical_skills) VALUES ('00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003721', '00000000-0000-0000-0000-000000003722', 4)$$,
  'AAL2 supervisor can file a faculty evaluation'
);

-- 3b. Filing a signed evaluation is the same record as editing one, so the
--     INSERT direction carries the same AAL2 requirement. The status guard
--     permits 'completed' on insert by design, which is exactly what made an
--     AAL1 filing a one-request bypass of SEC-010.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003712","role":"authenticated","aal":"aal2"}';
SELECT has_function(
  'public',
  'authorize_evaluation_form_insert',
  NULL,
  'the evaluation_forms insert-direction guard exists'
);
SELECT lives_ok(
  $$INSERT INTO public.evaluation_forms (tenant_id, resident_id, evaluator_id, form_type, ratings, overall_score, status)
    VALUES ('00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003721', '00000000-0000-0000-0000-000000003722', 'mini_cex', '{"domains":[]}'::jsonb, 4.0, 'completed')$$,
  'AAL2 supervisor can file a completed evaluation: the change is the claim, not the role'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003712","role":"authenticated","aal":"aal1"}';
SELECT throws_ok(
  $$INSERT INTO public.evaluation_forms (tenant_id, resident_id, evaluator_id, form_type, ratings, overall_score, status)
    VALUES ('00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003721', '00000000-0000-0000-0000-000000003722', 'mini_cex', '{"domains":[]}'::jsonb, 5.0, 'completed')$$,
  '42501',
  NULL,
  'AAL1 supervisor cannot file a completed evaluation'
);
SELECT is_empty(
  $$SELECT id FROM public.evaluation_forms WHERE overall_score = 5.0 AND form_type = 'mini_cex'$$,
  'the refused AAL1 evaluation filing persisted nothing'
);

-- 3c. The subject may not file their own evaluation, even through the
--     privileged branch and even at AAL2.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003712","role":"authenticated","aal":"aal2"}';
SELECT throws_ok(
  $$INSERT INTO public.evaluation_forms (tenant_id, resident_id, evaluator_id, form_type, ratings, overall_score, status)
    VALUES ('00000000-0000-0000-0000-000000003701', '00000000-0000-0000-0000-000000003722', '00000000-0000-0000-0000-000000003722', 'mini_cex', '{"domains":[]}'::jsonb, 4.0, 'completed')$$,
  '42501',
  NULL,
  'a supervisor cannot file an evaluation of themselves as the subject'
);

-- 4. A privileged write into ANOTHER tenant is refused, not merely AAL2-checked.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003713","role":"authenticated","aal":"aal2"}';
SELECT is(
  public.privileged_clinical_write_authorized('00000000-0000-0000-0000-000000003702'),
  false,
  'an AAL2 director holds no authority over another tenant'
);
SELECT is(
  public.privileged_clinical_write_authorized('00000000-0000-0000-0000-000000003701'),
  true,
  'an AAL2 director holds authority in their own tenant'
);

-- 5. Resident workflows are untouched.
--    The evaluator may edit their own form; a subject may acknowledge one; a
--    same-tenant peer is not a writer on faculty_evaluations at all.
--
--    These run as the non-privileged evaluator (user 3715, profile 3725). Using
--    a supervisor here would take the privileged AAL2 branch instead, so the
--    assertion would prove the gate rather than the resident-facing path.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003715","role":"authenticated","aal":"aal1"}';
SELECT lives_ok(
  $$UPDATE public.evaluation_forms SET feedback = 'good technique' WHERE id = '00000000-0000-0000-0000-000000003732'$$,
  'an evaluator may edit their own form at AAL1'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003711","role":"authenticated","aal":"aal1"}';
SELECT lives_ok(
  $$UPDATE public.evaluation_forms SET status = 'acknowledged' WHERE id = '00000000-0000-0000-0000-000000003732'$$,
  'a subject may acknowledge a completed evaluation at AAL1'
);
SELECT throws_ok(
  $$UPDATE public.evaluation_forms SET feedback = 'edited by the subject' WHERE id = '00000000-0000-0000-0000-000000003732'$$,
  '42501',
  NULL,
  'a subject cannot edit evaluation content while acknowledging'
);

-- 5b. SEC-004: an acknowledged evaluation is sealed. The evaluator is the one
--     principal the authorize trigger lets through, so this is the path that
--     actually reaches enforce_evaluation_form_status, which refuses to reopen
--     a sealed record regardless of the caller's role.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003715","role":"authenticated","aal":"aal1"}';
SELECT throws_ok(
  $$UPDATE public.evaluation_forms SET status = 'completed' WHERE id = '00000000-0000-0000-0000-000000003732'$$,
  'P0001',
  NULL,
  'an acknowledged evaluation is sealed against its own evaluator'
);

-- A same-tenant peer is refused by the RLS policy, which admits only the row's
-- evaluator or a privileged role. The peer is not a writer, so the UPDATE
-- matches no row and raises nothing: how a policy refusal appears is a statement
-- that succeeds having changed nothing, not an exception. Asserting a throw
-- would demand behaviour the database does not have.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003714","role":"authenticated","aal":"aal1"}';
SELECT lives_ok(
  $$UPDATE public.faculty_evaluations SET comments = 'edited by a peer' WHERE id = '00000000-0000-0000-0000-000000003741'$$,
  'a same-tenant peer's faculty write matches no row rather than raising'
);
SELECT is_empty(
  $$SELECT id FROM public.faculty_evaluations WHERE comments = 'edited by a peer'$$,
  'the peer write did not reach the record'
);

-- 6. Faculty scores are write-once, so the reported averages cannot move after
--    the fact without a new evaluation being filed.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003715","role":"authenticated","aal":"aal1"}';
SELECT throws_ok(
  $$UPDATE public.faculty_evaluations SET clinical_skills = 5 WHERE id = '00000000-0000-0000-0000-000000003742'$$,
  '42501',
  NULL,
  'an evaluator cannot rewrite their own faculty scores after filing'
);
SELECT lives_ok(
  $$UPDATE public.faculty_evaluations SET comments = 'addendum' WHERE id = '00000000-0000-0000-0000-000000003742'$$,
  'an evaluator may still annotate their own faculty evaluation'
);

-- 7. The tenant-wide FOR ALL policy is gone: it is what made any tenant member a
--    writer.
SELECT is_empty(
  $$
    SELECT policy_record.polname
    FROM pg_policies AS policy_record
    WHERE policy_record.schemaname = 'public'
      AND policy_record.tablename = 'faculty_evaluations'
      AND policy_record.qual IS NULL
      AND policy_record.with_check IS NULL
  $$,
  'no unconditional tenant-wide policy remains on faculty_evaluations'
);

RESET ROLE;
SELECT is(
  (SELECT clinical_skills FROM public.faculty_evaluations WHERE id = '00000000-0000-0000-0000-000000003741'),
  3,
  'the original faculty score survived every refused edit'
);

ROLLBACK;
