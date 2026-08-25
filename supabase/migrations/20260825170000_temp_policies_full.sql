-- TEMP: return full policy rows (incl. permissive flag + roles) for case_entries
CREATE OR REPLACE FUNCTION public.debug_policies_full()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE out JSONB;
BEGIN
  SELECT jsonb_agg(to_jsonb(p)) INTO out
  FROM (
    SELECT policyname, cmd, roles, permissive, qual, with_check
    FROM pg_policies
    WHERE schemaname='public' AND tablename='case_entries'
    ORDER BY policyname
  ) p;
  RETURN out;
END $$;

REVOKE ALL ON FUNCTION public.debug_policies_full() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debug_policies_full() TO service_role;
