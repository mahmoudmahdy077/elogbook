-- p1_32: clinical approval/command boundary (SPEC-CLINICAL-CORE sections 4, 5.2, 6.1, 6.2, 6.3).
--
-- Proves AAL2 is authoritative at the database/command boundary rather than
-- only at the approve_case/reject_case wrapper:
--   1-2  an AAL1 privileged session cannot approve or reject by direct write
--   3    an AAL1 privileged session cannot directly resolve an approval request
--   4    an AAL1 privileged session cannot tombstone an approved clinical record
--   5-6  a resident cannot tombstone an approved clinical record
--   7-8  an AAL2 decide command approves, and is idempotent on replay
--   9    the decide command refuses a cross-tenant case
--   10   a resident cannot move rejected -> pending by direct write
--   11   the submit command moves rejected -> pending and creates the request
--   12   submit fails closed when the tenant has no eligible reviewer
--   13   the submit command is idempotent on replay
--   14-15 the command RPCs are authenticated-only
BEGIN;
SELECT plan(19);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000003201', 'Command Tenant A', 'command-tenant-a', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003202', 'Command Tenant B', 'command-tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003203', 'Command Tenant No Reviewer', 'command-tenant-nr', 'institution', encode(gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000003211', '00000000-0000-0000-0000-000000000000', 'cmd-supervisor@example.test'),
  ('00000000-0000-0000-0000-000000003212', '00000000-0000-0000-0000-000000000000', 'cmd-resident@example.test'),
  ('00000000-0000-0000-0000-000000003213', '00000000-0000-0000-0000-000000000000', 'cmd-outsider@example.test'),
  ('00000000-0000-0000-0000-000000003214', '00000000-0000-0000-0000-000000000000', 'cmd-nr-resident@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000003211',
  '00000000-0000-0000-0000-000000003212',
  '00000000-0000-0000-0000-000000003213',
  '00000000-0000-0000-0000-000000003214'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000003221', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003211', 'supervisor', 'Command Supervisor', 'active'),
  ('00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003212', 'resident', 'Command Resident', 'active'),
  ('00000000-0000-0000-0000-000000003223', '00000000-0000-0000-0000-000000003202', '00000000-0000-0000-0000-000000003213', 'supervisor', 'Outsider Supervisor', 'active'),
  ('00000000-0000-0000-0000-000000003224', '00000000-0000-0000-0000-000000003203', '00000000-0000-0000-0000-000000003214', 'resident', 'No Reviewer Resident', 'active');

INSERT INTO public.case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES
  ('00000000-0000-0000-0000-000000003231', '00000000-0000-0000-0000-000000003201', 'surgery', 'Command Template', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000003232', '00000000-0000-0000-0000-000000003202', 'surgery', 'Outsider Template', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000003233', '00000000-0000-0000-0000-000000003203', 'surgery', 'No Reviewer Template', '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, case_date, status, is_deidentified, field_values)
VALUES
  ('00000000-0000-0000-0000-000000003241', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003231', CURRENT_DATE, 'pending', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000003242', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003231', CURRENT_DATE, 'pending', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000003243', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003231', CURRENT_DATE, 'approved', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000003244', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003231', CURRENT_DATE, 'rejected', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000003245', '00000000-0000-0000-0000-000000003202', '00000000-0000-0000-0000-000000003223', '00000000-0000-0000-0000-000000003232', CURRENT_DATE, 'pending', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000003246', '00000000-0000-0000-0000-000000003203', '00000000-0000-0000-0000-000000003224', '00000000-0000-0000-0000-000000003233', CURRENT_DATE, 'draft', true, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 1-2. AAL1 direct approve/reject is denied by the state machine even if a
--      policy were ever to let the row through.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal1"}';

SELECT is(
  (WITH changed AS (
    UPDATE public.case_entries SET status = 'approved'
    WHERE id = '00000000-0000-0000-0000-000000003241'
    RETURNING id
  ) SELECT count(*) FROM changed),
  0::bigint,
  'an AAL1 supervisor cannot approve a case by direct write'
);
SELECT is(
  (WITH changed AS (
    UPDATE public.case_entries SET status = 'rejected'
    WHERE id = '00000000-0000-0000-0000-000000003242'
    RETURNING id
  ) SELECT count(*) FROM changed),
  0::bigint,
  'an AAL1 supervisor cannot reject a case by direct write'
);

-- 3. The approval ledger is not writable by a privileged direct write.
SELECT is(
  (WITH changed AS (
    UPDATE public.approval_requests SET status = 'approved', resolved_at = NOW()
    WHERE entry_id = '00000000-0000-0000-0000-000000003241'
    RETURNING id
  ) SELECT count(*) FROM changed),
  0::bigint,
  'an AAL1 supervisor cannot resolve an approval request by direct write'
);

-- 4. Approved clinical records are not directly tombstoneable.
SELECT is(
  (WITH changed AS (
    UPDATE public.case_entries SET deleted_at = NOW()
    WHERE id = '00000000-0000-0000-0000-000000003243'
    RETURNING id
  ) SELECT count(*) FROM changed),
  0::bigint,
  'an AAL1 supervisor cannot tombstone an approved clinical record'
);

-- 5-6. Nor by the owning resident.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';
SELECT is(
  (WITH changed AS (
    UPDATE public.case_entries SET deleted_at = NOW()
    WHERE id = '00000000-0000-0000-0000-000000003243'
    RETURNING id
  ) SELECT count(*) FROM changed),
  0::bigint,
  'a resident cannot tombstone an approved clinical record'
);

-- 10. A resident cannot self-escalate a rejected case into the approval queue.
--     The BEFORE trigger raises before the RLS WITH CHECK is evaluated.
SELECT throws_ok(
  $$UPDATE public.case_entries
     SET status = 'pending'
     WHERE id = '00000000-0000-0000-0000-000000003244'$$,
  NULL,
  'a resident cannot move rejected -> pending by direct write'
);
SELECT is(
  (SELECT status FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000003244'),
  'rejected',
  'the rejected case is still rejected after the denied direct write'
);

-- 7-8. The AAL2 decide command approves, and replays without re-applying.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal2"}';
INSERT INTO public.approval_requests (entry_id, supervisor_id, tenant_id, status)
VALUES ('00000000-0000-0000-0000-000000003241', '00000000-0000-0000-0000-000000003221', '00000000-0000-0000-0000-000000003201', 'pending')
ON CONFLICT (entry_id, supervisor_id) DO NOTHING;

SELECT is(
  (SELECT public.decide_case_command(
    '00000000-0000-0000-0000-000000003241', 'p1-32-decide-1', 'approve', 'reviewed') ->> 'status'),
  'approved',
  'an AAL2 supervisor approves through the decide command'
);
SELECT is(
  (SELECT public.decide_case_command(
    '00000000-0000-0000-0000-000000003241', 'p1-32-decide-1', 'approve', 'reviewed') ->> 'status'),
  'approved',
  'replaying the same request id returns the stored decision'
);
SELECT is(
  (SELECT count(*) FROM public.audit_outbox WHERE resource_id = '00000000-0000-0000-0000-000000003241' AND action = 'case_decide'),
  1::bigint,
  'a replayed decision does not duplicate the outbox event'
);

-- 9. Cross-tenant decisions are refused.
SELECT is(
  (SELECT public.decide_case_command(
    '00000000-0000-0000-0000-000000003245', 'p1-32-decide-x', 'approve', NULL) ->> 'error'),
  'not_found',
  'a command cannot decide a case in another tenant'
);

-- 11. The submit command takes a rejected case to pending and creates the request.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';
SELECT is(
  (SELECT public.submit_case_command('00000000-0000-0000-0000-000000003244', 'p1-32-submit-1', 'rejected') ->> 'status'),
  'pending',
  'the submit command moves a rejected case to pending'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.approval_requests
    WHERE entry_id = '00000000-0000-0000-0000-000000003244'
      AND status = 'pending'
  ),
  'reaching pending always creates the approval request'
);

-- 12. Fail closed when the tenant has no eligible reviewer.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003214","role":"authenticated","aal":"aal1"}';
SELECT is(
  (SELECT public.submit_case_command('00000000-0000-0000-0000-000000003246', 'p1-32-submit-nr', NULL) ->> 'code'),
  'no_eligible_reviewer',
  'submit fails closed when the tenant has no eligible reviewer'
);
SELECT is(
  (SELECT status FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000003246'),
  'draft',
  'the unsubmittable case remains a draft'
);

-- 13. The submit command is idempotent on replay.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';
SELECT is(
  (SELECT public.submit_case_command('00000000-0000-0000-0000-000000003244', 'p1-32-submit-1', 'rejected') ->> 'status'),
  'pending',
  'replaying a submit returns the stored result'
);
SELECT is(
  (SELECT count(*) FROM public.approval_requests WHERE entry_id = '00000000-0000-0000-0000-000000003244'),
  1::bigint,
  'a replayed submit does not duplicate the approval request'
);

-- 14-15. Command grants are authenticated-only.
RESET ROLE;
SELECT is(
  has_function_privilege('anon', 'public.decide_case_command(uuid,text,text,text)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute the decide command'
);
SELECT is(
  has_function_privilege('anon', 'public.submit_case_command(uuid,text,text)', 'EXECUTE'),
  false,
  'anonymous callers cannot execute the submit command'
);

ROLLBACK;
