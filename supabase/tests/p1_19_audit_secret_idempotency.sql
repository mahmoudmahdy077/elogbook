BEGIN;
SELECT plan(36);

INSERT INTO public.tenants (id, name, slug, tenant_type, mrn_hash_salt, allow_identifiable, data_mode_requested, status)
VALUES
  ('00000000-0000-0000-0000-000000001901', 'Audit Tenant A', 'audit-tenant-a', 'institution', encode(gen_random_bytes(32), 'hex'), true, 'identifiable', 'active'),
  ('00000000-0000-0000-0000-000000001902', 'Audit Tenant B', 'audit-tenant-b', 'institution', encode(gen_random_bytes(32), 'hex'), false, 'deidentified', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-000000001911', '00000000-0000-0000-0000-000000000000', 'audit-a@example.test'),
  ('00000000-0000-0000-0000-000000001912', '00000000-0000-0000-0000-000000000000', 'audit-a2@example.test'),
  ('00000000-0000-0000-0000-000000001913', '00000000-0000-0000-0000-000000000000', 'audit-b@example.test')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.ai_quota_reservations
WHERE tenant_id IN (
  '00000000-0000-0000-0000-000000001901',
  '00000000-0000-0000-0000-000000001902'
);
DELETE FROM public.profiles
WHERE user_id IN (
  '00000000-0000-0000-0000-000000001911',
  '00000000-0000-0000-0000-000000001912',
  '00000000-0000-0000-0000-000000001913'
);

INSERT INTO public.profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-000000001921', '00000000-0000-0000-0000-000000001901', '00000000-0000-0000-0000-000000001911', 'institution_admin', 'Audit Admin A', 'active'),
  ('00000000-0000-0000-0000-000000001922', '00000000-0000-0000-0000-000000001901', '00000000-0000-0000-0000-000000001912', 'resident', 'Audit Resident A2', 'active'),
  ('00000000-0000-0000-0000-000000001923', '00000000-0000-0000-0000-000000001902', '00000000-0000-0000-0000-000000001913', 'resident', 'Audit Resident B', 'active');

INSERT INTO public.case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES
  ('00000000-0000-0000-0000-000000001931', '00000000-0000-0000-0000-000000001901', 'surgery', 'Audit Template A', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000001932', '00000000-0000-0000-0000-000000001902', 'surgery', 'Audit Template B', '[]'::jsonb, '[]'::jsonb)
ON CONFLICT (id) DO NOTHING;

UPDATE public.installation_policy
SET phi_ready = true, allow_identifiable = true
WHERE id = 1;

INSERT INTO public.case_entries (
  id, tenant_id, resident_id, template_id, patient_mrn, patient_dob,
  field_values, status, is_deidentified
)
VALUES (
  '00000000-0000-0000-0000-000000001941',
  '00000000-0000-0000-0000-000000001901',
  '00000000-0000-0000-0000-000000001922',
  '00000000-0000-0000-0000-000000001931',
  'FIXTURE-MRN-19',
  '2099-01-01',
  '{"patient_name":"Fixture Patient","email":"fixture@example.test","mrn":"FIXTURE-MRN-19","dob":"2099-01-01","nested":{"clinical_note":"fixture-note-19"}}'::jsonb,
  'pending',
  false
)
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001911","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"institution_admin"}}';

SELECT lives_ok(
  $$UPDATE public.case_entries SET status = 'approved' WHERE id = '00000000-0000-0000-0000-000000001941'$$,
  'the audit fixture can be updated by an authorized actor'
);

RESET ROLE;

SELECT is(
  (SELECT tenant_id FROM public.audit_logs WHERE resource_id = '00000000-0000-0000-0000-000000001941' AND action IN ('UPDATE', 'update', 'case_update') ORDER BY created_at DESC LIMIT 1),
  '00000000-0000-0000-0000-000000001901'::uuid,
  'metadata audit records retain the tenant identifier'
);

