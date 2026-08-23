-- ============================================================================
-- FIX: audit_table_change() wrote TEXT into audit_logs.resource_id (UUID)
--
-- The generic audit trigger inserted `COALESCE(NEW.id::text, OLD.id::text)`
-- into audit_logs.resource_id, which is UUID NOT NULL. Every row change on
-- any table guarded by this trigger (approval_requests, profiles, tenants,
-- subscriptions, payments, consent_records, ...) aborted with:
--   42804: column "resource_id" is of type uuid but expression is of type text
--
-- That silently killed the entire approve/reject workflow (the approval
-- insert itself fails), plus consent recording and any other audited write.
--
-- FIX: preserve the native uuid type — `COALESCE(NEW.id, OLD.id)` — and cast
-- to uuid defensively for any audited table whose PK might be text.
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

  -- Preserve native uuid type (was ::text → 42804 against audit_logs.resource_id)
  v_resource_id := COALESCE(NEW.id, OLD.id)::UUID;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    COALESCE(NEW.tenant_id, OLD.tenant_id),
    auth.uid(),
    v_action,
    TG_TABLE_NAME,
    v_resource_id,
    jsonb_build_object('new', v_new, 'old', v_old, 'changed', v_changes)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;
