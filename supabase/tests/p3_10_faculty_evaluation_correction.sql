-- p3_10: public.correct_faculty_evaluation -- the one supported way to correct a
-- faculty evaluation, and the trigger change that makes it the ONLY way.
--
-- 20260927000002 made faculty evaluation scores write-once for the evaluator and
-- required AAL2 for a privileged write. That is fail-closed, and it left a real
-- problem with no supported answer: a score entered in good faith and filed cannot
-- be fixed. The only route left was to file a second evaluation, which changes
-- the count a program reports as well as the average, so the correction and its
-- audit trail are both destroyed.
--
-- The alternative -- "let an admin UPDATE it" -- is a bypass with an admin
-- costume on. A role label plus a fresh MFA is not an accountable correction; it
-- is an unattributed rewrite with a re-authentication step in front of it.
--
-- So the correction is a command, not a permission:
--
--   * public.correct_faculty_evaluation is the only writer of the score columns,
--     and it requires a live AAL2 privileged principal, the caller's own tenant,
--     and the target row in that tenant.
--
--   * It requires a reason. A correction without a stated reason is not a
--     correction, it is an edit with extra steps.
--
--   * It appends to public.faculty_evaluation_corrections, which records the
--     scores as they were and the scores as they now are. The original values
--     are preserved immutably, so the reported averages can be explained after
--     the fact rather than merely changed.
--
--   * That history table has no policy and no client grant, and its UPDATE and
--     DELETE are refused unconditionally -- including for the table owner. There
--     is no window in which the record of a correction can itself be edited.
--
--   * The write guard now refuses a score change for EVERY caller, privileged
--     included. Previously the privileged branch returned NEW unconditionally,
--     so the write-once rule was really an evaluator rule and an AAL2 admin could
--     move a score directly. The only exception is a correction the caller filed
--     themselves, in this transaction, recording exactly the values being written
--     and only while the row does not already hold them. A forged context flag
--     therefore buys nothing: without a matching record there is nothing to match.
--
--   * The subject, the evaluator and the tenant are immutable on UPDATE, for
--     every caller and before every branch. A retarget changes whose assessment
--     the row is, which a correction record cannot account for because it holds
--     scores and not a subject. The subject also has no write path at all, even
--     by naming themselves the evaluator.
--
--   * DELETE is guarded, which the earlier migration documented but did not
--     implement: the evaluator of the row, or a live AAL2 privileged principal.
--     The subject can neither edit nor delete their own assessment.
--
--   * Idempotency is on (tenant, idempotency_key). A retried command returns the
--     original correction rather than filing a second one, and reusing a key for a
--     different evaluation is a conflict rather than a silent overwrite.
BEGIN;
SELECT plan(41);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000004101', 'Correction Tenant A', 'correction-tenant-a', 'institution', encode(extensions.gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000004102', 'Correction Tenant B', 'correction-tenant-b', 'institution', encode(extensions.gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000004111', '00000000-0000-0000-0000-000000000000', 'corr-supervisor-a@example.test'),
  ('00000000-0000-0000-0000-000000004112', '00000000-0000-0000-0000-000000000000', 'corr-director-b@example.test'),
  ('00000000-0000-0000-0000-000000004113', '00000000-0000-0000-0000-000000000000', 'corr-resident-a@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000004111',
  '00000000-0000-0000-0000-000000004112',
  '00000000-0000-0000-0000-000000004113'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000004121', '00000000-0000-0000-0000-000000004101', '00000000-0000-0000-0000-000000004111', 'supervisor', 'Corr Supervisor A', 'active'),
  ('00000000-0000-0000-0000-000000004122', '00000000-0000-0000-0000-000000004102', '00000000-0000-0000-0000-000000004112', 'director', 'Corr Director B', 'active'),
  ('00000000-0000-0000-0000-000000004123', '00000000-0000-0000-0000-000000004101', '00000000-0000-0000-0000-000000004113', 'resident', 'Corr Resident A', 'active');

INSERT INTO public.faculty_evaluations (id, tenant_id, resident_id, evaluator_id, clinical_skills, professionalism, procedures, comments)
VALUES
  ('00000000-0000-0000-0000-000000004141', '00000000-0000-0000-0000-000000004101', '00000000-0000-0000-0000-000000004123', '00000000-0000-0000-0000-000000004121', 3, 3, 3, 'solid'),
  ('00000000-0000-0000-0000-000000004142', '00000000-0000-0000-0000-000000004101', '00000000-0000-0000-0000-000000004123', '00000000-0000-0000-0000-000000004121', 4, 4, 4, 'good'),
  ('00000000-0000-0000-0000-000000004143', '00000000-0000-0000-0000-000000004102', '00000000-0000-0000-0000-000000004123', '00000000-0000-0000-0000-000000004121', 2, 2, 2, 'other tenant'),
  -- Two rows reserved for the DELETE cases, so removing one does not disturb any
  -- assertion above. 004144 is evaluated by the tenant A supervisor, who is
  -- neither its evaluator nor its subject; 004145 is evaluated by the tenant B
  -- director, so the evaluator's own delete is a cross-tenant caller's path.
  ('00000000-0000-0000-0000-000000004144', '00000000-0000-0000-0000-000000004101', '00000000-0000-0000-0000-000000004123', '00000000-0000-0000-0000-000000004122', 3, 3, 3, 'for the delete cases'),
  ('00000000-0000-0000-0000-000000004145', '00000000-0000-0000-0000-000000004101', '00000000-0000-0000-0000-000000004123', '00000000-0000-0000-0000-000000004121', 3, 3, 3, 'the evaluator removes this one')
ON CONFLICT (id) DO NOTHING;

-- 1-3. Catalog: the command exists, is a definer, and pins its search_path.
SELECT has_function(
  'public',
  'correct_faculty_evaluation',
  ARRAY['uuid', 'uuid', 'text', 'jsonb', 'text'],
  'correct_faculty_evaluation exists with the documented signature'
);
SELECT ok(
  COALESCE((
    SELECT function_record.prosecdef
    FROM pg_proc AS function_record
    WHERE function_record.oid = to_regprocedure('public.correct_faculty_evaluation(uuid,uuid,text,jsonb,text)')
  ), false),
  'the correction command is SECURITY DEFINER'
);
SELECT ok(
  COALESCE((
    SELECT bool_and(config_entry LIKE 'search_path=%')
    FROM unnest(COALESCE(
      (SELECT function_record.proconfig
       FROM pg_proc AS function_record
       WHERE function_record.oid = to_regprocedure('public.correct_faculty_evaluation(uuid,uuid,text,jsonb,text)')),
      ARRAY[]::TEXT[]
    )) AS config_entry
  ), false),
  'the correction command pins a search_path'
);

-- 4-7. Grants: authenticated, and only authenticated. The command is the whole
--      point, so a service_role grant on it would be an unreviewed definer.
SELECT is(
  has_function_privilege('anon', 'public.correct_faculty_evaluation(uuid,uuid,text,jsonb,text)', 'EXECUTE'),
  false,
  'anon cannot execute the correction command'
);
SELECT is(
  has_function_privilege('public', 'public.correct_faculty_evaluation(uuid,uuid,text,jsonb,text)', 'EXECUTE'),
  false,
  'PUBLIC cannot execute the correction command'
);
SELECT is(
  has_function_privilege('authenticated', 'public.correct_faculty_evaluation(uuid,uuid,text,jsonb,text)', 'EXECUTE'),
  true,
  'authenticated can execute the correction command'
);
SELECT is(
  has_function_privilege('service_role', 'public.correct_faculty_evaluation(uuid,uuid,text,jsonb,text)', 'EXECUTE'),
  false,
  'service_role cannot execute the correction command'
);

-- 8-9. The correction history is reachable only through the command.
SELECT ok(
  (
    SELECT class_record.relrowsecurity AND class_record.relforcerowsecurity
    FROM pg_class AS class_record
    WHERE class_record.oid = to_regclass('public.faculty_evaluation_corrections')
  ),
  'the correction history has row-level security enabled and forced'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.faculty_evaluation_corrections', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.faculty_evaluation_corrections', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.faculty_evaluation_corrections', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.faculty_evaluation_corrections', 'SELECT'),
  'no client role can read or write the correction history directly'
);

SET LOCAL ROLE authenticated;

-- 10. AAL1 is refused. Re-authentication is the attribute that makes a correction
--     attributable, so it is required, not recommended.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004111","role":"authenticated","aal":"aal1"}';
SELECT is(
  public.correct_faculty_evaluation(
    '00000000-0000-0000-0000-000000004101',
    '00000000-0000-0000-0000-000000004141',
    'score entered against the wrong criterion',
    '{"clinical_skills":5}'::JSONB,
    'corr-key-aal1'
  ) ->> 'error',
  'forbidden',
  'an AAL1 supervisor cannot correct a faculty evaluation'
);

-- 11. A resident cannot, at any assurance level.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004113","role":"authenticated","aal":"aal2"}';
SELECT is(
  public.correct_faculty_evaluation(
    '00000000-0000-0000-0000-000000004101',
    '00000000-0000-0000-0000-000000004141',
    'subject correcting their own assessment',
    '{"clinical_skills":5}'::JSONB,
    'corr-key-resident'
  ) ->> 'error',
  'forbidden',
  'the subject of the evaluation cannot correct it'
);

-- 12-14. A reason is not optional.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004111","role":"authenticated","aal":"aal2"}';
SELECT is(
  public.correct_faculty_evaluation(
    '00000000-0000-0000-0000-000000004101',
    '00000000-0000-0000-0000-000000004141',
    '   ',
    '{"clinical_skills":5}'::JSONB,
    'corr-key-blank'
  ) ->> 'error',
  'reason_required',
  'a blank reason is refused'
);
SELECT is(
  public.correct_faculty_evaluation(
    '00000000-0000-0000-0000-000000004101',
    '00000000-0000-0000-0000-000000004141',
    'typo',
    '{"clinical_skills":5}'::JSONB,
    'corr-key-short'
  ) ->> 'error',
  'reason_required',
  'a reason too short to be a reason is refused'
);

-- 15-16. Cross-tenant: the argument must be the caller's own, and a row in another
--       tenant is not found rather than refused, so the command is not an
--       existence oracle for other institutions.
SELECT is(
  public.correct_faculty_evaluation(
    '00000000-0000-0000-0000-000000004102',
    '00000000-0000-0000-0000-000000004141',
    'score entered against the wrong criterion',
    '{"clinical_skills":5}'::JSONB,
    'corr-key-xtenant'
  ) ->> 'error',
  'forbidden',
  'a caller cannot correct in a tenant that is not their own'
);
SELECT is(
  public.correct_faculty_evaluation(
    '00000000-0000-0000-0000-000000004101',
    '00000000-0000-0000-0000-000000004143',
    'score entered against the wrong criterion',
    '{"clinical_skills":5}'::JSONB,
    'corr-key-xrow'
  ) ->> 'error',
  'evaluation_not_found',
  'a row in another tenant is not found rather than refused'
);
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004112","role":"authenticated","aal":"aal2"}';
SELECT is(
  public.correct_faculty_evaluation(
    '00000000-0000-0000-0000-000000004101',
    '00000000-0000-0000-0000-000000004141',
    'cross tenant director reaching into tenant A',
    '{"clinical_skills":5}'::JSONB,
    'corr-key-xdir'
  ) ->> 'error',
  'evaluation_not_found',
  'a director of another tenant cannot reach this tenant''s row'
);

-- 17-19. The command itself: AAL2 privileged principal, own tenant, own row.
--
-- Nothing here reads faculty_evaluation_corrections. The table has no SELECT
-- policy, so a client read of it returns nothing at all -- which is the point, and
-- which means these assertions have to be about the command's own contract and the
-- row it acts on. The history is read below, as the table owner.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004111","role":"authenticated","aal":"aal2"}';
SELECT ok(
  COALESCE((
    SELECT (public.correct_faculty_evaluation(
      '00000000-0000-0000-0000-000000004101',
      '00000000-0000-0000-0000-000000004141',
      'clinical skills were entered against the wrong criterion',
      '{"clinical_skills":5}'::JSONB,
      'corr-key-1'
    ) ->> 'success')::BOOLEAN
  ), false),
  'an AAL2 supervisor can file a correction in their own tenant'
);
SELECT is(
  (SELECT clinical_skills FROM public.faculty_evaluations WHERE id = '00000000-0000-0000-0000-000000004141'),
  5,
  'the corrected score is in force on the row'
);

-- 20-21. Idempotency: a retry is answered from the record, not by writing again.
SELECT is(
  public.correct_faculty_evaluation(
    '00000000-0000-0000-0000-000000004101',
    '00000000-0000-0000-0000-000000004141',
    'clinical skills were entered against the wrong criterion',
    '{"clinical_skills":5}'::JSONB,
    'corr-key-1'
  ) ->> 'replayed',
  'true',
  'a retried command is answered from the original correction'
);
SELECT is(
  (SELECT clinical_skills FROM public.faculty_evaluations WHERE id = '00000000-0000-0000-0000-000000004141'),
  5,
  'a retried command leaves the corrected score alone'
);

-- 22. Reusing a key for a different evaluation is a conflict, not an overwrite.
SELECT is(
  public.correct_faculty_evaluation(
    '00000000-0000-0000-0000-000000004101',
    '00000000-0000-0000-0000-000000004142',
    'second correction under the same key',
    '{"clinical_skills":2}'::JSONB,
    'corr-key-1'
  ) ->> 'error',
  'idempotency_conflict',
  'reusing an idempotency key for another evaluation is refused'
);

-- 23-24. The write guard: a score change is refused for every caller except the
--        correction command, and a forged context flag is not a substitute -- the
--        flag alone authorises nothing, only a record the caller actually filed.
SELECT throws_ok(
  $$UPDATE public.faculty_evaluations SET clinical_skills = 1 WHERE id = '00000000-0000-0000-0000-000000004141'$$,
  '42501',
  NULL,
  'an AAL2 supervisor cannot rewrite a score directly'
);
SELECT set_config('app.faculty_correction', 'on', true);
SELECT throws_ok(
  $$UPDATE public.faculty_evaluations SET clinical_skills = 4 WHERE id = '00000000-0000-0000-0000-000000004141'$$,
  '42501',
  NULL,
  'a forged correction flag does not authorise a score change'
);

-- 25-27. Read as the table owner: the record, the count, and the audit row.
RESET ROLE;
SELECT is(
  (
    SELECT correction.original_clinical_skills
    FROM public.faculty_evaluation_corrections AS correction
    WHERE correction.faculty_evaluation_id = '00000000-0000-0000-0000-000000004141'
  ),
  3,
  'the correction record preserves the original score immutably'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.faculty_evaluation_corrections
    WHERE faculty_evaluation_id = '00000000-0000-0000-0000-000000004141'
  ),
  1::BIGINT,
  'a retried command files no second correction'
);
SELECT is(
  (
    SELECT audit_entry.changes ->> 'corrected_clinical_skills'
    FROM public.audit_logs AS audit_entry
    WHERE audit_entry.action = 'correct_faculty_evaluation'
      AND audit_entry.resource_id = '00000000-0000-0000-0000-000000004141'
    ORDER BY audit_entry.created_at DESC
    LIMIT 1
  ),
  '5',
  'the audit row records the corrected value and nothing free-text'
);

