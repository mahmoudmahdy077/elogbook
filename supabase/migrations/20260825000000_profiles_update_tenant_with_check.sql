-- ============================================================================
-- 20260825000000_profiles_update_tenant_with_check.sql
--
-- Security fix (swarm Wave 1 finding F1, P2):
-- "Users can update own profile" had WITH CHECK (user_id = auth.uid()) only,
-- so any client role could PATCH their own profiles.tenant_id into ANY real
-- tenant (204 OK) - breaking the DB-level tenant-isolation invariant and
-- polluting the target tenant's member listing.
-- "Supervisor+ can update resident profiles in tenant" had USING-only tenant
-- scoping and NO WITH CHECK, allowing supervisors to relocate resident rows
-- across tenants as well.
--
-- Fix: add tenant WITH CHECK guards to both UPDATE policies. Legitimate
-- cross-tenant membership moves were never supported through these policies
-- (JWT tenant claim is sourced independently), so this closes the hole
-- without changing intended behavior.
-- ============================================================================

-- 1. Own-profile updates: pin tenant_id to the caller's current tenant
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = get_tenant_id()
  );

-- 2. Supervisor+ updating resident profiles: new row must stay in-tenant too
DROP POLICY IF EXISTS "Supervisor+ can update resident profiles in tenant"
  ON public.profiles;
CREATE POLICY "Supervisor+ can update resident profiles in tenant"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  )
  WITH CHECK (tenant_id = get_tenant_id());
