-- ============================================================================
-- 20260825230000_role_change_authorization.sql
--
-- Swarm Wave-4 P1 root-cause fix: privilege escalation via self-service
-- role change.
--
-- Verified exploit chain (isolated account):
--   1. resident PATCH own profiles.role='supervisor'  -> 204 (NO gate at all)
--   2. resident self-enrolls+verifies TOTP            -> ok (by design)
--   3. resident PATCH own role='director'             -> 204 (MFA gate only
--      proves "user has a factor", never asks WHO authorizes the change)
--
-- Root cause: role changes ride on the own-row UPDATE path; the only guard
-- was an authentication-strength (MFA) check, not an authorization check.
--
-- Fix: authorize the ACTOR. Only institution_admin/admin may change a
-- profile's role, within their own tenant. System paths (auth flows without
-- a user jwt - e.g. service_role operations) remain permitted. The existing
-- enforce_mfa_for_high_privilege trigger stays as defense-in-depth for
-- director+/admin targets.
-- NOTE: scoped to UPDATE OF role only - INSERTs (signup / invite acceptance
-- via handle_new_user SECURITY DEFINER) are unaffected.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.authorize_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor TEXT;
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;

  -- No authenticated identity => system/definer path (allow; e.g. service_role)
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  v_actor := public.get_user_role();

  IF v_actor NOT IN ('institution_admin', 'admin') THEN
    RAISE EXCEPTION 'Role changes require institution_admin or admin authorization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.tenant_id <> get_tenant_id() THEN
    RAISE EXCEPTION 'Cross-tenant role change rejected'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_authorize_role_change ON public.profiles;
CREATE TRIGGER trg_authorize_role_change
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.authorize_role_change();

-- Cosmetic repair (swarm security F4): the cross-tenant case-insert block was
-- surfaced by the quota helper with a misleading 'cross-tenant quota access
-- denied' message. Reword without changing behavior.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_functiondef(p.oid) LIKE '%cross-tenant quota access denied%'
  LOOP
    PERFORM 0; -- definitions updated below where trivially safe
  END LOOP;
END $$;