SELECT is(
  (SELECT user_id FROM public.audit_logs WHERE resource_id = '00000000-0000-0000-0000-000000001941' AND action IN ('UPDATE', 'update', 'case_update') ORDER BY created_at DESC LIMIT 1),
  '00000000-0000-0000-0000-000000001911'::uuid,
  'metadata audit records retain the actor identifier'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.audit_logs
    WHERE resource_id = '00000000-0000-0000-0000-000000001941'
      AND (
        COALESCE(changes::text, '') LIKE '%FIXTURE-MRN-19%'
        OR COALESCE(changes::text, '') LIKE '%Fixture Patient%'
        OR COALESCE(changes::text, '') LIKE '%fixture@example.test%'
        OR COALESCE(changes::text, '') LIKE '%2099-01-01%'
        OR COALESCE(changes::text, '') LIKE '%fixture-note-19%'
      )
  ),
  'audit payloads exclude clinical values and nested clinical JSON'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.audit_logs
    WHERE resource_id = '00000000-0000-0000-0000-000000001941'
      AND action IN ('UPDATE', 'update', 'case_update')
      AND changes ? 'changed_fields'
      AND NOT (changes ? 'new')
      AND NOT (changes ? 'old')
      AND NOT (changes ? 'field_values')
  ),
  'audit payloads contain changed-field names without full row snapshots'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001911","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"institution_admin"}}';
SELECT set_config('app.encryption_key', '', true);

SELECT is(
  COALESCE((public.store_ai_config('openai', 'fixture-model', 'fixture-key-19') ->> 'success')::boolean, false),
  false,
  'secret storage fails closed when the encryption key is missing'
);

RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.ai_config WHERE tenant_id = '00000000-0000-0000-0000-000000001901'),
  0::bigint,
  'missing encryption keys do not persist plaintext or ciphertext secrets'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001911","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"institution_admin"}}';

SELECT throws_ok(
  $$SELECT public.set_data_retention('00000000-0000-0000-0000-000000001901', 365, FALSE)$$,
  '42501',
  NULL,
  'retention changes require AAL2 for privileged roles'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001911","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"institution_admin"}}';

SELECT throws_ok(
  $$SELECT public.set_data_retention('00000000-0000-0000-0000-000000001902', 365, FALSE)$$,
  '42501',
  NULL,
  'retention changes reject a cross-tenant target'
);

SELECT lives_ok(
  $$SELECT public.set_data_retention('00000000-0000-0000-0000-000000001901', 365, FALSE)$$,
  'an active AAL2 tenant administrator can update retention'
);

SELECT is(
  (SELECT data_retention_days FROM public.tenants WHERE id = '00000000-0000-0000-0000-000000001901'),
  365,
  'the authorized retention update is persisted'
);

SELECT throws_ok(
  $$SELECT public.store_ai_config('openai', 'fixture-model', 'fixture-key-19')$$,
  '42501',
  NULL,
  'secret storage rejects AAL1 administrators'
);

SELECT set_config('app.encryption_key', 'fixture-key-19', true);

SELECT is(
  COALESCE(
    (public.store_ai_config('openai', 'fixture-model', 'fixture-key-19') ->> 'success')::boolean,
    false
  ),
  true,
  'an active AAL2 administrator can store an encrypted AI secret'
);

SELECT is(
  COALESCE(
    (public.store_tenant_webhook(
      'https://example.test/hook',
      ARRAY['case.created']::TEXT[],
      'fixture-webhook-secret-19',
      'fixture webhook',
      TRUE,
      NULL
    ) ->> 'success')::boolean,
    false
  ),
  true,
  'an active AAL2 administrator can store an encrypted webhook secret'
);

RESET ROLE;
UPDATE public.profiles
SET status = 'suspended'
WHERE id = '00000000-0000-0000-0000-000000001921';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001911","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"institution_admin"}}';

SELECT throws_ok(
  $$SELECT public.set_data_retention('00000000-0000-0000-0000-000000001901', 365, FALSE)$$,
  '42501',
  NULL,
  'retention changes reject a suspended administrator'
);

