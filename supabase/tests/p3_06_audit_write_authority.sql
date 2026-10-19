-- p3_06: trusted audit write authority (pinned-tenant RPC) + vendor policy.
--
-- Covers the insert-policy/trigger mismatch: 20260824110000_audit_logs_trigger_
-- depth_insert.sql admits audit_logs INSERTs only from inside a trigger
-- (`pg_trigger_depth() >= 1`), so every request-scoped
-- `supabase.from('audit_logs').insert(...)` (web export routes, the client PHI
-- reveal component, the mobile flush queue) is rejected with 42501 and the
-- required audit event is silently lost. SECURITY DEFINER writers such as
-- public.relabel_case_mode() and public.audit_metadata_only() are unaffected.
--
-- public.write_audit_event() is the single trusted path: authenticated, AAL
-- checked, tenant pinned to the caller's own active profile/tenant, metadata-only
-- changes, and a valid UUID resource_id (or an explicit metadata-only resource
-- type). Every failure raises a stable machine code so no caller has to echo a
-- Postgres error to a user.
BEGIN;
SELECT plan(19);

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-0000000000f1', 'P6 Tenant', 'p6-tenant', 'institution', 'salt-p6')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, email)
VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'p6-director@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000', 'p6-other@example.com')
ON CONFLICT (id) DO NOTHING;

DELETE FROM profiles WHERE user_id IN
  ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2');
INSERT INTO profiles (id, tenant_id, user_id, role, full_name, status)
VALUES
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'director', 'P6 Director', 'active'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000f2', 'director', 'P6 Other', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenants (id, name, slug, tenant_type, mrn_hash_salt)
VALUES ('00000000-0000-0000-0000-0000000000f5', 'P6 Other Tenant', 'p6-other-tenant', 'institution', 'salt-p6b')
ON CONFLICT (id) DO NOTHING;

-- 1-3. Trusted-path shape.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'write_audit_event'
            AND p.prosecdef
            AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')),
  'write_audit_event is SECURITY DEFINER with a pinned search_path'
);
SELECT is(
  has_function_privilege('anon', 'public.write_audit_event(text,text,text,jsonb,uuid)', 'execute'),
  false,
  'anon cannot execute write_audit_event'
);
SELECT is(
  has_function_privilege('authenticated', 'public.write_audit_event(text,text,text,jsonb,uuid)', 'execute'),
  true,
  'authenticated can execute write_audit_event'
);

-- 4. A direct client INSERT is still rejected: the trigger-depth policy stands.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"00000000-0000-0000-0000-0000000000f1","aal":"aal2","app_metadata":{"tenant_id":"00000000-0000-0000-0000-0000000000f1","user_role":"director"}}';
SELECT throws_ok(
  $$INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id)
    VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f1', 'forged', 'tenant',
            '00000000-0000-0000-0000-0000000000f1')$$,
  '42501',
  NULL,
  'direct authenticated audit_logs INSERT is rejected (trigger-depth policy)'
);

-- 5-6. A valid tenant-authorized, AAL2 write succeeds through the RPC.
SELECT ok(
  public.write_audit_event('audit_export', 'case_entries', '00000000-0000-0000-0000-0000000000f3',
                           '{"row_count":2}'::jsonb, '00000000-0000-0000-0000-0000000000f1') IS NOT NULL,
  'write_audit_event writes a metadata-only audit row'
);
SELECT is(
  (SELECT changes ->> 'row_count' FROM public.audit_logs
    WHERE action = 'audit_export' AND tenant_id = '00000000-0000-0000-0000-0000000000f1' LIMIT 1),
  '2',
  'the audit row carries the sanitized metadata payload'
);