-- 28-29. The history is append-only, including for the table owner: even superuser
--        cannot rewrite or remove the record of a correction.
SELECT throws_ok(
  $$UPDATE public.faculty_evaluation_corrections SET reason = 'rewritten' WHERE faculty_evaluation_id = '00000000-0000-0000-0000-000000004141'$$,
  '42501',
  NULL,
  'a correction record cannot be edited, not even by the table owner'
);
SELECT throws_ok(
  $$DELETE FROM public.faculty_evaluation_corrections WHERE faculty_evaluation_id = '00000000-0000-0000-0000-000000004141'$$,
  '42501',
  NULL,
  'a correction record cannot be deleted, not even by the table owner'
);

-- 29-35. The frame around the scores is immutable, for every caller. The
--        privileged branch required AAL2 and then annotated freely, so an AAL2
--        supervisor could move an evaluation onto another resident, another
--        evaluator or another tenant: a bigger claim than a score correction, and
--        one the correction record cannot account for because it holds scores
--        and not a subject. AAL2 is the strongest attacker here, so that is the
--        session the refusals are proved against.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004111","role":"authenticated","aal":"aal2"}';
SELECT throws_ok(
  $$UPDATE public.faculty_evaluations SET resident_id = '00000000-0000-0000-0000-000000004122' WHERE id = '00000000-0000-0000-0000-000000004141'$$,
  '42501',
  NULL,
  'a privileged update cannot retarget the subject of an evaluation'
);
SELECT throws_ok(
  $$UPDATE public.faculty_evaluations SET evaluator_id = '00000000-0000-0000-0000-000000004122' WHERE id = '00000000-0000-0000-0000-000000004141'$$,
  '42501',
  NULL,
  'a privileged update cannot retarget the evaluator'
);
SELECT throws_ok(
  $$UPDATE public.faculty_evaluations SET tenant_id = '00000000-0000-0000-0000-000000004102' WHERE id = '00000000-0000-0000-0000-000000004141'$$,
  '42501',
  NULL,
  'a privileged update cannot move an evaluation to another tenant'
);
RESET ROLE;
SELECT is(
  (SELECT resident_id FROM public.faculty_evaluations WHERE id = '00000000-0000-0000-0000-000000004141'),
  '00000000-0000-0000-0000-000000004123'::UUID,
  'the refused retargets left the subject alone'
);
SELECT is(
  (SELECT evaluator_id FROM public.faculty_evaluations WHERE id = '00000000-0000-0000-0000-000000004141'),
  '00000000-0000-0000-0000-000000004121'::UUID,
  'the refused retargets left the evaluator alone'
);
SET LOCAL ROLE authenticated;

