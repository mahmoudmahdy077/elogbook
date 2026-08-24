-- Fix audit trigger for tenant creation
-- The audit_table_change function fails when inserting tenants because
-- tenants don't have a tenant_id column. Fix by using NEW.id for tenant inserts.

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
    SELECT jsonb_object_agg(key, value)
      INTO v_changes
    FROM jsonb_each(v_new)
    WHERE NOT (key = ANY(v_excluded))
      AND (v_old -> key) IS DISTINCT FROM value;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_old := to_jsonb(OLD);
  END IF;

  -- Handle tenant_id: use NEW.id for tenant table inserts, otherwise use NEW.tenant_id
  IF TG_TABLE_NAME = 'tenants' AND TG_OP = 'INSERT' THEN
    v_tenant_id := NEW.id;
  ELSE
    v_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
  END IF;

  -- Only insert if we have a valid tenant_id
  IF v_tenant_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
    VALUES (
      v_tenant_id,
      auth.uid(),
      v_action,
      TG_TABLE_NAME,
      COALESCE(NEW.id, OLD.id),
      jsonb_build_object('new', v_new, 'old', v_old, 'changed', v_changes)
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;
