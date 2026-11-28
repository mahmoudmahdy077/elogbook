-- 20261127000300_consent_tenant_scope_and_grants.sql
--
-- Two consent hardening gaps:
--   1. The raw insert policy checked only `user_id = auth.uid()`, so a user
--      could write a consent row for another tenant id. The RPC already
--      verifies membership; the table policy must match it.
--   2. set_user_consent relied on default PUBLIC execute. Grant it only to
--      authenticated (it raises when auth.uid() is null, but fail-closed
--      grants are cheaper to reason about).
--
-- destructive: no — one policy replaced, grants only.

DROP POLICY IF EXISTS "Users can insert own consent records" ON public.consent_records;
CREATE POLICY "Users can insert own consent records" ON public.consent_records
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = get_tenant_id()
  );

REVOKE ALL ON FUNCTION public.set_user_consent(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_consent(UUID, TEXT, BOOLEAN) TO authenticated;
