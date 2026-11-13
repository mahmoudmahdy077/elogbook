-- ============================================================================
-- 20261028000000_restore_public_table_grants.sql
--
-- Restore the base table privileges that the deployed project has but a
-- fresh migration replay does not.
--
-- Root cause of the db-tests failures: the grants in the linked project come
-- from its initial default ACLs (created when the project was provisioned),
-- and those defaults are not reproduced by `supabase start` on a clean
-- checkout. The 2026-08-25 diagnostics shim
-- (20260825179999_debug_table_grants.sql) had to grant explicitly for the
-- same reason. Without them, every test that impersonates `authenticated`
-- dies with `42501 permission denied for table ...`, which is why the SQL
-- suites never produced a result (they aborted at `supabase start` first).
--
-- The matrix below is the deployed one, verified against
-- information_schema.role_table_grants on the linked project: full
-- privileges for anon / authenticated / service_role, then the deliberate
-- revokes that the hardening migrations (00051, 00054, 00055, 20260907xxxxx)
-- already apply. RLS — not the grant layer — is what restricts rows.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Keep future objects consistent with the ones above.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ── Re-apply the deliberate revokes undone by the grants above ──────────────
-- Server-only configuration blobs (never readable by client roles).
REVOKE SELECT ON public.ai_config FROM anon, authenticated;
REVOKE SELECT ON public.payment_gateway_config FROM anon, authenticated;

-- Infrastructure table: only triggers / service_role touch it.
REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- Append-only audit history (00051_audit_logs_append_only.sql).
REVOKE DELETE, UPDATE ON public.audit_logs FROM anon, authenticated, service_role;

-- AI quota counters are written only through the SECURITY DEFINER RPCs
-- (00054_ai_quota_atomic_increment.sql).
REVOKE UPDATE ON public.resident_ai_toggle FROM authenticated;

-- Reflections are tenant-user content; anon never reads them.
REVOKE ALL ON public.reflections FROM anon;
