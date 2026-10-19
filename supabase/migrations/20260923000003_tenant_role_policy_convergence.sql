-- 20260923000003_tenant_role_policy_convergence.sql
--
-- Forward-only policy convergence for the tenant-scoped identity, billing,
-- assessment, scheduling, comment, scholarly, and duty-hour surfaces.
-- Historical migrations are intentionally left unchanged.
--
-- Task 5 helpers are authoritative: get_tenant_id() and get_user_role()
-- return NULL when the profile, tenant, or account status is missing or not
-- active. Every predicate below therefore fails closed on unknown status.
-- Platform authority is granted only through platform_admins; a profile role
-- string alone never grants cross-tenant access.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins AS platform_operator
    WHERE platform_operator.user_id = auth.uid()
      AND platform_operator.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM public.profiles AS platform_profile
        WHERE platform_profile.user_id = auth.uid()
          AND platform_profile.status IS DISTINCT FROM 'active'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.comment_parent_in_tenant(
  p_parent_id UUID,
  p_tenant_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_parent_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.comments AS parent
      WHERE parent.id = p_parent_id
        AND parent.tenant_id = p_tenant_id
    );
$$;

REVOKE ALL ON FUNCTION public.comment_parent_in_tenant(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comment_parent_in_tenant(UUID, UUID) TO authenticated, service_role;

-- Profiles: identity rows are tenant-bound, and the old role-only delete is
-- split so an institution administrator cannot reach another tenant.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Supervisor+ can read tenant profiles" ON public.profiles;
DROP POLICY IF EXISTS "Any authenticated user can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated user can insert own profile with restricted role" ON public.profiles;
DROP POLICY IF EXISTS "self-insert own profile within own tenant" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Supervisor+ can update resident profiles in tenant" ON public.profiles;
DROP POLICY IF EXISTS "Admin can delete profiles" ON public.profiles;

CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND user_id = auth.uid()
  );

CREATE POLICY "Supervisor+ can read tenant profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "Platform admins can read profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- Direct client profile creation is not an authority path: the first profile
-- is created by the trusted auth trigger/service-role setup path. The
-- authenticated policy is therefore limited to a registry operator creating
-- its own active-tenant profile; a missing principal cannot bootstrap itself.
CREATE POLICY "Profile inserts are server-owned"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.tenants AS candidate_tenant
      WHERE candidate_tenant.id = profiles.tenant_id
        AND candidate_tenant.status = 'active'
    )
  );

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND user_id = auth.uid()
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND user_id = auth.uid()
  );

-- The legacy admin role remains tenant-scoped here so an existing admin can
-- assign roles inside its own tenant; it is not global platform authority.
CREATE POLICY "Supervisor+ can update resident profiles in tenant"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
  );

CREATE POLICY "Platform admins can update profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Tenant admins can delete profiles"
  ON public.profiles FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('institution_admin', 'admin')
  );

CREATE POLICY "Platform admins can delete profiles"
  ON public.profiles FOR DELETE TO authenticated
  USING (public.is_platform_admin());

-- Tenants: the legacy role-only FOR ALL policy is global. Only an active
-- registry operator can manage tenant records now.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own tenant" ON public.tenants;
DROP POLICY IF EXISTS "Admin can manage all tenants" ON public.tenants;

CREATE POLICY "Users can read own tenant"
  ON public.tenants FOR SELECT TO authenticated
  USING (
    id = public.get_tenant_id()
    OR public.is_platform_admin()
  );

CREATE POLICY "Platform admins can insert tenants"
  ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Platform admins can update tenants"
  ON public.tenants FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "Platform admins can delete tenants"
  ON public.tenants FOR DELETE TO authenticated
  USING (public.is_platform_admin());

-- Subscription plans: the catalog is global, so management is limited to a
-- registry operator or the owner of a newly-created custom plan.
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "All authenticated users can read subscription plans" ON public.subscription_plans;
DROP POLICY IF EXISTS "Admin can manage subscription plans" ON public.subscription_plans;

CREATE POLICY "Active tenant members can read subscription plans"
  ON public.subscription_plans FOR SELECT TO authenticated
  USING (
    public.get_tenant_id() IS NOT NULL
    OR public.is_platform_admin()
  );

CREATE POLICY "Custom plan owners can insert subscription plans"
  ON public.subscription_plans FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      public.get_user_role() = 'institution_admin'
      AND is_custom = TRUE
      AND created_by = auth.uid()
    )
  );

CREATE POLICY "Custom plan owners can update subscription plans"
  ON public.subscription_plans FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      public.get_user_role() = 'institution_admin'
      AND is_custom = TRUE
      AND created_by = auth.uid()
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      public.get_user_role() = 'institution_admin'
      AND is_custom = TRUE
      AND created_by = auth.uid()
    )
  );

