-- Cross-tenant isolation tests (P1.1)
-- Run against a reset database: supabase db test

-- Each test expects to fail (no rows returned) when accessing another tenant's data

-- Helper: resolve different tenant IDs for testing
-- In a real test, these would be seeded tenant IDs

-- 1. Cannot read another tenant's case_entries
SELECT 'FAIL: cross-tenant case_entries read' AS test_name
WHERE EXISTS (
  SELECT 1 FROM case_entries ce
  WHERE ce.tenant_id != public.get_tenant_id()
  LIMIT 1
);

-- 2. Cannot read another tenant's profiles
SELECT 'FAIL: cross-tenant profiles read' AS test_name
WHERE EXISTS (
  SELECT 1 FROM profiles p
  WHERE p.tenant_id != public.get_tenant_id()
  LIMIT 1
);

-- 3. Cannot read another tenant's audit_logs
SELECT 'FAIL: cross-tenant audit_logs read' AS test_name
WHERE EXISTS (
  SELECT 1 FROM audit_logs a
  WHERE a.tenant_id != public.get_tenant_id()
  LIMIT 1
);

-- 4. Cannot read another tenant's attachments
SELECT 'FAIL: cross-tenant attachments read' AS test_name
WHERE EXISTS (
  SELECT 1 FROM case_attachments ca
  WHERE ca.entry_id IN (SELECT id FROM case_entries WHERE tenant_id != public.get_tenant_id())
  LIMIT 1
);

-- 5. RLS is enabled on all core tables
SELECT 'FAIL: RLS not enabled on core table' AS test_name, tablename
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'tenants', 'profiles', 'case_entries', 'case_attachments',
    'approval_requests', 'audit_logs', 'program_goals',
    'subscriptions', 'payments'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.relname = t.tablename AND c.relrowsecurity = true
  );

-- 6. FORCE RLS is applied on tenant-scoped tables
SELECT 'FAIL: FORCE RLS not applied' AS test_name, tablename
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'tenants', 'profiles', 'case_entries', 'approval_requests',
    'audit_logs', 'subscriptions', 'payments',
    'institutions', 'ai_config', 'payment_gateway_config'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.relname = t.tablename AND c.relforcerowsecurity = true
  );
