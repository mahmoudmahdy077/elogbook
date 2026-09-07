-- p2_13: dual data-mode truth table (T19, section 4.2).
-- Identifiable writes require installation qualification AND both ceilings
-- AND the tenant request; anything else denies. History is preserved on
-- switch-off without relabeling; identifier edits stay gated.
BEGIN;
SELECT plan(10);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-000000000041', 'Mode Tenant', 'mode-tenant', 'institution', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000000', 'mode-resident@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id = '00000000-0000-0000-0000-000000000041';
INSERT INTO profiles (id, tenant_id, user_id, role, full_name)
VALUES ('00000000-0000-0000-0000-000000000141', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041', 'resident', 'Mode Resident');

INSERT INTO case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES ('00000000-0000-4000-8000-000000000041', '00000000-0000-0000-0000-000000000041', 'surgery', 'Mode Template', '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 1-2. Default policy denies identifiable, allows de-identified.
SELECT throws_ok(
  $$INSERT INTO case_entries (tenant_id, resident_id, template_id, case_date, field_values, status, is_deidentified, patient_mrn, patient_hash)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000141', '00000000-0000-4000-8000-000000000041', CURRENT_DATE, '{"procedure_name":"x"}', 'draft', false, 'MRN-1', 'h')$$,
  'insufficient_privilege',
  'default policy denies identifiable inserts'
);
SELECT lives_ok(
  $$INSERT INTO case_entries (tenant_id, resident_id, template_id, case_date, field_values, status, is_deidentified, patient_hash)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000141', '00000000-0000-4000-8000-000000000041', CURRENT_DATE, '{"procedure_name":"x"}', 'draft', true, 'h')$$,
  'default policy allows de-identified inserts'
);

-- 3. Fully enabled: identifiable allowed.
UPDATE installation_policy SET phi_ready = true, allow_identifiable = true WHERE id = 1;
UPDATE tenants SET allow_identifiable = true, data_mode_requested = 'identifiable' WHERE id = '00000000-0000-0000-0000-000000000041';
SELECT lives_ok(
  $$INSERT INTO case_entries (id, tenant_id, resident_id, template_id, case_date, field_values, status, is_deidentified, patient_mrn, patient_hash)
    VALUES ('00000000-0000-0000-0000-000000000142', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000141', '00000000-0000-4000-8000-000000000041', CURRENT_DATE, '{"procedure_name":"x"}', 'draft', false, 'MRN-2', 'h')$$,
  'fully enabled policy allows identifiable inserts'
);

-- 4. Tenant requests de-identified while ceilings allow: denied.
UPDATE tenants SET data_mode_requested = 'deidentified' WHERE id = '00000000-0000-0000-0000-000000000041';
SELECT throws_ok(
  $$INSERT INTO case_entries (tenant_id, resident_id, template_id, case_date, field_values, status, is_deidentified, patient_mrn, patient_hash)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000141', '00000000-0000-4000-8000-000000000041', CURRENT_DATE, '{"procedure_name":"x"}', 'draft', false, 'MRN-3', 'h')$$,
  'insufficient_privilege',
  'tenant de-identified request denies identifiable inserts'
);

-- 5. Tenant ceiling off: denied.
UPDATE tenants SET data_mode_requested = 'identifiable', allow_identifiable = false WHERE id = '00000000-0000-0000-0000-000000000041';
SELECT throws_ok(
  $$INSERT INTO case_entries (tenant_id, resident_id, template_id, case_date, field_values, status, is_deidentified, patient_mrn, patient_hash)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000141', '00000000-0000-4000-8000-000000000041', CURRENT_DATE, '{"procedure_name":"x"}', 'draft', false, 'MRN-4', 'h')$$,
  'insufficient_privilege',
  'tenant ceiling off denies identifiable inserts'
);

-- 6. Installation not qualified: denied.
UPDATE installation_policy SET phi_ready = false WHERE id = 1;
UPDATE tenants SET allow_identifiable = true WHERE id = '00000000-0000-0000-0000-000000000041';
SELECT throws_ok(
  $$INSERT INTO case_entries (tenant_id, resident_id, template_id, case_date, field_values, status, is_deidentified, patient_mrn, patient_hash)
    VALUES ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000141', '00000000-0000-4000-8000-000000000041', CURRENT_DATE, '{"procedure_name":"x"}', 'draft', false, 'MRN-5', 'h')$$,
  'insufficient_privilege',
  'unqualified installation denies identifiable inserts'
);

-- 7-9. Switch-off preserves history: non-identifier edits pass, identifier
-- edits and new identifiable inserts fail, nothing relabeled.
UPDATE tenants SET data_mode_requested = 'deidentified' WHERE id = '00000000-0000-0000-0000-000000000041';
SELECT lives_ok(
  $$UPDATE case_entries SET status = 'pending' WHERE id = '00000000-0000-0000-0000-000000000142'$$,
  'historical identifiable rows accept non-identifier edits after switch-off'
);
SELECT throws_ok(
  $$UPDATE case_entries SET patient_mrn = 'MRN-CHANGED' WHERE id = '00000000-0000-0000-0000-000000000142'$$,
  'insufficient_privilege',
  'identifier edits stay gated after switch-off'
);
SELECT is(
  (SELECT is_deidentified FROM case_entries WHERE id = '00000000-0000-0000-0000-000000000142'),
  false,
  'history is preserved without relabeling'
);

-- 10. Unknown tenant denies.
SELECT throws_ok(
  $$INSERT INTO case_entries (tenant_id, resident_id, template_id, case_date, field_values, status, is_deidentified, patient_mrn, patient_hash)
    VALUES ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000141', '00000000-0000-4000-8000-000000000041', CURRENT_DATE, '{"procedure_name":"x"}', 'draft', false, 'MRN-6', 'h')$$,
  'insufficient_privilege',
  'unknown tenant denies identifiable inserts'
);

ROLLBACK;