CREATE POLICY "Custom plan owners can delete subscription plans"
  ON public.subscription_plans FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      public.get_user_role() = 'institution_admin'
      AND is_custom = TRUE
      AND created_by = auth.uid()
    )
  );

-- Custom plan features: plan ownership is tenant/owner scoped rather than
-- exposing every plan's feature rows to every authenticated user.
ALTER TABLE public.custom_plan_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_plan_features FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage custom plan features" ON public.custom_plan_features;
DROP POLICY IF EXISTS "All authenticated can read custom plan features" ON public.custom_plan_features;

CREATE POLICY "Tenant members can read custom plan features"
  ON public.custom_plan_features FOR SELECT TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      public.get_tenant_id() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.subscription_plans AS plan_row
        WHERE plan_row.id = custom_plan_features.plan_id
          AND (
            plan_row.created_by = auth.uid()
            OR EXISTS (
              SELECT 1
              FROM public.subscriptions AS subscription
              WHERE subscription.plan_id = plan_row.id
                AND subscription.tenant_id = public.get_tenant_id()
            )
          )
      )
    )
  );

CREATE POLICY "Tenant plan owners can insert custom plan features"
  ON public.custom_plan_features FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      public.get_user_role() = 'institution_admin'
      AND public.get_tenant_id() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.subscription_plans AS plan_row
        WHERE plan_row.id = custom_plan_features.plan_id
          AND plan_row.is_custom = TRUE
          AND plan_row.created_by = auth.uid()
      )
    )
  );

CREATE POLICY "Tenant plan owners can update custom plan features"
  ON public.custom_plan_features FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      public.get_user_role() = 'institution_admin'
      AND public.get_tenant_id() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.subscription_plans AS plan_row
        WHERE plan_row.id = custom_plan_features.plan_id
          AND plan_row.is_custom = TRUE
          AND plan_row.created_by = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      public.get_user_role() = 'institution_admin'
      AND public.get_tenant_id() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.subscription_plans AS plan_row
        WHERE plan_row.id = custom_plan_features.plan_id
          AND plan_row.is_custom = TRUE
          AND plan_row.created_by = auth.uid()
      )
    )
  );

CREATE POLICY "Tenant plan owners can delete custom plan features"
  ON public.custom_plan_features FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      public.get_user_role() = 'institution_admin'
      AND public.get_tenant_id() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.subscription_plans AS plan_row
        WHERE plan_row.id = custom_plan_features.plan_id
          AND plan_row.is_custom = TRUE
          AND plan_row.created_by = auth.uid()
      )
    )
  );

-- Subscriptions: separate read/write policies keep the institution-admin
-- branch pinned to get_tenant_id() in USING and WITH CHECK.
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can read own subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Admin can manage subscriptions" ON public.subscriptions;

CREATE POLICY "Tenant members can read own subscription"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    OR public.is_platform_admin()
  );

CREATE POLICY "Tenant admins can insert subscriptions"
  ON public.subscriptions FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  );

CREATE POLICY "Tenant admins can update subscriptions"
  ON public.subscriptions FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  );

CREATE POLICY "Tenant admins can delete subscriptions"
  ON public.subscriptions FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  );

-- Payments follow the same tenant/role split; payment rows are never made
-- writable by a role string without an active tenant or platform registry.
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can read own payment history" ON public.payments;
DROP POLICY IF EXISTS "Admin can manage payments" ON public.payments;

CREATE POLICY "Tenant members can read own payment history"
  ON public.payments FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    OR public.is_platform_admin()
  );

CREATE POLICY "Tenant admins can insert payments"
  ON public.payments FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  );

CREATE POLICY "Tenant admins can update payments"
  ON public.payments FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  );

CREATE POLICY "Tenant admins can delete payments"
  ON public.payments FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  );

-- Subscription changes are tenant audit records. The tenant-admin write
-- branch also pins changed_by to the authenticated actor.
ALTER TABLE public.subscription_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_changes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage subscription changes" ON public.subscription_changes;
DROP POLICY IF EXISTS "All authenticated can read subscription changes" ON public.subscription_changes;

CREATE POLICY "Tenant members can read subscription changes"
  ON public.subscription_changes FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    OR public.is_platform_admin()
  );

CREATE POLICY "Tenant admins can insert subscription changes"
  ON public.subscription_changes FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
      AND changed_by = auth.uid()
    )
  );

CREATE POLICY "Tenant admins can update subscription changes"
  ON public.subscription_changes FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
      AND changed_by = auth.uid()
    )
  );

CREATE POLICY "Tenant admins can delete subscription changes"
  ON public.subscription_changes FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  );

-- Tenant settings: the old FOR ALL role-only policy is replaced with one
-- policy per operation and a tenant check on every write side.
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin can manage tenant settings" ON public.tenant_settings;
DROP POLICY IF EXISTS "Tenant members can read tenant settings" ON public.tenant_settings;

CREATE POLICY "Tenant members can read tenant settings"
  ON public.tenant_settings FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    OR public.is_platform_admin()
  );

