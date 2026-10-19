-- ============================================================================
-- 20260930000003_mfa_system_path.sql
--
-- public.enforce_mfa_for_high_privilege fired on every INSERT or role UPDATE
-- that landed on director, institution_admin or admin, with no system-path
-- escape. That made the guard reject paths that carry no user identity at all:
--
--   * a service_role provisioning call, which is how an operator creates the
--     first institution_admin for a tenant;
--   * a superuser/owner maintenance write;
--   * database fixtures that seed a privileged profile.
--
-- The guard exists to stop an authenticated caller escalating their own role.
-- That attack always presents a user JWT, so auth.uid() is not null. When
-- auth.uid() IS NULL there is no principal whose authority could be escalated,
-- and requiring MFA enrollment for a row nobody is escalating only blocks
-- legitimate provisioning.
--
-- This mirrors the escape public.authorize_role_change() has carried since it
-- was introduced: "No authenticated identity => system/definer path (allow;
-- e.g. service_role)".
--
-- Forward-only. The applied definition is not edited; this converges the
-- final state. The MFA requirement is unchanged for every request that carries
-- a user JWT, so a resident or supervisor still cannot self-promote even with
-- a verified factor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_mfa_for_high_privilege()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IN ('director', 'institution_admin', 'admin') THEN
    -- No authenticated identity => system or definer path. There is no
    -- principal to escalate, so enrollment is not applicable.
    IF auth.uid() IS NULL THEN
      RETURN NEW;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors
      WHERE user_id = NEW.user_id AND status = 'verified'
    ) THEN
      RAISE EXCEPTION 'MFA enrollment required for role %', NEW.role;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_mfa_for_high_privilege() IS
  'Requires a verified MFA factor before a role with elevated authority is granted. A write with no authenticated principal is a system or definer path and is permitted, matching authorize_role_change().';
