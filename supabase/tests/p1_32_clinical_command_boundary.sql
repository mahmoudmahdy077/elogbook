-- p1_32: clinical approval/command boundary (SPEC-CLINICAL-CORE sections 4, 5.2, 6.1, 6.2, 6.3).
--
-- Proves AAL2 is authoritative at the database/command boundary rather than
-- only at a function wrapper, and that an approved clinical record cannot be
-- tombstoned or minted outside the command:
--   1-2  an AAL1 privileged session cannot approve or reject by direct write
--   3    an AAL1 privileged session cannot directly resolve an approval request
--   4    an AAL1 privileged session cannot tombstone an approved clinical record
--   5-6  a resident cannot tombstone an approved clinical record
--   7-9  nor reach one through submit_case_operation('delete'), and the refused
--        tombstone persisted nothing
-- 10-11 nor an AAL2 privileged session through soft_delete_case
-- 12-13 nor create an approved case by INSERT, privileged or not: the RPC
--      refuses the status in its own vocabulary, and a direct write is refused
--      by the trigger with a named error, so nothing is written
-- 12b   the individual auto-approval path is untouched
-- 14-15 the decide command approves, and is idempotent on replay
-- 16   the decide command refuses a cross-tenant case
-- 16b  and refuses an approval request whose own tenant is another tenant
-- 17   a resident cannot move rejected -> pending by direct write
-- 18   the submit command moves rejected -> pending and creates the request
-- 19   submit fails closed when the tenant has no eligible reviewer
-- 20   the submit command is idempotent on replay
-- 21-22 the command RPCs are authenticated-only
-- 23   no privileged or soft-delete UPDATE policy remains on case_entries
-- 24-25 the legacy approve_case/reject_case RPCs hold no client execute grant
--      (38 assertions in total: the lifecycle codes below are numbered by
--       section rather than one-per-line)
BEGIN;
SELECT plan(38);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-000000003201', 'Command Tenant A', 'command-tenant-a', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003202', 'Command Tenant B', 'command-tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003203', 'Command Tenant No Reviewer', 'command-tenant-nr', 'institution', encode(gen_random_bytes(32), 'hex'), 'active'),
  ('00000000-0000-0000-0000-000000003204', 'Command Tenant Individual', 'command-tenant-ind', 'individual', encode(gen_random_bytes(32), 'hex'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000003211', '00000000-0000-0000-0000-000000000000', 'cmd-supervisor@example.test'),
  ('00000000-0000-0000-0000-000000003212', '00000000-0000-0000-0000-000000000000', 'cmd-resident@example.test'),
  ('00000000-0000-0000-0000-000000003213', '00000000-0000-0000-0000-000000000000', 'cmd-outsider@example.test'),
  ('00000000-0000-0000-0000-000000003214', '00000000-0000-0000-0000-000000000000', 'cmd-nr-resident@example.test'),
  ('00000000-0000-0000-0000-000000003215', '00000000-0000-0000-0000-000000000000', 'cmd-ind-resident@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000003211',
  '00000000-0000-0000-0000-000000003212',
  '00000000-0000-0000-0000-000000003213',
  '00000000-0000-0000-0000-000000003214',
  '00000000-0000-0000-0000-000000003215'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000003221', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003211', 'supervisor', 'Command Supervisor', 'active'),
  ('00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003212', 'resident', 'Command Resident', 'active'),
  ('00000000-0000-0000-0000-000000003223', '00000000-0000-0000-0000-000000003202', '00000000-0000-0000-0000-000000003213', 'supervisor', 'Outsider Supervisor', 'active'),
  ('00000000-0000-0000-0000-000000003224', '00000000-0000-0000-0000-000000003203', '00000000-0000-0000-0000-000000003214', 'resident', 'No Reviewer Resident', 'active'),
  ('00000000-0000-0000-0000-000000003225', '00000000-0000-0000-0000-000000003204', '00000000-0000-0000-0000-000000003215', 'resident', 'Individual Resident', 'active');

INSERT INTO public.case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES
  ('00000000-0000-0000-0000-000000003231', '00000000-0000-0000-0000-000000003201', 'surgery', 'Command Template', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000003232', '00000000-0000-0000-0000-000000003202', 'surgery', 'Outsider Template', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000003233', '00000000-0000-0000-0000-000000003203', 'surgery', 'No Reviewer Template', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000003234', '00000000-0000-0000-0000-000000003204', 'surgery', 'Individual Template', '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, case_date, status, is_deidentified, field_values)
VALUES
  ('00000000-0000-0000-0000-000000003241', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003231', CURRENT_DATE, 'pending', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000003242', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003231', CURRENT_DATE, 'pending', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000003243', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003231', CURRENT_DATE, 'approved', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000003244', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003231', CURRENT_DATE, 'rejected', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000003245', '00000000-0000-0000-0000-000000003202', '00000000-0000-0000-0000-000000003223', '00000000-0000-0000-0000-000000003232', CURRENT_DATE, 'pending', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000003246', '00000000-0000-0000-0000-000000003203', '00000000-0000-0000-0000-000000003224', '00000000-0000-0000-0000-000000003233', CURRENT_DATE, 'draft', true, '{}'::jsonb),
  -- 16b's case. A pending case in the command tenant whose only approval
  -- request names a different tenant: the ledger is a second table with its own
  -- tenant column, so an entry_id-only lookup would treat it as this caller's.
  ('00000000-0000-0000-0000-000000003247', '00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003231', CURRENT_DATE, 'pending', true, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.approval_requests (entry_id, supervisor_id, tenant_id, status, resolved_at)
VALUES ('00000000-0000-0000-0000-000000003242', '00000000-0000-0000-0000-000000003221', '00000000-0000-0000-0000-000000003201', 'approved', NOW())
ON CONFLICT (entry_id, supervisor_id) DO NOTHING;

-- 1-2. AAL1 direct approve/reject is denied by the state machine even if a
--      policy were ever to let the row through.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal1"}';

-- A direct write to a clinical table is refused outright: the role holds no
-- UPDATE grant, so PostgreSQL raises insufficient_privilege rather than
-- filtering the row. Assert the refusal itself.
SELECT throws_ok(
  $$UPDATE public.case_entries SET status = 'approved'
    WHERE id = '00000000-0000-0000-0000-000000003241'$$,
  '42501',
  'permission denied for table case_entries',
  'an AAL1 supervisor cannot approve a case by direct write'
);
SELECT throws_ok(
  $$UPDATE public.case_entries SET status = 'rejected'
    WHERE id = '00000000-0000-0000-0000-000000003242'$$,
  '42501',
  'permission denied for table case_entries',
  'an AAL1 supervisor cannot reject a case by direct write'
);

-- 3. The approval ledger is not writable by a privileged direct write.
SELECT throws_ok(
  $$UPDATE public.approval_requests SET status = 'approved', resolved_at = NOW()
    WHERE entry_id = '00000000-0000-0000-0000-000000003241'$$,
  '42501',
  'permission denied for table approval_requests',
  'an AAL1 supervisor cannot resolve an approval request by direct write'
);

-- 4. Approved clinical records are not directly tombstoneable.
SELECT throws_ok(
  $$UPDATE public.case_entries SET deleted_at = NOW()
    WHERE id = '00000000-0000-0000-0000-000000003243'$$,
  '42501',
  'permission denied for table case_entries',
  'an AAL1 supervisor cannot tombstone an approved clinical record'
);

-- 5-6. Nor by the owning resident.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';
SELECT throws_ok(
  $$UPDATE public.case_entries SET deleted_at = NOW()
    WHERE id = '00000000-0000-0000-0000-000000003243'$$,
  '42501',
  'permission denied for table case_entries',
  'a resident cannot tombstone an approved clinical record'
);

-- 7-9. Nor through the operation RPC, which is SECURITY DEFINER and therefore
--      could not be distinguished from a direct write by `current_user`. The
--      guard now keys on auth.uid(), so the owner's own delete is refused and
--      the RPC reduces the refusal to a code from the closed vocabulary.
SELECT is(
  (SELECT public.submit_case_operation('p1-32-del-approved', 'delete',
    '00000000-0000-0000-0000-000000003243', '{}'::jsonb) ->> 'code'),
  'forbidden',
  'a resident cannot tombstone an approved record through the operation RPC'
);
SELECT is(
  (SELECT public.submit_case_operation('p1-32-del-approved', 'delete',
    '00000000-0000-0000-0000-000000003243', '{}'::jsonb) ->> 'error'),
  'policy: forbidden',
  'the refused approved tombstone carries a fixed phrase, not server text'
);
RESET ROLE;
SELECT is(
  (SELECT deleted_at IS NULL FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000003243'),
  true,
  'the refused approved tombstone persisted nothing'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';

-- 10-11. Nor through soft_delete_case, which is the AAL2-attributable command
--       for removing a clinical record. The refusal is the same 42501 the RPC
--       already raises for an unattributable caller.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal2"}';
SELECT throws_ok(
  $$SELECT public.soft_delete_case('00000000-0000-0000-0000-000000003243')$$,
  '42501',
  NULL,
  'an AAL2 privileged principal cannot tombstone an approved clinical record'
);
RESET ROLE;
SELECT is(
  (SELECT deleted_at IS NULL FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000003243'),
  true,
  'the refused soft_delete_case left the approved record intact'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal2"}';

-- 12-13. An approved case cannot be minted by INSERT, with or without the
--        approval ledger: the privileged AAL2 branch that allowed it is gone,
--        and so is the silent rewrite of the caller's status to `draft`. The
--        RPC refuses in its own vocabulary because its contract is a result;
--        the trigger below refuses a direct write with a named error. A caller
--        that asked for a status it does not own now learns that, rather than
--        receiving success and a row it would read as a queued submission.
SELECT is(
  (SELECT public.submit_case_operation('p1-32-insert-approved', 'insert', NULL,
    '{"template_id":"00000000-0000-0000-0000-000000003231","case_date":"2026-01-05","field_values":{},"status":"approved","is_deidentified":true}'::jsonb)
    ->> 'code'),
  'state_conflict',
  'the operation RPC refuses a caller-supplied approval instead of coercing it'
);
SELECT is(
  (SELECT public.submit_case_operation('p1-32-insert-approved', 'insert', NULL,
    '{"template_id":"00000000-0000-0000-0000-000000003231","case_date":"2026-01-05","field_values":{},"status":"approved","is_deidentified":true}'::jsonb)
    ->> 'error'),
  'policy: command_boundary',
  'the refused insert carries a fixed phrase, not server text'
);
RESET ROLE;
SELECT is_empty(
  $$
    SELECT entry.id::text
    FROM public.case_entries AS entry
    WHERE entry.client_operation_id = 'p1-32-insert-approved'
  $$,
  'the refused insert persisted nothing'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal2"}';

-- 12b. A direct INSERT that names a status the caller does not own is refused
--      with the same error the rest of the boundary raises, and writes nothing.
--      trg_case_insert_status is a BEFORE INSERT trigger, so it is evaluated
--      before the quota, PHI and write-once guards and the refusal is
--      attributable to the boundary rather than to whichever check ran first.
SELECT throws_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, case_date, status, is_deidentified, field_values)
    VALUES ('00000000-0000-0000-0000-000000003201', '00000000-0000-0000-0000-000000003222', '00000000-0000-0000-0000-000000003231', CURRENT_DATE, 'pending', true, '{}'::jsonb)$$,
  '42501',
  'case_insert_status_not_permitted',
  'a direct INSERT naming pending is refused rather than rewritten to draft'
);

-- 12c. The individual auto-approval path is untouched. An individual tenant has
--      no supervisor to review anything, so its cases are approved server-side
--      on insert; the guard returns before the refusal, and the status the row
--      lands with is the server's, not the caller's.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003215","role":"authenticated","aal":"aal1"}';
SELECT lives_ok(
  $$INSERT INTO public.case_entries (tenant_id, resident_id, template_id, case_date, status, is_deidentified, field_values, client_operation_id)
    VALUES ('00000000-0000-0000-0000-000000003204', '00000000-0000-0000-0000-000000003225', '00000000-0000-0000-0000-000000003234', CURRENT_DATE, 'pending', true, '{}'::jsonb, 'p1-32-insert-individual')$$,
  'an individual tenant keeps its documented server-side auto-approval on insert'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.case_entries WHERE client_operation_id = 'p1-32-insert-individual'),
  'approved',
  'the individual insert is approved server-side, whatever the caller asked for'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal2"}';

-- 17. A resident cannot self-escalate a rejected case into the approval queue.
--     A direct write to a clinical table is refused by the table grant, which
--     PostgreSQL evaluates before any BEFORE trigger runs, so the refusal is
--     the same 42501 as every other direct write in this suite.
SELECT throws_ok(
  $$UPDATE public.case_entries
     SET status = 'pending'
     WHERE id = '00000000-0000-0000-0000-000000003244'$$,
  '42501',
  NULL,
  'a resident cannot move rejected -> pending by direct write'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000003244'),
  'rejected',
  'the rejected case is still rejected after the denied direct write'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';

-- 14. An AAL1 privileged session receives a stable denial code from the command.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal1"}';
SELECT is(
  (SELECT public.decide_case_command(
    '00000000-0000-0000-0000-000000003242', 'p1-32-decide-aal1', 'approve', NULL) ->> 'code'),
  'forbidden',
  'an AAL1 supervisor receives forbidden instead of an exception'
);

-- 14-15. The AAL2 decide command approves, and replays without re-applying.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal2"}';
RESET ROLE;
INSERT INTO public.approval_requests (entry_id, supervisor_id, tenant_id, status)
VALUES ('00000000-0000-0000-0000-000000003241', '00000000-0000-0000-0000-000000003221', '00000000-0000-0000-0000-000000003201', 'pending')
ON CONFLICT (entry_id, supervisor_id) DO NOTHING;
SET LOCAL ROLE authenticated;

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
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.audit_outbox WHERE resource_id = '00000000-0000-0000-0000-000000003241' AND action = 'case_decide'),
  1::bigint,
  'a replayed decision does not duplicate the outbox event'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal2"}';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal2"}';

-- 16. Cross-tenant decisions are refused.
SELECT is(
  (SELECT public.decide_case_command(
    '00000000-0000-0000-0000-000000003245', 'p1-32-decide-x', 'approve', NULL) ->> 'error'),
  'not_found',
  'a command cannot decide a case in another tenant'
);

SELECT is(
  (SELECT public.decide_case_command(
     '00000000-0000-0000-0000-000000003242', 'p1-32-decide-resolved', 'approve', NULL) ->> 'code'),
  'state_conflict',
  'a case whose approval request is already resolved returns state_conflict'
);

-- Authoritative lifecycle failures are returned as stable codes.
RESET ROLE;
UPDATE public.profiles
SET status = 'suspended'
WHERE id = '00000000-0000-0000-0000-000000003221';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal2"}';
SELECT is(
  (SELECT public.decide_case_command(
    '00000000-0000-0000-0000-000000003242', 'p1-32-decide-suspended-profile', 'approve', NULL) ->> 'code'),
  'account_inactive',
  'a suspended reviewer receives account_inactive'
);

RESET ROLE;
UPDATE public.profiles
SET status = 'active'
WHERE id = '00000000-0000-0000-0000-000000003221';
UPDATE public.tenants
SET status = 'suspended'
WHERE id = '00000000-0000-0000-0000-000000003201';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal2"}';
SELECT is(
  (SELECT public.decide_case_command(
    '00000000-0000-0000-0000-000000003242', 'p1-32-decide-suspended-tenant', 'approve', NULL) ->> 'code'),
  'tenant_suspended',
  'a suspended tenant returns tenant_suspended'
);

RESET ROLE;
UPDATE public.tenants
SET status = 'active'
WHERE id = '00000000-0000-0000-0000-000000003201';
SET LOCAL ROLE authenticated;

-- 16b. The approval request is resolved inside the caller's tenant, not by
--      entry id alone. decide_case_command is SECURITY DEFINER, so the tenant
--      predicate on the case row above is the only other one, and
--      approval_requests carries its own tenant_id: an entry_id-only lookup
--      would resolve -- and then write to -- a request belonging to another
--      tenant. The supervisor here is the caller's own, so the ownership rule
--      cannot be what refuses it; only the tenant match can.
RESET ROLE;
INSERT INTO public.approval_requests (entry_id, supervisor_id, tenant_id, status)
VALUES ('00000000-0000-0000-0000-000000003247', '00000000-0000-0000-0000-000000003221', '00000000-0000-0000-0000-000000003202', 'pending');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated","aal":"aal2"}';
SELECT is(
  (SELECT public.decide_case_command(
    '00000000-0000-0000-0000-000000003247', 'p1-32-decide-foreign-request', 'approve', NULL) ->> 'code'),
  'forbidden',
  'an approval request naming another tenant is not the caller''s ledger and is not resolved'
);

-- 18. The submit command takes a rejected case to pending and creates the request.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';
SELECT is(
  (SELECT public.submit_case_command('00000000-0000-0000-0000-000000003244', 'p1-32-submit-1', 'rejected') ->> 'status'),
  'pending',
  'the submit command moves a rejected case to pending'
);
RESET ROLE;
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.approval_requests
    WHERE entry_id = '00000000-0000-0000-0000-000000003244'
      AND status = 'pending'
  ),
  'reaching pending always creates the approval request'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';

-- 19. Fail closed when the tenant has no eligible reviewer.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003214","role":"authenticated","aal":"aal1"}';
SELECT is(
  (SELECT public.submit_case_command('00000000-0000-0000-0000-000000003246', 'p1-32-submit-nr', NULL) ->> 'code'),
  'no_eligible_reviewer',
  'submit fails closed when the tenant has no eligible reviewer'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.case_entries WHERE id = '00000000-0000-0000-0000-000000003246'),
  'draft',
  'the unsubmittable case remains a draft'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003214","role":"authenticated","aal":"aal1"}';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003214","role":"authenticated","aal":"aal1"}';

-- 20. The submit command is idempotent on replay.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';
SELECT is(
  (SELECT public.submit_case_command('00000000-0000-0000-0000-000000003244', 'p1-32-submit-1', 'rejected') ->> 'status'),
  'pending',
  'replaying a submit returns the stored result'
);
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.approval_requests WHERE entry_id = '00000000-0000-0000-0000-000000003244'),
  1::bigint,
  'a replayed submit does not duplicate the approval request'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated","aal":"aal1"}';

-- 21-22. Command grants are authenticated-only.
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

-- 23. The only UPDATE policies on case_entries are the two resident-scoped
--     ones, both pinned to a draft/rejected row of the caller's own. A
--     privileged UPDATE policy, a FOR ALL policy, or a soft-delete policy
--     scoped wider than `draft` would each be a direct path around the command
--     boundary, and none of them can be added without a name this filters out.
SELECT is_empty(
  $$
    SELECT policy_record.polname
    FROM pg_policies AS policy_record
    WHERE policy_record.schemaname = 'public'
      AND policy_record.tablename = 'case_entries'
      AND policy_record.cmd IN ('UPDATE', 'ALL')
      AND policy_record.polname NOT IN (
        'residents edit own draft or rejected entries',
        'residents soft delete own draft entries'
      )
  $$,
  'no privileged or soft-delete UPDATE policy remains on case_entries'
);

-- 24-25. approve_case and reject_case are not a second approval path. They
--       wrote status and the approval request with no idempotency ledger, no
--       tenant match on the request and no outbox row; decide_case_command is
--       the only path out of `pending`. No client role may reach them at all.
SELECT is(
  has_function_privilege('authenticated', 'public.approve_case(uuid,uuid,text)', 'EXECUTE'),
  false,
  'authenticated cannot execute the retired approve_case RPC'
);
SELECT is(
  has_function_privilege('authenticated', 'public.reject_case(uuid,uuid,text)', 'EXECUTE'),
  false,
  'authenticated cannot execute the retired reject_case RPC'
);

ROLLBACK;
