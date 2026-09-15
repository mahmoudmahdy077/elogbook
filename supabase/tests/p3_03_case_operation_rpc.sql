-- p3_03: submit_case_operation — tenant isolation, ownership, replay (N1/N3).
BEGIN;
SELECT plan(12);

-- Fixtures.
INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'p3-resident-a@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'p3-resident-a2@example.com'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'p3-supervisor-a@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'p3-resident-b@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'P3 Tenant A', 'p3-tenant-a', 'institution', 'salt-p3-a'),
  ('00000000-0000-0000-0000-0000000000c2', 'P3 Tenant B', 'p3-tenant-b', 'institution', 'salt-p3-b')
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
VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'surgery', 'P3 T', '[]')
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a1"}';

-- 1. Insert happy path carries the client op ID into the row.
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

-- 2. Duplicate delivery returns the stored result without a second row.
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

-- 3. Cross-tenant update by known row ID does not leak (not_found, not data).
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
SELECT is(
  (SELECT public.submit_case_operation('p3-op-x', 'update',
    (SELECT id FROM case_entries WHERE client_operation_id = 'p3-op-1'),
    '{"status":"approved"}'::jsonb) ->> 'error'),
  'not_found',
  'tenant B caller cannot touch tenant A rows'
);

-- 4. Same-tenant non-owner resident is forbidden.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
SELECT is(
  (SELECT public.submit_case_operation('p3-op-f', 'update',
    (SELECT id FROM case_entries WHERE client_operation_id = 'p3-op-1'),
    '{"status":"pending"}'::jsonb) ->> 'error'),
  'policy: forbidden',
  'non-owner resident cannot update another resident row'
);

-- 5. Approved rows lock against resident edits, open to supervisors.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a3"}';
SELECT ok(
  (SELECT (public.submit_case_operation('p3-op-ap', 'update',
    (SELECT id FROM case_entries WHERE client_operation_id = 'p3-op-1'),
    '{"status":"approved"}'::jsonb) ->> 'success')::boolean),
  'supervisor approval succeeds'
);
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
SELECT is(
  (SELECT public.submit_case_operation('p3-op-al', 'update',
    (SELECT id FROM case_entries WHERE client_operation_id = 'p3-op-1'),
    '{"status":"draft"}'::jsonb) ->> 'error'),
  'policy: approved_locked',
  'owner cannot silently rewrite an approved record'
);

-- 6. Immutable identity columns rejected.
SELECT like(
  (SELECT public.submit_case_operation('p3-op-im', 'update',
    (SELECT id FROM case_entries WHERE client_operation_id = 'p3-op-1'),
    '{"client_operation_id":"forged"}'::jsonb) ->> 'error'),
  'validation: immutable_column%',
  'client_operation_id cannot be rewritten through updates'
);

-- 7. Owner delete tombstones; replay reports already_deleted.
SELECT ok(
  (SELECT (public.submit_case_operation('p3-op-del', 'delete',
    (SELECT id FROM case_entries WHERE client_operation_id = 'p3-op-1'), '{}'::jsonb) ->> 'success')::boolean),
  'owner delete tombstones the row'
);
SELECT ok(
  (SELECT deleted_at IS NOT NULL FROM case_entries WHERE client_operation_id = 'p3-op-1'),
  'deleted_at tombstone set (no hard delete)'
);
SELECT is(
  (SELECT public.submit_case_operation('p3-op-del', 'delete',
    (SELECT id FROM case_entries WHERE client_operation_id = 'p3-op-1'), '{}'::jsonb) ->> 'already_deleted'),
  'true',
  'delete replay is idempotent'
);

ROLLBACK;
