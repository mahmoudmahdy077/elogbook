-- TEMP diagnostic (service_role only): dump tenants-table triggers + their fn defs
CREATE OR REPLACE FUNCTION public.debug_wave2_introspect()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE out JSONB;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'trigger', t.tgname,
    'fn', p.proname,
    'def', pg_get_functiondef(p.oid)
  )) INTO out
  FROM pg_trigger t
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'tenants' AND NOT t.tgisinternal;
  RETURN out;
END $$;

REVOKE ALL ON FUNCTION public.debug_wave2_introspect() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debug_wave2_introspect() TO service_role;
