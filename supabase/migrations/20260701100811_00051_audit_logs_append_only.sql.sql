-- ============================================================================
-- 00051_audit_logs_append_only.sql
--
-- Phase 0 / P0.8
--
-- Make audit_logs strictly append-only. A HIPAA-compliant audit trail
-- must be tamper-evident from the application side: an attacker with
-- a stolen service_role key, or a compromised Edge Function, must not
-- be able to UPDATE or DELETE past audit rows.
--
-- Three layers of defense:
--   1. Privilege layer: REVOKE UPDATE, DELETE on audit_logs from
--      PUBLIC, anon, authenticated, and service_role. Only roles
--      explicitly GRANTed (e.g. migration role for backfill) retain
--      the right, and nothing in the application uses those.
--   2. RLS layer: existing policies already block INSERT for
--      authenticated. There are no UPDATE or DELETE policies, so the
--      default-deny applies. Combined with #1, no application role
--      can pass a policy check.
--   3. Trigger layer: BEFORE UPDATE / BEFORE DELETE trigger raises
--      an exception unconditionally. This is the belt-and-braces
--      layer: even if a future migration accidentally re-grants a
--      privilege, the trigger blocks the mutation.
--
-- Note on postgres role: the migration/owner role is a SUPERUSER and
-- bypasses triggers. That is correct — schema-management operations
-- (e.g. dropping and re-creating for a forensic export) must still be
-- possible. No application role is a SUPERUSER.
--
-- No test file: the regression is the exception itself, statically
-- reviewable in this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Privilege layer: revoke UPDATE, DELETE
-- ---------------------------------------------------------------------------
-- Order matters. PUBLIC must come first because the default privileges
-- granted to PUBLIC are inherited by every other role.
REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM PUBLIC;
REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM authenticated;
REVOKE UPDATE, DELETE ON TABLE public.audit_logs FROM service_role;

-- ---------------------------------------------------------------------------
-- 2. Trigger layer: reject_audit_mutation()
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER is intentionally NOT used here: a SECURITY DEFINER
-- function would run as the function owner, which may have privileges
-- the calling role lacks, hiding the denial. Plain DEFINER-callable
-- function ensures the exception is raised in the caller's context.
CREATE OR REPLACE FUNCTION reject_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT    = 'Audit rows are immutable once written. Contact compliance for forensic export procedures.';
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- ---------------------------------------------------------------------------
-- 3. Attach BEFORE UPDATE / BEFORE DELETE triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_reject_audit_update ON public.audit_logs;
DROP TRIGGER IF EXISTS trg_reject_audit_delete ON public.audit_logs;

CREATE TRIGGER trg_reject_audit_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TRIGGER trg_reject_audit_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();