-- p3_03: submit_case_operation — tenant isolation, ownership, replay (N1/N3), and
-- the AAL2 boundary plus the command boundary around it.
--
-- 20260923000011 put an AAL2 wrapper at the public name and moved the raw body
-- to __a2_submit_case_operation. 20260927000001 converged the error contract by
-- redefining the public name with the raw body, which folded the wrapper back
-- into it: the RPC is SECURITY DEFINER, so the only AAL2 check on the mobile
-- write path went with it. An AAL1 supervisor session could then edit and
-- tombstone another resident's clinical record.
--
-- What this suite proves, in the order the boundary is crossed:
--
--   1-4    a resident's own insert, its client op id, and replay
--   5-6    another tenant cannot reach the row at all
--   7      another resident in the same tenant cannot either
--   8      an AAL1 supervisor cannot edit a tenant case
--   9      a session with no `aal` claim cannot either
--   10     an AAL2 supervisor can: the change is the claim, not the role
--   11     an approved record is locked against the resident who owns it
--   12     a submitted record is locked too, and says so with a stable code
--   13-16  the operation RPC is not a path into the approval queue, for a
--          resident or for a privileged caller
--   17-19  a privileged tombstone is soft_delete_case's, not this RPC's
--   20-22  the owner's own tombstone, and its idempotent replay
--   23-24  identity columns are immutable
--   25-26  failures carry a code and never a database message
--   27-28  the closed vocabulary, read as superuser because it is not
--          client-callable
BEGIN;
SELECT plan(28);

-- Fixtures. Statuses are stated rather than inherited: the wrapper resolves the
-- principal through get_authoritative_principal_with_aal, so a default that
-- happened to be 'suspended' would turn a behavioural assertion into an
-- unrelated one.
INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt, status)
VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'P3 Tenant A', 'p3-tenant-a', 'institution', 'salt-p3-a', 'active'),
  ('00000000-0000-0000-0000-0000000000c2', 'P3 Tenant B', 'p3-tenant-b', 'institution', 'salt-p3-b', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'p3-resident-a@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'p3-resident-a2@example.com'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'p3-supervisor-a@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'p3-resident-b@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2',
   '00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000b1');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'resident', 'P3 RA', 'active'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', 'resident', 'P3 RA2', 'active'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a3', 'supervisor', 'P3 SA', 'active'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', 'resident', 'P3 RB', 'active');

INSERT INTO case_templates (id, tenant_id, specialty, name, fields)
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'surgery', 'P3 T', '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Rows in the three lifecycle states the operation RPC has to tell apart, filed
-- as the table owner so the suite is not arranging a case through the very RPC
-- whose behaviour it is asserting. f4 is a second draft: the immutable-column
-- and error-contract assertions need a row the owner may still edit, and f2 is
-- tombstoned by the time they run.
INSERT INTO case_entries (id, tenant_id, resident_id, template_id, case_date, status, is_deidentified, field_values)
VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', '2026-09-01', 'approved', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', '2026-09-01', 'draft', true, '{"note":"original"}'::jsonb),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', '2026-09-01', 'pending', true, '{}'::jsonb),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', '2026-09-01', 'draft', true, '{"note":"editable"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';

-- 1-2. Insert happy path carries the client op ID into the row.
SELECT ok(
  (SELECT (public.submit_case_operation('p3-op-1', 'insert', NULL,
    '{"template_id":"00000000-0000-0000-0000-0000000000e1","case_date":"2026-09-01","field_values":{},"status":"draft","is_deidentified":true}'::jsonb)
    ->> 'success')::boolean),
  'resident insert succeeds with op identity'
);
SELECT is(
  (SELECT client_operation_id FROM case_entries WHERE client_operation_id = 'p3-op-1'),
  'p3-op-1',
  'client_operation_id persisted on the row'
);

-- 3-4. Duplicate delivery returns the stored result without a second row.
SELECT is(
  (SELECT public.submit_case_operation('p3-op-1', 'insert', NULL,
    '{"template_id":"00000000-0000-0000-0000-0000000000e1","is_deidentified":true}'::jsonb) ->> 'id'),
  (SELECT id::text FROM case_entries WHERE client_operation_id = 'p3-op-1'),
  'replay returns the original row id'
);
SELECT is(
  (SELECT count(*) FROM case_entries WHERE client_operation_id = 'p3-op-1'),
  1::bigint,
  'no duplicate row from replay'
);

