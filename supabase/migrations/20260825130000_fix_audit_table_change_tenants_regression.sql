-- ============================================================================
-- 20260825130000_fix_audit_table_change_tenants_regression.sql
--
-- Swarm Wave-2 P1: creating ANY new tenant fails with
--   'record "new" has no field "tenant_id"'
-- breaking new-institution onboarding in production.
--
-- Root cause: 20260823010000 rewrote audit_table_change() to fix a uuid cast,
-- but dropped the tenants special-case from 20260818130000. The rewritten
-- body evaluates COALESCE(NEW.tenant_id, OLD.tenant_id) unconditionally -
-- the tenants table has no tenant_id column, so tenants INSERT (and DELETE,
-- where NEW is unbound) raise immediately. It also removed the NULL-guard,
-- writing audit rows with NULL tenant_id for any other table lacking one.
--
-- Fix: combine all three - native uuid resource_id, per-table tenant
-- resolution (tenants -> NEW.id/OLD.id), and skip audit rows without one.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_table_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_action TEXT;
  v_changes jsonb := '{}'::jsonb;
  v_excluded TEXT[];
  v_resource_id UUID;
  v_tenant_id UUID;
BEGIN
  IF TG_NARGS > 0 THEN v_excluded := string_to_array(TG_ARGV[0], ', '); ELSE v_excluded := '{}'::TEXT[]; END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'insert';
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    SELECT jsonb_object_agg(key, value) INTO v_changes
    FROM jsonb_each(v_new)
    WHERE NOT (key = ANY(v_excluded))
      AND (v_old -> key) IS DISTINCT FROM value;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_old := to_jsonb(OLD);
  END IF;

  -- Native uuid preserved (42804 fix from 20260823010000)
  v_resource_id := COALESCE(NEW.id, OLD.id)::UUID;

  -- Tenant resolution: the tenants table carries its own id as the audit
  -- tenant; every other audited table carries tenant_id. Guarded per OP so
  -- DELETE (no NEW) and INSERT (no OLD) never touch an absent record field.
  IF TG_TABLE_NAME = 'tenants' THEN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      v_tenant_id := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
      v_tenant_id := OLD.id;
    END IF;
  ELSE
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_tenant_id := NEW.tenant_id;
    ELSIF TG_OP = 'DELETE' THEN
      v_tenant_id := OLD.tenant_id;
    END IF;
  END IF;

  IF v_tenant_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
    VALUES (
      v_tenant_id,
      auth.uid(),
      v_action,
      TG_TABLE_NAME,
      v_resource_id,
      jsonb_build_object('new', v_new, 'old', v_old, 'changed', v_changes)
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