CREATE POLICY "Tenant admins can insert tenant settings"
  ON public.tenant_settings FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  );

CREATE POLICY "Tenant admins can update tenant settings"
  ON public.tenant_settings FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  );

CREATE POLICY "Tenant admins can delete tenant settings"
  ON public.tenant_settings FOR DELETE TO authenticated
  USING (
    public.is_platform_admin()
    OR (
      tenant_id = public.get_tenant_id()
      AND public.get_user_role() = 'institution_admin'
    )
  );

-- Notifications: ownership and supervisor workflows are operation-specific;
-- target-user membership is checked so a tenant admin cannot forge a row for
-- an account outside the tenant.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_own ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_tenant ON public.notifications;
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
DROP POLICY IF EXISTS notifications_delete_own ON public.notifications;

CREATE POLICY notifications_select_own
  ON public.notifications FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      user_id = auth.uid()
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

CREATE POLICY notifications_insert_tenant
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND (
      user_id = auth.uid()
      OR (
        public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
        AND EXISTS (
          SELECT 1
          FROM public.profiles AS recipient
          WHERE recipient.user_id = notifications.user_id
            AND recipient.tenant_id = notifications.tenant_id
        )
      )
    )
  );

CREATE POLICY notifications_update_own
  ON public.notifications FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND user_id = auth.uid()
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND user_id = auth.uid()
  );

CREATE POLICY notifications_delete_own
  ON public.notifications FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      user_id = auth.uid()
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

-- Faculty evaluations: residents can see their own rows, evaluators can see
-- rows they authored, and supervisor+ access is restricted to one tenant.
ALTER TABLE public.faculty_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_evaluations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS faculty_evals_tenant_isolation ON public.faculty_evaluations;

CREATE POLICY faculty_evals_select
  ON public.faculty_evaluations FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR evaluator_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

CREATE POLICY faculty_evals_insert
  ON public.faculty_evaluations FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = faculty_evaluations.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS evaluator_profile
      WHERE evaluator_profile.id = faculty_evaluations.evaluator_id
        AND evaluator_profile.tenant_id = public.get_tenant_id()
    )
  );

CREATE POLICY faculty_evals_update
  ON public.faculty_evaluations FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      evaluator_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND (
      evaluator_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = faculty_evaluations.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS evaluator_profile
      WHERE evaluator_profile.id = faculty_evaluations.evaluator_id
        AND evaluator_profile.tenant_id = public.get_tenant_id()
    )
  );

CREATE POLICY faculty_evals_delete
  ON public.faculty_evaluations FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      evaluator_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

-- Evaluation forms: the trigger retains the resident acknowledgement
-- transition, while the RLS policies now also require an owner/evaluator or
-- supervisor role instead of granting a tenant-wide update.
ALTER TABLE public.evaluation_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_forms FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eval_forms_tenant ON public.evaluation_forms;
DROP POLICY IF EXISTS eval_forms_select ON public.evaluation_forms;
DROP POLICY IF EXISTS eval_forms_insert ON public.evaluation_forms;
DROP POLICY IF EXISTS eval_forms_update ON public.evaluation_forms;
DROP POLICY IF EXISTS eval_forms_delete ON public.evaluation_forms;

CREATE POLICY eval_forms_select
  ON public.evaluation_forms FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR evaluator_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

CREATE POLICY eval_forms_insert
  ON public.evaluation_forms FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = evaluation_forms.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS evaluator_profile
      WHERE evaluator_profile.id = evaluation_forms.evaluator_id
        AND evaluator_profile.tenant_id = public.get_tenant_id()
    )
  );

CREATE POLICY eval_forms_update
  ON public.evaluation_forms FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR evaluator_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR evaluator_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = evaluation_forms.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS evaluator_profile
      WHERE evaluator_profile.id = evaluation_forms.evaluator_id
        AND evaluator_profile.tenant_id = public.get_tenant_id()
    )
  );

CREATE POLICY eval_forms_delete
  ON public.evaluation_forms FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      evaluator_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

-- Rotations: remove the tenant-wide FOR ALL policy; scheduling writes are
-- limited to directors/institution admins in the caller's active tenant.
ALTER TABLE public.rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rotations_tenant_isolation ON public.rotations;
DROP POLICY IF EXISTS rotations_select_own ON public.rotations;
DROP POLICY IF EXISTS rotations_insert_director ON public.rotations;
DROP POLICY IF EXISTS rotations_update_director ON public.rotations;
DROP POLICY IF EXISTS rotations_delete_director ON public.rotations;

CREATE POLICY rotations_select
  ON public.rotations FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

CREATE POLICY rotations_insert_director
  ON public.rotations FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('director', 'institution_admin')
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = rotations.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
    AND (
      supervisor_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.profiles AS supervisor_profile
        WHERE supervisor_profile.id = rotations.supervisor_id
          AND supervisor_profile.tenant_id = public.get_tenant_id()
      )
    )
  );