-- 5-6. Cross-tenant by a known row id does not leak. The wrapper refuses before
--      the body runs, so the refusal is an exception rather than a 'not_found'
--      result: either way nothing about tenant A is disclosed.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","aal":"aal1"}';
SELECT throws_ok(
  $$SELECT public.submit_case_operation('p3-op-x', 'update',
    '00000000-0000-0000-0000-0000000000f2', '{"field_values":{}}'::jsonb)$$,
  '42501',
  NULL,
  'a caller in another tenant cannot reach the row at all'
);
RESET ROLE;
SELECT is(
  (SELECT field_values ->> 'note' FROM public.case_entries WHERE id = '00000000-0000-0000-0000-0000000000f2'),
  'original',
  'the cross-tenant attempt changed nothing'
);
SET LOCAL ROLE authenticated;

-- 7. Same-tenant non-owner resident is refused, and the refusal is the wrapper's
--    ownership check rather than a body-level policy string.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated","aal":"aal1"}';
SELECT throws_ok(
  $$SELECT public.submit_case_operation('p3-op-f', 'update',
    '00000000-0000-0000-0000-0000000000f2', '{"field_values":{}}'::jsonb)$$,
  '42501',
  NULL,
  'a non-owner resident cannot update another resident row'
);

-- 8. An AAL1 privileged session is refused. The role label is not the attribute;
--    the claim is, and this is the call the dropped wrapper used to allow.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal1"}';
SELECT throws_ok(
  $$SELECT public.submit_case_operation('p3-op-aal1', 'update',
    '00000000-0000-0000-0000-0000000000f2', '{"field_values":{"note":"edited"}}'::jsonb)$$,
  '42501',
  NULL,
  'an AAL1 supervisor cannot edit a tenant case through the operation RPC'
);

-- 9. A privileged session whose claim never carried an assurance level is
--    refused on the same ground: no claim is not a fresh claim.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
SELECT throws_ok(
  $$SELECT public.submit_case_operation('p3-op-noaal', 'update',
    '00000000-0000-0000-0000-0000000000f2', '{"field_values":{"note":"edited"}}'::jsonb)$$,
  '42501',
  NULL,
  'a privileged session with no aal claim is refused the operation RPC'
);

-- 10. The same principal at AAL2 is allowed, and may edit another resident's
--     case. The change is the claim, not the role.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal2"}';
SELECT ok(
  (SELECT (public.submit_case_operation('p3-op-aal2', 'update',
    '00000000-0000-0000-0000-0000000000f2', '{"field_values":{"note":"reviewed"}}'::jsonb)
    ->> 'success')::boolean),
  'an AAL2 supervisor can edit a tenant case through the operation RPC'
);

-- 11-12. A record that is no longer the resident's to edit says so with a stable
--        code rather than an opaque refusal. The approved case and the submitted
--        case are different refusals: approved is immutable, submitted is with
--        its reviewers.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
SELECT is(
  (SELECT public.submit_case_operation('p3-op-ap-lock', 'update',
    '00000000-0000-0000-0000-0000000000f1', '{"status":"draft"}'::jsonb) ->> 'error'),
  'policy: approved_locked',
  'owner cannot silently rewrite an approved record'
);
SELECT is(
  (SELECT public.submit_case_operation('p3-op-pd-lock', 'update',
    '00000000-0000-0000-0000-0000000000f3', '{"field_values":{"note":"edited"}}'::jsonb) ->> 'error'),
  'policy: submitted_locked',
  'owner cannot edit a case that is with its reviewers'
);

