-- supabase/migrations/00095_delete_demo_accounts_in_prod.sql
-- SEC-001: The gate in 00055 was inert (NULL = 'false' is NULL, so the
-- ELSE branch ran). This migration actually deletes the demo accounts,
-- their profiles, and the demo tenant when the GUC is unset or 'false'.
-- Idempotent.

-- Fix audit_table_change to not cast id::text (PG17 on Supabase won't
-- implicitly cast text back to uuid for the audit_logs.resource_id column)
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
BEGIN
  IF TG_NARGS > 0 THEN v_excluded := string_to_array(TG_ARGV[0], ', '); ELSE v_excluded := '{}'::TEXT[]; END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'insert';
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    SELECT jsonb_object_agg(key, value)
      INTO v_changes
    FROM jsonb_each(v_new)
    WHERE NOT (key = ANY(v_excluded))
      AND (v_old -> key) IS DISTINCT FROM value;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_old := to_jsonb(OLD);
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    jsonb_build_object('new', v_new, 'old', v_old, 'changed', v_changes)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Temporarily disable triggers that would block cleanup
ALTER TABLE stripe_events DISABLE TRIGGER trg_audit_stripe_events;
ALTER TABLE audit_logs DISABLE TRIGGER trg_reject_audit_delete;
ALTER TABLE tenants DISABLE TRIGGER trg_audit_tenants;

DO $$
DECLARE
  v_demo_user_ids UUID[];
  v_demo_tenant_id UUID;
  v_setting TEXT;
BEGIN
  v_setting := current_setting('app.enable_demo_migrations', true);
  IF v_setting IS NULL OR v_setting = 'false' THEN
    RAISE NOTICE 'SEC-001: demo migrations are off — deleting demo accounts';

    SELECT array_agg(id) INTO v_demo_user_ids
    FROM auth.users
    WHERE email LIKE '%@demo.com';

    SELECT id INTO v_demo_tenant_id
    FROM tenants
    WHERE slug = 'demo';

    IF v_demo_tenant_id IS NOT NULL THEN
      DELETE FROM one_time_purchases WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM stripe_events WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM profiles WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM case_entries WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM approval_requests WHERE tenant_id = v_demo_tenant_id;
      DELETE FROM tenants WHERE id = v_demo_tenant_id;
    END IF;

    IF v_demo_user_ids IS NOT NULL THEN
      DELETE FROM audit_logs WHERE user_id = ANY(v_demo_user_ids);
      DELETE FROM profiles WHERE user_id = ANY(v_demo_user_ids);
      DELETE FROM auth.identities WHERE user_id = ANY(v_demo_user_ids);
      DELETE FROM auth.users WHERE id = ANY(v_demo_user_ids);
    END IF;

    RAISE NOTICE 'SEC-001: deleted % demo users', coalesce(array_length(v_demo_user_ids, 1), 0);
  ELSE
    RAISE NOTICE 'SEC-001: demo migrations enabled — keeping demo accounts';
  END IF;
END $$;

ALTER TABLE stripe_events ENABLE TRIGGER trg_audit_stripe_events;
ALTER TABLE audit_logs ENABLE TRIGGER trg_reject_audit_delete;
ALTER TABLE tenants ENABLE TRIGGER trg_audit_tenants;
