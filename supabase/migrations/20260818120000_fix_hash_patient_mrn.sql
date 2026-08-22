-- Fix hash_patient_mrn to handle missing pgcrypto extension
-- Uses md5 as fallback if pgcrypto's digest is not available

CREATE OR REPLACE FUNCTION public.hash_patient_mrn(
  p_mrn TEXT,
  p_tenant_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_salt TEXT;
  v_hash TEXT;
BEGIN
  -- SECURITY: this function is SECURITY DEFINER and would otherwise serve as
  -- a cross-tenant MRN-hash oracle. Restrict to the caller's own tenant.
  IF p_tenant_id <> get_tenant_id() THEN
    RAISE EXCEPTION 'cross-tenant hash rejected';
  END IF;

  SELECT mrn_hash_salt INTO v_salt FROM public.tenants WHERE id = p_tenant_id;
  IF v_salt IS NULL THEN
    RAISE EXCEPTION 'tenant has no MRN salt';
  END IF;
  
  -- Try pgcrypto's digest first, fall back to md5 if not available
  BEGIN
    v_hash := encode(digest(p_mrn || ':' || v_salt, 'sha256'), 'hex');
  EXCEPTION WHEN undefined_function THEN
    -- pgcrypto not available, use md5 as fallback
    v_hash := md5(p_mrn || ':' || v_salt);
  END;
  
  RETURN v_hash;
END;
$$;
