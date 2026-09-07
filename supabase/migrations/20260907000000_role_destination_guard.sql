-- ============================================================================
-- 20260907000000_role_destination_guard.sql (T04)
--
-- F15 follow-up: authorize_role_change() authorized the ACTOR
-- (institution_admin/admin) but not the DESTINATION role. Combined with the
-- MFA trigger (which proves enrollment, never destination authorization),
-- an MFA-enrolled institution_admin could promote any same-tenant profile
-- to `admin` via direct REST, bypassing the API-level guard in
-- assign-role/route.ts and users/[id]/route.ts (both restrict `admin`
-- assignment to `admin` actors). Reproduced live against the demo project:
-- an unenrolled institution_admin is stopped by trg_enforce_mfa (P0001
-- 'MFA enrollment required for role admin'); nothing stops an enrolled one.
--
-- Fix: only `admin` actors may assign the `admin` role. All existing
-- behavior preserved: no-op on unchanged role, system/definer path
-- (auth.uid() NULL, e.g. service_role) stays permitted, cross-tenant
-- check unchanged. New migration (history is never rewritten).
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

  -- T04: destination authorization. Institution admins manage their tenant's
  -- roles but cannot mint platform-wide `admin` authority; only an existing
  -- admin can. Mirrors the API guards so direct REST/RPC cannot bypass them.
  IF NEW.role = 'admin' AND v_actor <> 'admin' THEN
    RAISE EXCEPTION 'Only admin may assign the admin role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.tenant_id <> get_tenant_id() THEN
    RAISE EXCEPTION 'Cross-tenant role change rejected'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;
