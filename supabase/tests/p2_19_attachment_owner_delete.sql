-- p2_19 — attachment delete: owner or supervisor+, never another resident.
BEGIN;
SELECT plan(3);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000191', 'Attach Tenant', 'attach-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-000000000000', 'att-owner@example.com'),
  ('00000000-0000-0000-0000-000000000192', '00000000-0000-0000-0000-000000000000', 'att-other@example.com'),
  ('00000000-0000-0000-0000-000000000193', '00000000-0000-0000-0000-000000000000', 'att-sup@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000193', 'pgtap', 'totp', 'verified', NOW(), NOW(), 'JBSWY3DPEHPK3PXP')
ON CONFLICT DO NOTHING;

DELETE FROM profiles WHERE user_id IN (
  '00000000-0000-0000-0000-000000000191',
  '00000000-0000-0000-0000-000000000192',
  '00000000-0000-0000-0000-000000000193'
);
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES
  ('00000000-0000-0000-0000-000000000291', '00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-000000000191', 'resident', 'Att Owner'),
  ('00000000-0000-0000-0000-000000000292', '00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-000000000192', 'resident', 'Att Other'),
  ('00000000-0000-0000-0000-000000000293', '00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-000000000193', 'supervisor', 'Att Sup');

INSERT INTO case_templates (id, tenant_id, specialty, name, fields)
VALUES ('00000000-0000-0000-0000-000000000295', '00000000-0000-0000-0000-000000000191', 'surgery', 'Att T', '[]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO case_entries (id, tenant_id, resident_id, template_id, case_date, field_values, status, is_deidentified)
VALUES
  ('00000000-0000-0000-0000-000000000296', '00000000-0000-0000-0000-000000000191',
   '00000000-0000-0000-0000-000000000291', '00000000-0000-0000-0000-000000000295',
   '2026-11-20', '{}'::jsonb, 'draft', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO case_attachments (id, entry_id, tenant_id, file_path, file_type, file_name, file_size, uploaded_by)
VALUES
  ('00000000-0000-0000-0000-000000000297', '00000000-0000-0000-0000-000000000296', '00000000-0000-0000-0000-000000000191', 'attach-tenant/case/a.jpg', 'image/jpeg', 'a.jpg', 100, '00000000-0000-0000-0000-000000000291')
ON CONFLICT (id) DO NOTHING;

-- Owner resident may delete their own row.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000191","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000191","user_role":"resident"}}';
SELECT lives_ok(
  $$DELETE FROM public.case_attachments WHERE id = '00000000-0000-0000-0000-000000000297'$$,
  'uploader can delete their own attachment'
);

-- Same-tenant resident who did not upload it cannot delete the next row.
RESET ROLE;
INSERT INTO case_attachments (id, entry_id, tenant_id, file_path, file_type, file_name, file_size, uploaded_by)
VALUES
  ('00000000-0000-0000-0000-000000000298', '00000000-0000-0000-0000-000000000296', '00000000-0000-0000-0000-000000000191', 'attach-tenant/case/b.jpg', 'image/jpeg', 'b.jpg', 100, '00000000-0000-0000-0000-000000000291')
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000192","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000191","user_role":"resident"}}';
SELECT is(
  (SELECT count(*) FROM public.case_attachments WHERE id = '00000000-0000-0000-0000-000000000298'),
  0::bigint,
  'another resident cannot even read the attachment row'
);

-- Supervisor may delete it.
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000000193","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000000191","user_role":"supervisor"}}';
SELECT lives_ok(
  $$DELETE FROM public.case_attachments WHERE id = '00000000-0000-0000-0000-000000000298'$$,
  'supervisor can delete a tenant attachment'
);

ROLLBACK;