CREATE POLICY rotations_update_director
  ON public.rotations FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('director', 'institution_admin')
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('director', 'institution_admin')
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = rotations.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
    AND (
      supervisor_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.profiles AS supervisor_profile
        WHERE supervisor_profile.id = rotations.supervisor_id
          AND supervisor_profile.tenant_id = public.get_tenant_id()
      )
    )
  );

CREATE POLICY rotations_delete_director
  ON public.rotations FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('director', 'institution_admin')
  );

-- Shifts: residents may manage only their own shifts; supervisors and
-- directors may manage shifts whose rotation and resident stay in-tenant.
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shifts_tenant_isolation ON public.shifts;

CREATE POLICY shifts_select
  ON public.shifts FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

CREATE POLICY shifts_insert
  ON public.shifts FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.rotations AS rotation
      WHERE rotation.id = shifts.rotation_id
        AND rotation.tenant_id = public.get_tenant_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = shifts.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
  );

CREATE POLICY shifts_update
  ON public.shifts FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.rotations AS rotation
      WHERE rotation.id = shifts.rotation_id
        AND rotation.tenant_id = public.get_tenant_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = shifts.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
  );

CREATE POLICY shifts_delete
  ON public.shifts FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

-- Milestones: the old tenant-wide FOR ALL policy allowed any tenant member to
-- alter any resident's assessment. Select/write predicates now use the
-- resident/assessor owner and the same-tenant evidence relation.
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS milestones_tenant ON public.milestones;

CREATE POLICY milestones_select
  ON public.milestones FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR assessor_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

CREATE POLICY milestones_insert
  ON public.milestones FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR assessor_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = milestones.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
    AND (
      assessor_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.profiles AS assessor_profile
        WHERE assessor_profile.id = milestones.assessor_id
          AND assessor_profile.tenant_id = public.get_tenant_id()
      )
    )
    AND (
      evidence_entry_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.case_entries AS evidence
        WHERE evidence.id = milestones.evidence_entry_id
          AND evidence.tenant_id = public.get_tenant_id()
      )
    )
  );

CREATE POLICY milestones_update
  ON public.milestones FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR assessor_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR assessor_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = milestones.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
    AND (
      assessor_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.profiles AS assessor_profile
        WHERE assessor_profile.id = milestones.assessor_id
          AND assessor_profile.tenant_id = public.get_tenant_id()
      )
    )
    AND (
      evidence_entry_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.case_entries AS evidence
        WHERE evidence.id = milestones.evidence_entry_id
          AND evidence.tenant_id = public.get_tenant_id()
      )
    )
  );

CREATE POLICY milestones_delete
  ON public.milestones FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      assessor_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

-- Comments: tenant membership alone is insufficient because entry/evaluation
-- parents and the author are independent foreign keys.
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comments_tenant ON public.comments;

CREATE POLICY comments_select
  ON public.comments FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      author_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
      OR EXISTS (
        SELECT 1 FROM public.case_entries AS entry
        WHERE entry.id = comments.entry_id
          AND entry.tenant_id = public.get_tenant_id()
          AND entry.resident_id = (
            SELECT principal.profile_id
            FROM public.get_authoritative_principal() AS principal
            WHERE principal.profile_status = 'active'
              AND principal.tenant_status = 'active'
            LIMIT 1
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.evaluation_forms AS evaluation
        WHERE evaluation.id = comments.evaluation_id
          AND evaluation.tenant_id = public.get_tenant_id()
          AND evaluation.resident_id = (
            SELECT principal.profile_id
            FROM public.get_authoritative_principal() AS principal
            WHERE principal.profile_status = 'active'
              AND principal.tenant_status = 'active'
            LIMIT 1
          )
      )
    )
  );

CREATE POLICY comments_insert
  ON public.comments FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND author_id = (
      SELECT principal.profile_id
      FROM public.get_authoritative_principal() AS principal
      WHERE principal.profile_status = 'active'
        AND principal.tenant_status = 'active'
      LIMIT 1
    )
    AND (
      entry_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.case_entries AS entry
        WHERE entry.id = comments.entry_id
          AND entry.tenant_id = public.get_tenant_id()
      )
    )
    AND (
      evaluation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.evaluation_forms AS evaluation
        WHERE evaluation.id = comments.evaluation_id
          AND evaluation.tenant_id = public.get_tenant_id()
      )
    )
    AND (
      parent_id IS NULL
      OR public.comment_parent_in_tenant(parent_id, tenant_id)
    )
  );

CREATE POLICY comments_update
  ON public.comments FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      author_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND (
      author_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
    AND (
      entry_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.case_entries AS entry
        WHERE entry.id = comments.entry_id
          AND entry.tenant_id = public.get_tenant_id()
      )
    )
    AND (
      evaluation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.evaluation_forms AS evaluation
        WHERE evaluation.id = comments.evaluation_id
          AND evaluation.tenant_id = public.get_tenant_id()
      )
    )
    AND (
      parent_id IS NULL
      OR public.comment_parent_in_tenant(parent_id, tenant_id)
    )
  );