RESET ROLE;
UPDATE public.profiles
SET status = 'active'
WHERE id = '00000000-0000-0000-0000-000000001921';
UPDATE public.tenants
SET status = 'suspended'
WHERE id = '00000000-0000-0000-0000-000000001901';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001911","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"institution_admin"}}';

SELECT throws_ok(
  $$SELECT public.set_data_retention('00000000-0000-0000-0000-000000001901', 365, FALSE)$$,
  '42501',
  NULL,
  'retention changes reject a suspended tenant'
);

RESET ROLE;
UPDATE public.tenants
SET status = 'active'
WHERE id = '00000000-0000-0000-0000-000000001901';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001911","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"institution_admin"}}';
SELECT lives_ok(
  $$SELECT public.submit_case_operation('p1-19-shared-op', 'insert', NULL, '{"template_id":"00000000-0000-0000-0000-000000001931","is_deidentified":true}'::jsonb)$$,
  'the first actor can claim an operation id'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001912","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"resident"}}';
SELECT lives_ok(
  $$SELECT public.submit_case_operation('p1-19-shared-op', 'insert', NULL, '{"template_id":"00000000-0000-0000-0000-000000001931","is_deidentified":true}'::jsonb)$$,
  'a second actor in the same tenant can use the same operation id'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001913","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001902","user_role":"resident"}}';
SELECT lives_ok(
  $$SELECT public.submit_case_operation('p1-19-shared-op', 'insert', NULL, '{"template_id":"00000000-0000-0000-0000-000000001932","is_deidentified":true}'::jsonb)$$,
  'an actor in another tenant can use the same operation id'
);

RESET ROLE;

SELECT is(
  (SELECT count(*) FROM public.case_operation_log WHERE op_id = 'p1-19-shared-op'),
  3::bigint,
  'operation ids are scoped by tenant and actor'
);

SELECT is(
  (
    SELECT count(*)
    FROM (
      SELECT tenant_id, actor_profile_id
      FROM public.case_operation_log
      WHERE op_id = 'p1-19-shared-op'
      GROUP BY tenant_id, actor_profile_id
    ) AS scopes
  ),
  3::bigint,
  'each operation scope has an independent idempotency record'
);

INSERT INTO public.resident_ai_toggle (tenant_id, resident_id, enabled, quota_limit, quota_used)
VALUES
  ('00000000-0000-0000-0000-000000001901', '00000000-0000-0000-0000-000000001922', true, 10, 2),
  ('00000000-0000-0000-0000-000000001902', '00000000-0000-0000-0000-000000001923', true, 10, 2)
ON CONFLICT (tenant_id, resident_id)
DO UPDATE SET enabled = true, quota_limit = EXCLUDED.quota_limit, quota_used = EXCLUDED.quota_used;

CREATE TEMP TABLE p1_19_quota_reservations (
  name TEXT PRIMARY KEY,
  id UUID NOT NULL
) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON TABLE p1_19_quota_reservations TO authenticated, service_role;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001912","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"resident"}}';

INSERT INTO p1_19_quota_reservations (name, id)
SELECT 'first', (public.consume_ai_quota('00000000-0000-0000-0000-000000001922', 2) ->> 'reservation_id')::UUID;

SELECT is(
  (public.consume_ai_quota('00000000-0000-0000-0000-000000001922', 2) ->> 'quota_used')::int,
  6,
  'a positive quota count increments atomically'
);

SELECT is(
  public.consume_ai_quota('00000000-0000-0000-0000-000000001923', 1) ->> 'code',
  'forbidden',
  'a resident cannot consume quota for another tenant'
);

SELECT throws_ok(
  $$SELECT public.release_ai_quota((SELECT id FROM p1_19_quota_reservations WHERE name = 'first'))$$,
  '42501',
  NULL,
  'authenticated callers cannot release quota'
);

SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';

