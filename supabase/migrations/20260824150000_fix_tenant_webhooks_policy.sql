-- ============================================================================
-- FIX: tenant_webhooks policy used helper overloads that don't resolve live.
--
-- Found Cycle 51: director cannot register a tenant webhook (42501 on
-- INSERT) even though 00063's policy grants director+.
--
-- Root cause: the policy calls current_role_in_tenant(tenant_id,
-- ARRAY['director','institution_admin']) — a two-arg overload defined in
-- 00058. A later "restore" migration (00078) redefined a ONE-arg overload;
-- depending on apply order/drift on the remote, the two-arg resolution or
-- its NULL-returning CASE arms fail and the policy evaluates false.
--
-- Fix: express the check directly with get_user_role() (proven working in
-- every other policy: templates, goals, notifications) — same semantics:
--   * same tenant AND role in (director, institution_admin), OR global admin
-- ============================================================================

DROP POLICY IF EXISTS tenant_webhooks_admin ON public.tenant_webhooks;

CREATE POLICY tenant_webhooks_admin ON public.tenant_webhooks
  FOR ALL
  TO authenticated
  USING (
    (
      tenant_id = get_tenant_id()
      AND get_user_role() IN ('director', 'institution_admin')
    )
    OR get_user_role() = 'admin'
  )
  WITH CHECK (
    (
      tenant_id = get_tenant_id()
      AND get_user_role() IN ('director', 'institution_admin')
    )
    OR get_user_role() = 'admin'
  );
