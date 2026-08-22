BEGIN;
SELECT plan(2);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt, data_retention_days)
VALUES ('00000000-0000-0000-0000-000000000051', 'Retention Tenant', 'retention-tenant', 'institution', encode(gen_random_bytes(32), 'hex'), 2555)
ON CONFLICT (id) DO UPDATE SET data_retention_days = 2555;

INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000000', 'retention@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000000051';
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES ('00000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000051', 'resident', 'Retention Resident');

INSERT INTO case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES ('00000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000051', 'surgery', 'Retention Template', '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Insert one old case (10 years ago) and one fresh case.
INSERT INTO public.case_entries (id, tenant_id, resident_id, template_id, status, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000098', 'approved', now() - interval '10 years', now()),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-000000000098', 'draft', now(), now());

-- Run the purge as the test (postgres-equivalent) session. The function is
-- SECURITY DEFINER owned by postgres, so it executes successfully here.
SELECT lives_ok(
  $$SELECT public.enforce_data_retention()$$,
  'enforce_data_retention v4 executes without error'
);

SELECT is(
  (SELECT count(*) FROM public.case_entries WHERE tenant_id = '00000000-0000-0000-0000-000000000051' AND deleted_at IS NULL),
  1::bigint,
  'only the 10-year-old case was soft-deleted; the fresh case remains'
);
ROLLBACK;
