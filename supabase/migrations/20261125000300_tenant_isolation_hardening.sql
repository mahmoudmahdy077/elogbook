-- ============================================================================
-- 20261125000300_tenant_isolation_hardening.sql
--
-- Forward migration for five tenant-isolation defects found by the
-- 2026-11-25 security audit. Each policy below is permissive (OR'd), so a
-- role-only predicate silently widened access to every tenant.
--
--   1. sync_pull_changes(): SECURITY DEFINER, PUBLIC-executable, and its
--      guard was `p_tenant_id <> get_tenant_id()`. For anon, get_tenant_id()
--      is NULL, the comparison is NULL, and the function returned any
--      tenant's case_entries (patient_mrn, patient_dob, field_values).
--      Verified: `set role anon; select count(*) from
--      sync_pull_changes('case_entries', '<demo tenant>')` returned rows.
--   2. profiles DELETE was role-only → institution_admin could delete any
--      tenant's profiles.
--   3. notifications SELECT/DELETE were role-only → tenant leads read and
--      deleted every tenant's notifications.
--   4. payments/subscriptions ALL were role-only → cross-tenant billing
--      read/write.
--   5. reflections_tenant_isolation was permissive FOR ALL, so it defeated
--      the author/shared privacy policies: any tenant member could read and
--      edit every private reflection. It becomes RESTRICTIVE instead.
--
-- Also revokes the privileges RLS does not cover (TRUNCATE/TRIGGER/REFERENCES)
-- from anon, and stops the unused cross-tenant aggregate view from running as
-- its owner for anon.
--
-- destructive: no — policies are replaced, no table or row is removed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. sync_pull_changes: NULL-safe guard + no anonymous execution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_pull_changes(
  p_table_name text,
  p_tenant_id uuid,
  p_since timestamptz DEFAULT '1970-01-01T00:00:00Z',
  p_limit int DEFAULT 500
)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  allowed_tables text[] := ARRAY[
    'case_entries', 'case_templates', 'program_goals', 'rotations',
    'milestones', 'evaluation_forms', 'comments', 'shifts'
  ];
  sql_query text;
BEGIN
  IF p_table_name <> ALL(allowed_tables) THEN
    RAISE EXCEPTION 'Invalid table name for sync: %', p_table_name;
  END IF;

  -- Fail closed. `<>` with a NULL tenant (anon, or a token without a tenant
  -- claim) is NULL, which skipped the old check entirely.
  IF auth.uid() IS NULL OR p_tenant_id IS DISTINCT FROM get_tenant_id() THEN
    RAISE EXCEPTION 'cross-tenant pull rejected';
  END IF;

  sql_query := format(
    'SELECT to_jsonb(t.*) FROM %I t
     WHERE t.tenant_id = $1
       AND t.updated_at > $2
       AND (t.deleted_at IS NULL OR t.deleted_at > $2)
     ORDER BY t.updated_at ASC
     LIMIT $3',
    p_table_name
  );

  RETURN QUERY EXECUTE sql_query
    USING p_tenant_id, p_since, p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_pull_changes(text, uuid, timestamptz, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_pull_changes(text, uuid, timestamptz, int) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. profiles: delete only inside the caller's tenant (platform admin excepted)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can delete profiles" ON public.profiles;
CREATE POLICY "Admin can delete profiles" ON public.profiles
  FOR DELETE TO authenticated
  USING (
    get_user_role() = 'admin'
    OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin')
  );

-- ---------------------------------------------------------------------------
-- 3. notifications: keep the tenant boundary for non-owners
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      tenant_id = get_tenant_id()
      AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS notifications_delete_own ON public.notifications;
CREATE POLICY notifications_delete_own ON public.notifications
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      tenant_id = get_tenant_id()
      AND get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 4. billing: tenant predicate on the admin policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can manage payments" ON public.payments;
CREATE POLICY "Admin can manage payments" ON public.payments
  FOR ALL TO authenticated
  USING (
    get_user_role() = 'admin'
    OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin')
  )
  WITH CHECK (
    get_user_role() = 'admin'
    OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin')
  );

DROP POLICY IF EXISTS "Admin can manage subscriptions" ON public.subscriptions;
CREATE POLICY "Admin can manage subscriptions" ON public.subscriptions
  FOR ALL TO authenticated
  USING (
    get_user_role() = 'admin'
    OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin')
  )
  WITH CHECK (
    get_user_role() = 'admin'
    OR (tenant_id = get_tenant_id() AND get_user_role() = 'institution_admin')
  );

-- ---------------------------------------------------------------------------
-- 5. reflections: tenant check must AND with the privacy policies, not OR
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS reflections_tenant_isolation ON public.reflections;
CREATE POLICY reflections_tenant_isolation ON public.reflections
  AS RESTRICTIVE
  FOR ALL TO public
  USING (tenant_id = get_tenant_id())
  WITH CHECK (tenant_id = get_tenant_id());

-- ---------------------------------------------------------------------------
-- 6. Privileges RLS does not govern
--    (TRUNCATE ignores RLS; TRIGGER/REFERENCES are DDL-adjacent.)
-- ---------------------------------------------------------------------------
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon;

-- ---------------------------------------------------------------------------
-- 7. Unused SECURITY DEFINER helpers should not be anon-callable
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.log_backup_run FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_backup_run TO service_role;

-- Three overloads exist; the two-arg (tenant, resident) one has the same
-- NULL-unsafe guard as sync_pull_changes, so close all three to anon.
REVOKE ALL ON FUNCTION public.get_case_stats(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_case_stats(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_case_stats(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_case_stats(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_case_stats(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_case_stats(uuid, uuid, date, date) TO authenticated, service_role;

-- The view aggregated every tenant's evaluation averages as its owner.
-- security_invoker makes faculty_evaluations RLS decide, and anon loses it.
ALTER VIEW public.resident_evaluation_averages SET (security_invoker = true, security_barrier = true);
REVOKE ALL ON public.resident_evaluation_averages FROM anon;