-- The evaluator's own edit is not privileged, and AAL2 is not what stops it.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004111","role":"authenticated","aal":"aal1"}';
SELECT throws_ok(
  $$UPDATE public.faculty_evaluations SET resident_id = '00000000-0000-0000-0000-000000004122' WHERE id = '00000000-0000-0000-0000-000000004141'$$,
  '42501',
  NULL,
  'an evaluator cannot retarget their own evaluation'
);

-- And the correction context buys nothing: the frame is checked before the
-- correction exception is even considered, so a forged flag cannot be used to
-- move a row onto somebody else's record.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004111","role":"authenticated","aal":"aal2"}';
SELECT set_config('app.faculty_correction', 'on', true);
SELECT throws_ok(
  $$UPDATE public.faculty_evaluations SET resident_id = '00000000-0000-0000-0000-000000004122' WHERE id = '00000000-0000-0000-0000-000000004141'$$,
  '42501',
  NULL,
  'a forged correction flag cannot retarget the subject of an evaluation'
);

-- 36-39. DELETE, as the table owner so the row policies are out of the way and
--        the trigger is what is under test. RLS already refuses a non-evaluator
--        delete by filtering the row silently, which would otherwise make this
--        look like a policy result rather than an assurance-level one.
RESET ROLE;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004111","role":"authenticated","aal":"aal1"}';
SELECT throws_ok(
  $$DELETE FROM public.faculty_evaluations WHERE id = '00000000-0000-0000-0000-000000004144'$$,
  '42501',
  NULL,
  'an AAL1 privileged principal cannot delete a faculty evaluation'
);
SELECT is(
  (SELECT count(*) FROM public.faculty_evaluations WHERE id = '00000000-0000-0000-0000-000000004144'),
  1::BIGINT,
  'the refused privileged delete removed nothing'
);
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004111","role":"authenticated","aal":"aal2"}';
SELECT lives_ok(
  $$DELETE FROM public.faculty_evaluations WHERE id = '00000000-0000-0000-0000-000000004144'$$,
  'an AAL2 privileged principal can delete a faculty evaluation in their own tenant'
);
SELECT is(
  (SELECT count(*) FROM public.faculty_evaluations WHERE id = '00000000-0000-0000-0000-000000004144'),
  0::BIGINT,
  'the AAL2 delete removed the row it was authorised to remove'
);

-- 40-41. Through the row policies, the two callers that keep their path: the
--        evaluator who filed it, and the subject, who has none.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004111","role":"authenticated","aal":"aal1"}';
SELECT lives_ok(
  $$DELETE FROM public.faculty_evaluations WHERE id = '00000000-0000-0000-0000-000000004145'$$,
  'the evaluator can delete their own faculty evaluation'
);
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000004113","role":"authenticated","aal":"aal2"}';
SELECT is(
  (
    WITH removed AS (
      DELETE FROM public.faculty_evaluations
      WHERE id = '00000000-0000-0000-0000-000000004141'
      RETURNING id
    )
    SELECT count(*) FROM removed
  ),
  0::BIGINT,
  'the subject cannot delete the record of their own assessment'
);

ROLLBACK;