SELECT is(
  public.release_ai_quota((SELECT id FROM p1_19_quota_reservations WHERE name = 'first')) ->> 'code',
  'ok',
  'service_role releases the exact reservation'
);
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000001901' AND resident_id = '00000000-0000-0000-0000-000000001922'),
  4,
  'service_role release updates the exact reservation balance'
);
SELECT is(
  public.release_ai_quota((SELECT id FROM p1_19_quota_reservations WHERE name = 'first')) ->> 'code',
  'already_released',
  'duplicate release is idempotent'
);
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000001901' AND resident_id = '00000000-0000-0000-0000-000000001922'),
  4,
  'duplicate release does not decrement quota again'
);

INSERT INTO public.ai_quota_reservations (id, tenant_id, resident_id, actor_profile_id, actor_user_id, quota_count, quota_used_after)
VALUES ('00000000-0000-0000-0000-000000001924', '00000000-0000-0000-0000-000000001902', '00000000-0000-0000-0000-000000001923', '00000000-0000-0000-0000-000000001923', '00000000-0000-0000-0000-000000001913', 1, 3);

RESET ROLE;
UPDATE public.tenants SET status = 'suspended' WHERE id = '00000000-0000-0000-0000-000000001902';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SELECT is(
  public.release_ai_quota('00000000-0000-0000-0000-000000001924') ->> 'code',
  'not_found',
  'service_role cannot release quota for a suspended target tenant'
);

RESET ROLE;
UPDATE public.tenants SET status = 'active' WHERE id = '00000000-0000-0000-0000-000000001902';
UPDATE public.profiles SET status = 'suspended' WHERE id = '00000000-0000-0000-0000-000000001922';
INSERT INTO public.ai_quota_reservations (id, tenant_id, resident_id, actor_profile_id, actor_user_id, quota_count, quota_used_after)
VALUES ('00000000-0000-0000-0000-000000001925', '00000000-0000-0000-0000-000000001901', '00000000-0000-0000-0000-000000001922', '00000000-0000-0000-0000-000000001922', '00000000-0000-0000-0000-000000001912', 1, 5);
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims TO '{"role":"service_role"}';
SELECT is(
  public.release_ai_quota('00000000-0000-0000-0000-000000001925') ->> 'code',
  'not_found',
  'service_role cannot release quota for a suspended target profile'
);
SELECT throws_ok(
  $$SELECT public.release_ai_quota(NULL)$$,
  '22023',
  NULL,
  'service-role quota release rejects an empty reservation'
);

RESET ROLE;
UPDATE public.profiles SET status = 'active' WHERE id = '00000000-0000-0000-0000-000000001922';
SELECT is(
  (SELECT quota_used FROM public.resident_ai_toggle WHERE tenant_id = '00000000-0000-0000-0000-000000001901' AND resident_id = '00000000-0000-0000-0000-000000001922'),
  4,
  'rejected quota operations do not mutate the balance'
);
SELECT throws_ok(
  $$SELECT public.consume_ai_quota('00000000-0000-0000-0000-000000001922', -1)$$,
  NULL,
  'negative quota consumption is rejected'
);

RESET ROLE;
UPDATE public.profiles
SET status = 'suspended'
WHERE id = '00000000-0000-0000-0000-000000001922';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001912","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"resident"}}';

SELECT is(
  public.consume_ai_quota('00000000-0000-0000-0000-000000001922', 1) ->> 'code',
  'account_suspended',
  'a suspended resident cannot consume quota'
);

RESET ROLE;
UPDATE public.profiles
SET status = 'active'
WHERE id = '00000000-0000-0000-0000-000000001922';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001911","aal":"aal1","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"institution_admin"}}';

SELECT is(
  public.grant_ai_quota('00000000-0000-0000-0000-000000001922', 20, FALSE) ->> 'code',
  'forbidden',
  'quota grants reject AAL1 administrators'
);

SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-000000001911","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-000000001901","user_role":"institution_admin"}}';

SELECT is(
  COALESCE(
    (public.grant_ai_quota('00000000-0000-0000-0000-000000001922', 20, FALSE) ->> 'success')::boolean,
    false
  ),
  true,
  'an active AAL2 administrator can grant quota in their tenant'
);

ROLLBACK;