CREATE POLICY comments_delete
  ON public.comments FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      author_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

-- Scholarly activity: residents own their entries; only supervisor+ can
-- revise or remove them, matching the existing workflow.
ALTER TABLE public.scholarly_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scholarly_activities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scholarly_tenant_isolation ON public.scholarly_activities;
DROP POLICY IF EXISTS scholarly_select_own ON public.scholarly_activities;
DROP POLICY IF EXISTS scholarly_insert_own ON public.scholarly_activities;
DROP POLICY IF EXISTS scholarly_update_director ON public.scholarly_activities;
DROP POLICY IF EXISTS scholarly_delete_director ON public.scholarly_activities;

CREATE POLICY scholarly_select_own
  ON public.scholarly_activities FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

CREATE POLICY scholarly_insert_own
  ON public.scholarly_activities FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = scholarly_activities.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
  );

CREATE POLICY scholarly_update_director
  ON public.scholarly_activities FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('director', 'institution_admin')
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('director', 'institution_admin')
  );

CREATE POLICY scholarly_delete_director
  ON public.scholarly_activities FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND public.get_user_role() IN ('director', 'institution_admin')
  );

-- Duty periods: the previous FOR ALL policy exposed every resident's hours to
-- every tenant member. Reads and writes are now resident-owned or explicitly
-- supervisor-authorized within the same tenant.
ALTER TABLE public.duty_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duty_periods FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS duty_periods_tenant_isolation ON public.duty_periods;

CREATE POLICY duty_periods_select
  ON public.duty_periods FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

CREATE POLICY duty_periods_insert
  ON public.duty_periods FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = duty_periods.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
  );

CREATE POLICY duty_periods_update
  ON public.duty_periods FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  )
  WITH CHECK (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles AS resident_profile
      WHERE resident_profile.id = duty_periods.resident_id
        AND resident_profile.tenant_id = public.get_tenant_id()
    )
  );

CREATE POLICY duty_periods_delete
  ON public.duty_periods FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_tenant_id()
    AND (
      resident_id = (
        SELECT principal.profile_id
        FROM public.get_authoritative_principal() AS principal
        WHERE principal.profile_status = 'active'
          AND principal.tenant_status = 'active'
        LIMIT 1
      )
      OR public.get_user_role() IN ('supervisor', 'director', 'institution_admin')
    )
  );

