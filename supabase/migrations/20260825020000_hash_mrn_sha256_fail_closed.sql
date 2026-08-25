-- ============================================================================
-- 20260825020000_hash_mrn_sha256_fail_closed.sql
--
-- Swarm Wave-1 finding F3 (P2 privacy): hash_patient_mrn silently fell back
-- to UNSALTED-md5-style digest because pgcrypto lives in the `extensions`
-- schema, which is not on this function's search_path - so digest() raised
-- undefined_function and the EXCEPTION handler downgraded the hash. 32-hex
-- output observed live by the resident-workflow probe.
--
-- Fix: call extensions.digest() explicitly (schema-qualified) and FAIL CLOSED
-- if unavailable: a silent weak-hash downgrade is worse than a hard error.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hash_patient_mrn(
  p_mrn TEXT,
  p_tenant_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_salt TEXT;
BEGIN
  IF p_tenant_id <> get_tenant_id() THEN
    RAISE EXCEPTION 'cross-tenant hash rejected';
  END IF;

  SELECT mrn_hash_salt INTO v_salt FROM public.tenants WHERE id = p_tenant_id;
  IF v_salt IS NULL THEN
    RAISE EXCEPTION 'tenant has no MRN salt';
  END IF;

  -- Schema-qualified so search_path drift cannot silently downgrade to md5.
  RETURN encode(extensions.digest(p_mrn || ':' || v_salt, 'sha256'), 'hex');
END;
$$;
