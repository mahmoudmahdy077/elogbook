-- p3_04: data-mode immutability + audited relabel path (N1).
BEGIN;
SELECT plan(6);

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000000', 'p4-resident@example.com'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000000', 'p4-supervisor@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-0000000000e0', 'P4 Tenant', 'p4-tenant', 'institution', 'salt-p4')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN
  ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e2');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000e1', 'resident', 'P4 R', 'active'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000e2', 'supervisor', 'P4 S', 'active');

INSERT INTO case_templates (id, tenant_id, specialty, name, fields)
VALUES ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e0', 'surgery', 'P4 T', '[]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO case_entries (id, tenant_id, resident_id, template_id, case_date, field_values, status, is_deidentified)
VALUES ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000e3',
        '00000000-0000-0000-0000-0000000000e5', '2026-09-01', '{}', 'draft', true)
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000e1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-0000000000e0"}}';

-- 1. Direct relabel is rejected with a clear policy error (trigger fires
-- regardless of role; run as owner to isolate the trigger from RLS).
RESET ROLE;
SELECT throws_ok(
  $$UPDATE case_entries SET is_deidentified = false WHERE id = '00000000-0000-0000-0000-0000000000e6'$$,
  'P0001',
  'direct mode relabel rejected (mode immutable)'
);
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000e1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-0000000000e0"}}';

-- 2. Residents cannot use the relabel RPC.
SELECT is(
  (SELECT public.relabel_case_mode('00000000-0000-0000-0000-0000000000e6', false, 'need identifiers for follow-up') ->> 'error'),
  'policy: forbidden',
  'relabel requires supervisor+'
);

-- 3. Relabel to identifiable without tenant ceiling is denied.
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000e2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-0000000000e0"}}';
SELECT is(
  (SELECT public.relabel_case_mode('00000000-0000-0000-0000-0000000000e6', false, 'need identifiers for follow-up') ->> 'error'),
  'policy: identifiable_not_permitted',
  'identifiable relabel needs the tenant ceiling'
);

-- 4. Relabel to de-identified is a no-op success when already de-identified.
SELECT ok(
  (SELECT (public.relabel_case_mode('00000000-0000-0000-0000-0000000000e6', true, 'confirming de-identified status') ->> 'success')::boolean),
  'idempotent no-op relabel succeeds'
);

-- 5. Relabel writes an irreversible-history audit row (checked via RPC path with ceiling on).
-- Enable ceilings then flip deidentified->identifiable through the audited path.
RESET ROLE;
UPDATE tenants SET allow_identifiable = true, data_mode_requested = 'identifiable'
 WHERE id = '00000000-0000-0000-0000-0000000000e0';
UPDATE installation_policy SET phi_ready = true, allow_identifiable = true WHERE id = 1;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000e2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-0000000000e0"}}';
SELECT ok(
  (SELECT (public.relabel_case_mode('00000000-0000-0000-0000-0000000000e6', false, 'consented identifiable capture') ->> 'success')::boolean),
  'audited relabel to identifiable succeeds under ceilings'
);
RESET ROLE;
SELECT ok(
  EXISTS (SELECT 1 FROM audit_logs WHERE resource_id = '00000000-0000-0000-0000-0000000000e6' AND action = 'case_relabel'),
  'relabel wrote an audit row'
);

ROLLBACK;