-- Dashboard RPC: the parameter role is never trusted. The authoritative
-- principal supplies tenant, role, and active status; residents are pinned to
-- their own profile and resident_id argument.
CREATE OR REPLACE FUNCTION public.get_dashboard_data(
  p_tenant_id UUID,
  p_resident_id UUID,
  p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_principal RECORD;
  v_actor_id UUID;
  v_role TEXT;
  v_tenant_id UUID;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_stats JSONB;
  v_recent_cases JSONB;
  v_resident_counts JSONB;
  v_pending_approvals BIGINT;
  v_total_residents BIGINT;
BEGIN
  IF NOT v_is_service_role THEN
    SELECT * INTO v_principal
    FROM public.get_authoritative_principal();

    IF NOT FOUND
       OR v_principal.profile_id IS NULL
       OR v_principal.role IS NULL
       OR v_principal.profile_status IS DISTINCT FROM 'active'
       OR v_principal.tenant_status IS DISTINCT FROM 'active'
       OR v_principal.tenant_id IS NULL THEN
      RAISE EXCEPTION 'active account and tenant are required'
        USING ERRCODE = '42501';
    END IF;

    IF p_tenant_id IS DISTINCT FROM v_principal.tenant_id THEN
      RAISE EXCEPTION 'cross-tenant dashboard access denied'
        USING ERRCODE = '42501';
    END IF;

    v_actor_id := v_principal.profile_id;
    v_role := v_principal.role;
    v_tenant_id := v_principal.tenant_id;
  ELSE
    v_tenant_id := p_tenant_id;
    v_role := COALESCE(p_role, 'admin');
  END IF;

  IF v_role IS NULL OR v_role NOT IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin') THEN
    RAISE EXCEPTION 'unknown dashboard role'
      USING ERRCODE = '42501';
  END IF;

  IF v_role = 'admin' AND NOT v_is_service_role AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'admin role requires platform registry membership'
      USING ERRCODE = '42501';
  END IF;

  IF v_role = 'resident' THEN
    IF v_actor_id IS NULL OR p_resident_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'residents may only request their own dashboard'
        USING ERRCODE = '42501';
    END IF;
  ELSIF p_resident_id IS NOT NULL AND NOT v_is_service_role THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles AS resident_profile
      WHERE resident_profile.id = p_resident_id
        AND resident_profile.tenant_id = v_tenant_id
        AND resident_profile.role = 'resident'
    ) THEN
      RAISE EXCEPTION 'resident argument is outside the active tenant'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'draft', COALESCE(count(*) FILTER (WHERE status = 'draft'), 0),
    'pending', COALESCE(count(*) FILTER (WHERE status = 'pending'), 0),
    'approved', COALESCE(count(*) FILTER (WHERE status = 'approved'), 0),
    'rejected', COALESCE(count(*) FILTER (WHERE status = 'rejected'), 0)
  ) INTO v_stats
  FROM public.case_entries AS entry
  WHERE entry.tenant_id = v_tenant_id
    AND entry.deleted_at IS NULL
    AND (v_role <> 'resident' OR entry.resident_id = v_actor_id);

  SELECT COALESCE(jsonb_agg(sub ORDER BY sub.created_at DESC), '[]'::jsonb)
  INTO v_recent_cases
  FROM (
    SELECT
      entry.id,
      entry.case_date,
      entry.status,
      template.name AS template_name,
      template.specialty AS template_specialty,
      entry.created_at
    FROM public.case_entries AS entry
    JOIN public.case_templates AS template ON template.id = entry.template_id
    WHERE entry.tenant_id = v_tenant_id
      AND entry.deleted_at IS NULL
      AND (v_role <> 'resident' OR entry.resident_id = v_actor_id)
    ORDER BY entry.created_at DESC
    LIMIT 5
  ) AS sub;

  SELECT COALESCE(jsonb_agg(sub ORDER BY sub.resident_id), '[]'::jsonb)
  INTO v_resident_counts
  FROM (
    SELECT
      entry.resident_id,
      count(*) AS total,
      count(*) FILTER (WHERE entry.status = 'approved') AS approved
    FROM public.case_entries AS entry
    WHERE entry.tenant_id = v_tenant_id
      AND entry.deleted_at IS NULL
      AND (v_role <> 'resident' OR entry.resident_id = v_actor_id)
    GROUP BY entry.resident_id
  ) AS sub;

  SELECT count(*) INTO v_pending_approvals
  FROM public.case_entries AS entry
  WHERE entry.tenant_id = v_tenant_id
    AND entry.status = 'pending'
    AND entry.deleted_at IS NULL
    AND (v_role <> 'resident' OR entry.resident_id = v_actor_id);

  SELECT count(*) INTO v_total_residents
  FROM public.profiles AS resident_profile
  WHERE resident_profile.tenant_id = v_tenant_id
    AND resident_profile.role = 'resident'
    AND (v_role <> 'resident' OR resident_profile.id = v_actor_id);

  RETURN jsonb_build_object(
    'stats', v_stats,
    'recent_cases', v_recent_cases,
    'resident_counts', v_resident_counts,
    'pending_approvals', v_pending_approvals,
    'total_residents', v_total_residents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_data(UUID, UUID, TEXT)
  TO authenticated, service_role;

-- Analytics RPC: only director/institution-admin tenant workflows may call
-- this tenant-wide aggregate; the tenant and active status are checked before
-- any table access.
CREATE OR REPLACE FUNCTION public.get_analytics_data(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_principal RECORD;
  v_role TEXT;
  v_tenant_id UUID;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_from DATE := (CURRENT_DATE - INTERVAL '11 months')::DATE;
  v_monthly_volume JSONB;
  v_specialty JSONB;
  v_monthly_rate JSONB;
  v_workload JSONB;
BEGIN
  IF NOT v_is_service_role THEN
    SELECT * INTO v_principal
    FROM public.get_authoritative_principal();

    IF NOT FOUND
       OR v_principal.profile_id IS NULL
       OR v_principal.role IS NULL
       OR v_principal.profile_status IS DISTINCT FROM 'active'
       OR v_principal.tenant_status IS DISTINCT FROM 'active'
       OR v_principal.tenant_id IS NULL THEN
      RAISE EXCEPTION 'active account and tenant are required'
        USING ERRCODE = '42501';
    END IF;

    IF p_tenant_id IS DISTINCT FROM v_principal.tenant_id THEN
      RAISE EXCEPTION 'cross-tenant analytics access denied'
        USING ERRCODE = '42501';
    END IF;

    v_role := v_principal.role;
    v_tenant_id := v_principal.tenant_id;
  ELSE
    v_role := 'admin';
    v_tenant_id := p_tenant_id;
  END IF;

  IF NOT v_is_service_role AND (v_role IS NULL OR v_role NOT IN ('director', 'institution_admin')) THEN
    RAISE EXCEPTION 'analytics access requires director role'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.month), '[]'::jsonb) INTO v_monthly_volume
  FROM (
    SELECT to_char(month_start, 'YYYY-MM') AS month,
           COALESCE(monthly_count.count, 0) AS count
    FROM generate_series(v_from, CURRENT_DATE, '1 month'::interval) AS month_start
    LEFT JOIN (
      SELECT date_trunc('month', entry.case_date)::DATE AS month,
             count(*) AS count
      FROM public.case_entries AS entry
      WHERE entry.tenant_id = v_tenant_id
        AND entry.deleted_at IS NULL
      GROUP BY 1
    ) AS monthly_count ON monthly_count.month = month_start::DATE
  ) AS t;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.count DESC), '[]'::jsonb) INTO v_specialty
  FROM (
    SELECT template.specialty, count(*) AS count
    FROM public.case_entries AS entry
    JOIN public.case_templates AS template ON template.id = entry.template_id
    WHERE entry.tenant_id = v_tenant_id
      AND entry.deleted_at IS NULL
    GROUP BY template.specialty
  ) AS t;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.month), '[]'::jsonb) INTO v_monthly_rate
  FROM (
    SELECT month_value.month,
           COALESCE(round((approval.approved::numeric / NULLIF(approval.approved + approval.rejected, 0)), 3), 0) AS rate
    FROM (
      SELECT to_char(month_start, 'YYYY-MM') AS month
      FROM generate_series(v_from, CURRENT_DATE, '1 month'::interval) AS month_start
    ) AS month_value
    LEFT JOIN (
      SELECT to_char(date_trunc('month', entry.case_date)::DATE, 'YYYY-MM') AS month,
             count(*) FILTER (WHERE entry.status = 'approved') AS approved,
             count(*) FILTER (WHERE entry.status = 'rejected') AS rejected
      FROM public.case_entries AS entry
      WHERE entry.tenant_id = v_tenant_id
        AND entry.deleted_at IS NULL
      GROUP BY 1
    ) AS approval ON approval.month = month_value.month
  ) AS t;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.supervisor_id), '[]'::jsonb) INTO v_workload
  FROM (
    SELECT
      approval.supervisor_id,
      count(*) FILTER (WHERE approval.status = 'pending') AS pending,
      count(*) FILTER (WHERE approval.status = 'approved') AS approved,
      count(*) FILTER (WHERE approval.status = 'rejected') AS rejected,
      COALESCE(supervisor.full_name, 'Unknown') AS supervisor_name
    FROM public.approval_requests AS approval
    LEFT JOIN public.profiles AS supervisor ON supervisor.id = approval.supervisor_id
    WHERE approval.tenant_id = v_tenant_id
      AND approval.supervisor_id IS NOT NULL
    GROUP BY approval.supervisor_id, supervisor.full_name
  ) AS t;

  RETURN jsonb_build_object(
    'monthly_volume', v_monthly_volume,
    'specialty_breakdown', v_specialty,
    'monthly_approval_rate', v_monthly_rate,
    'supervisor_workload', v_workload
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_analytics_data(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_data(UUID) TO authenticated, service_role;

-- Report RPC: residents are reduced to their own profile because this RPC has
-- no resident parameter; supervisor+ retain the tenant-wide report workflow.
CREATE OR REPLACE FUNCTION public.get_report_counts(
  p_tenant_id UUID,
  p_date_from TEXT DEFAULT NULL,
  p_date_to TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_principal RECORD;
  v_actor_id UUID;
  v_role TEXT;
  v_tenant_id UUID;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
  v_status JSONB;
  v_specialty JSONB;
  v_eval JSONB;
  v_eval_count BIGINT;
  v_from TIMESTAMPTZ := NULLIF(p_date_from, '')::timestamptz;
  v_to TIMESTAMPTZ := NULLIF(p_date_to, '')::timestamptz;
BEGIN
  IF NOT v_is_service_role THEN
    SELECT * INTO v_principal
    FROM public.get_authoritative_principal();

    IF NOT FOUND
       OR v_principal.profile_id IS NULL
       OR v_principal.role IS NULL
       OR v_principal.profile_status IS DISTINCT FROM 'active'
       OR v_principal.tenant_status IS DISTINCT FROM 'active'
       OR v_principal.tenant_id IS NULL THEN
      RAISE EXCEPTION 'active account and tenant are required'
        USING ERRCODE = '42501';
    END IF;

    IF p_tenant_id IS DISTINCT FROM v_principal.tenant_id THEN
      RAISE EXCEPTION 'cross-tenant report access denied'
        USING ERRCODE = '42501';
    END IF;

    v_actor_id := v_principal.profile_id;
    v_role := v_principal.role;
    v_tenant_id := v_principal.tenant_id;
  ELSE
    v_role := 'admin';
    v_tenant_id := p_tenant_id;
  END IF;

  IF v_role IS NULL OR v_role NOT IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin') THEN
    RAISE EXCEPTION 'unknown report role'
      USING ERRCODE = '42501';
  END IF;

  IF v_role = 'admin' AND NOT v_is_service_role AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'admin role requires platform registry membership'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'draft', COALESCE(count(*) FILTER (WHERE entry.status = 'draft'), 0),
    'pending', COALESCE(count(*) FILTER (WHERE entry.status = 'pending'), 0),
    'approved', COALESCE(count(*) FILTER (WHERE entry.status = 'approved'), 0),
    'rejected', COALESCE(count(*) FILTER (WHERE entry.status = 'rejected'), 0)
  ) INTO v_status
  FROM public.case_entries AS entry
  WHERE entry.tenant_id = v_tenant_id
    AND entry.deleted_at IS NULL
    AND (v_role <> 'resident' OR entry.resident_id = v_actor_id)
    AND (v_from IS NULL OR entry.created_at >= v_from)
    AND (v_to IS NULL OR entry.created_at <= v_to);

  SELECT COALESCE(jsonb_object_agg(t.specialty, t.count), '{}'::jsonb) INTO v_specialty
  FROM (
    SELECT template.specialty, count(*) AS count
    FROM public.case_entries AS entry
    JOIN public.case_templates AS template ON template.id = entry.template_id
    WHERE entry.tenant_id = v_tenant_id
      AND entry.deleted_at IS NULL
      AND (v_role <> 'resident' OR entry.resident_id = v_actor_id)
      AND (v_from IS NULL OR entry.created_at >= v_from)
      AND (v_to IS NULL OR entry.created_at <= v_to)
    GROUP BY template.specialty
  ) AS t;

  SELECT jsonb_build_object(
    'clinical', COALESCE(round(avg(evaluation.clinical_skills)::numeric, 1), 0),
    'prof', COALESCE(round(avg(evaluation.professionalism)::numeric, 1), 0),
    'proc', COALESCE(round(avg(evaluation.procedures)::numeric, 1), 0)
  ), count(*)
  INTO v_eval, v_eval_count
  FROM public.faculty_evaluations AS evaluation
  WHERE evaluation.tenant_id = v_tenant_id
    AND (v_role <> 'resident' OR evaluation.resident_id = v_actor_id);

  RETURN jsonb_build_object(
    'status_counts', v_status,
    'specialty_counts', v_specialty,
    'eval_averages', v_eval,
    'eval_count', v_eval_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_report_counts(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_report_counts(UUID, TEXT, TEXT)
  TO authenticated, service_role;

-- Duty-hour RPC: the old wrapper accepted any tenant argument because its
-- SECURITY DEFINER body only filtered the view. It now derives the caller
-- tenant and limits residents to their own rows.
CREATE OR REPLACE FUNCTION public.get_duty_4wk_violations(p_tenant_id UUID)
RETURNS TABLE (
  tenant_id UUID,
  resident_id UUID,
  window_start DATE,
  window_end DATE,
  avg_hours NUMERIC,
  weeks_in_window BIGINT,
  week_hours NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_principal RECORD;
  v_actor_id UUID;
  v_role TEXT;
  v_tenant_id UUID;
  v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', FALSE);
BEGIN
  IF NOT v_is_service_role THEN
    SELECT * INTO v_principal
    FROM public.get_authoritative_principal();

    IF NOT FOUND
       OR v_principal.profile_id IS NULL
       OR v_principal.role IS NULL
       OR v_principal.profile_status IS DISTINCT FROM 'active'
       OR v_principal.tenant_status IS DISTINCT FROM 'active'
       OR v_principal.tenant_id IS NULL THEN
      RAISE EXCEPTION 'active account and tenant are required'
        USING ERRCODE = '42501';
    END IF;

    IF p_tenant_id IS NOT NULL AND p_tenant_id IS DISTINCT FROM v_principal.tenant_id THEN
      RAISE EXCEPTION 'cross-tenant duty-hour access denied'
        USING ERRCODE = '42501';
    END IF;

    v_actor_id := v_principal.profile_id;
    v_role := v_principal.role;
    v_tenant_id := v_principal.tenant_id;
  ELSE
    v_role := 'admin';
    v_tenant_id := p_tenant_id;
  END IF;

  IF v_role IS NULL OR v_role NOT IN ('resident', 'supervisor', 'director', 'institution_admin', 'admin') THEN
    RAISE EXCEPTION 'unknown duty-hour role'
      USING ERRCODE = '42501';
  END IF;

  IF v_role = 'admin' AND NOT v_is_service_role AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'admin role requires platform registry membership'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    violation.tenant_id,
    violation.resident_id,
    violation.window_start,
    violation.window_end,
    violation.avg_hours,
    violation.weeks_in_window::BIGINT,
    violation.week_hours
  FROM public.duty_4wk_violations AS violation
  WHERE (
      v_is_service_role
      OR violation.tenant_id = v_tenant_id
    )
    AND (
      v_role <> 'resident'
      OR violation.resident_id = v_actor_id
    )
  ORDER BY violation.resident_id, violation.window_end;
END;
$$;

REVOKE ALL ON FUNCTION public.get_duty_4wk_violations(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_duty_4wk_violations(UUID)
  TO authenticated, service_role;