-- 7-8. Cross-tenant attribution is refused.
SELECT throws_ok(
  $$SELECT public.write_audit_event('audit_export', 'tenant', NULL, '{}'::jsonb, '00000000-0000-0000-0000-0000000000f5')$$,
  'P0001',
  'audit_write_forbidden',
  'write_audit_event refuses another tenant id'
);
SELECT throws_ok(
  $$SELECT public.write_audit_event('audit_export', 'case_entries', '00000000-0000-0000-0000-0000000000f3', '{}'::jsonb, NULL)$$,
  'P0001',
  'audit_write_forbidden',
  'write_audit_event refuses a null tenant id'
);

-- 9-10. Resource identity must be a UUID or an explicit metadata-only type.
SELECT throws_ok(
  $$SELECT public.write_audit_event('audit_export', 'case_entries', 'a,b', '{}'::jsonb, '00000000-0000-0000-0000-0000000000f1')$$,
  'P0001',
  'audit_resource_id_invalid',
  'write_audit_event refuses a comma-joined resource id'
);
SELECT throws_ok(
  $$SELECT public.write_audit_event('audit_export', 'case_entries', NULL, '{}'::jsonb, '00000000-0000-0000-0000-0000000000f1')$$,
  'P0001',
  'audit_resource_id_required',
  'write_audit_event refuses a null resource id for a row-scoped resource type'
);

-- 11. Metadata-only resource types may omit the resource id (tenant row is used).
SELECT ok(
  public.write_audit_event('audit_export', 'tenant', NULL, '{"format":"csv"}'::jsonb, '00000000-0000-0000-0000-0000000000f1') IS NOT NULL,
  'write_audit_event attributes a metadata-only event to the tenant row'
);

-- 12-14. PHI-bearing change payloads are refused.
SELECT throws_ok(
  $$SELECT public.write_audit_event('phi_view', 'case_entries', '00000000-0000-0000-0000-0000000000f3',
      '{"field_values":{"dx":"appendicitis"}}'::jsonb, '00000000-0000-0000-0000-0000000000f1')$$,
  'P0001',
  'audit_changes_phi_denied',
  'raw field_values are refused'
);
SELECT throws_ok(
  $$SELECT public.write_audit_event('phi_view', 'case_entries', '00000000-0000-0000-0000-0000000000f3',
      '{"comment":"good work"}'::jsonb, '00000000-0000-0000-0000-0000000000f1')$$,
  'P0001',
  'audit_changes_phi_denied',
  'free-text approval comments are refused'
);
SELECT throws_ok(
  $$SELECT public.write_audit_event('phi_view', 'case_entries', '00000000-0000-0000-0000-0000000000f3',
      '{"detail":{"status":"approved"}}'::jsonb, '00000000-0000-0000-0000-0000000000f1')$$,
  'P0001',
  'audit_changes_nested',
  'nested change payloads are refused'
);

-- 15. Historical free-text field_values are no longer present in audit rows.
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.audit_logs
    WHERE changes ? 'field_values'
       OR changes ? 'comment'
       OR (changes ? 'new' AND jsonb_typeof(changes -> 'new') = 'object'
           AND (changes -> 'new') ? 'field_values')
       OR (changes ? 'deleted' AND jsonb_typeof(changes -> 'deleted') = 'object'
           AND (changes -> 'deleted') ? 'field_values')),
  0::bigint,
  'no audit row exposes raw historical field_values or free-text comments'
);

-- 16-17. Webhook vendor policy is default-deny.
SELECT is(
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenant_webhooks' AND column_name = 'payload_policy'),
  'text',
  'tenant_webhooks declares a payload_policy column'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.tenant_webhooks'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%metadata_only%'),
  'tenant_webhooks constrains payload_policy to the approved metadata-only policy'
);

-- 18-19. Vendor policy and audit authority stay out of anon reach.
SELECT is(
  (SELECT array_to_string(proacl, ',') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'write_audit_event' LIMIT 1),
  'postgres=X/postgres=EXECUTE',
  'write_audit_event grants execute only to authenticated'
);
SELECT is(
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tenant_webhooks' AND policyname = 'tenant_webhooks_admin'),
  1::bigint,
  'the tenant_webhooks admin policy is preserved (no policy convergence regression)'
);

ROLLBACK;