-- 13-16. The command boundary. submit_case_command is the only path into
--        `pending` because it creates the approval requests in the same
--        transaction; this RPC writes no approval request, so a status change
--        that would cross into the queue is refused for every caller.
SELECT is(
  (SELECT public.submit_case_operation('p3-op-sub1', 'update',
    '00000000-0000-0000-0000-0000000000f2', '{"status":"pending"}'::jsonb) ->> 'code'),
  'state_conflict',
  'the operation RPC cannot move a draft case into pending'
);
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal2"}';
SELECT is(
  (SELECT public.submit_case_operation('p3-op-sub2', 'update',
    '00000000-0000-0000-0000-0000000000f2', '{"status":"pending"}'::jsonb) ->> 'code'),
  'state_conflict',
  'a privileged caller cannot move a draft case into pending either'
);
-- And out of `pending` is decide_case_command's, for the same reason.
SELECT is(
  (SELECT public.submit_case_operation('p3-op-sub3', 'update',
    '00000000-0000-0000-0000-0000000000f3', '{"status":"approved"}'::jsonb) ->> 'code'),
  'state_conflict',
  'the operation RPC cannot approve a case out of the queue'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.case_entries WHERE id = '00000000-0000-0000-0000-0000000000f2'),
  'draft',
  'the draft case is still a draft after every refused transition'
);
SET LOCAL ROLE authenticated;

-- 17-19. A privileged tombstone belongs to soft_delete_case, the AAL2-gated
--        command for removing a clinical record. This RPC is not a second door
--        to it, so the refusal names it.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated","aal":"aal2"}';
SELECT is(
  (SELECT public.submit_case_operation('p3-op-pdel', 'delete',
    '00000000-0000-0000-0000-0000000000f2', '{}'::jsonb) ->> 'error'),
  'policy: use_soft_delete_case',
  'a privileged tombstone is refused outside soft_delete_case'
);
RESET ROLE;
SELECT is(
  (SELECT deleted_at IS NULL FROM public.case_entries WHERE id = '00000000-0000-0000-0000-0000000000f2'),
  true,
  'the refused privileged tombstone left the case intact'
);
SET LOCAL ROLE authenticated;

-- 20-22. The owner's own tombstone is the resident path and stays, and its replay
--        is idempotent.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal1"}';
SELECT ok(
  (SELECT (public.submit_case_operation('p3-op-del', 'delete',
    '00000000-0000-0000-0000-0000000000f2', '{}'::jsonb) ->> 'success')::boolean),
  'owner delete tombstones the row'
);
RESET ROLE;
SELECT ok(
  (SELECT deleted_at IS NOT NULL FROM public.case_entries WHERE id = '00000000-0000-0000-0000-0000000000f2'),
  'deleted_at tombstone set (no hard delete)'
);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT public.submit_case_operation('p3-op-del', 'delete',
    '00000000-0000-0000-0000-0000000000f2', '{}'::jsonb) ->> 'already_deleted'),
  'true',
  'delete replay is idempotent'
);

-- 23-24. Immutable identity columns rejected.
SELECT like(
  (SELECT public.submit_case_operation('p3-op-im', 'update',
    '00000000-0000-0000-0000-0000000000f4', '{"client_operation_id":"forged"}'::jsonb) ->> 'error'),
  'validation: immutable_column%',
  'client_operation_id cannot be rewritten through updates'
);

-- 25-26. Error contract: every failure carries a code from a closed vocabulary and
--        a fixed phrase. Raw database text must never reach the client.
SELECT is(
  (SELECT public.submit_case_operation('p3-op-ec', 'update',
    '00000000-0000-0000-0000-0000000000f4', '{"client_operation_id":"forged-2"}'::jsonb) ->> 'code'),
  'immutable_column',
  'validation failures report a stable code'
);
SELECT unlike(
  (SELECT public.submit_case_operation('p3-op-ec2', 'update',
    '00000000-0000-0000-0000-0000000000f4', '{"client_operation_id":"forged-3"}'::jsonb) ->> 'error'),
  '^db: %',
  'no result carries a raw database message'
);

-- 27-30. The vocabulary helpers are not client-callable, so exercise them as
--        superuser. An unmapped state has to yield a fixed phrase too, otherwise
--        the fallback leaks whatever SQLSTATE text reached it.
RESET ROLE;
SELECT is(
  public.case_operation_error_text('internal_error'),
  'operation_failed',
  'the code mapper has a fixed phrase for an unknown failure'
);
SELECT is(
  public.case_operation_error_text('code_from_the_future'),
  'operation_failed',
  'an unrecognised code still yields a fixed phrase, never server text'
);
SELECT ok(
  public.case_operation_error_code('42501', 'row-level security policy violated for table secret_table') = 'forbidden',
  'SQLSTATE is mapped without echoing the message'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.case_operation_error_code(text, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.case_operation_error_text(text)', 'EXECUTE'),
  'the error vocabulary is not a client-callable API'
);

ROLLBACK;
