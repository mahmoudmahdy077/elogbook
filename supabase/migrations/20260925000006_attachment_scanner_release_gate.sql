BEGIN;

ALTER TABLE public.attachment_security_config
  ADD COLUMN IF NOT EXISTS connector_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS scanner_connector_id TEXT,
  ADD COLUMN IF NOT EXISTS scanner_connector_revision TEXT,
  ADD COLUMN IF NOT EXISTS scanner_approval_reference TEXT,
  ADD COLUMN IF NOT EXISTS scanner_timeout_ms INTEGER NOT NULL DEFAULT 30000,
  ADD COLUMN IF NOT EXISTS max_scan_bytes BIGINT NOT NULL DEFAULT 10485760;

ALTER TABLE public.case_attachments
  ADD COLUMN IF NOT EXISTS scan_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scan_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scan_last_error_code TEXT;

UPDATE public.attachment_security_config
SET scanner_enabled = FALSE,
    connector_approved = FALSE,
    scanner_connector_id = NULL,
    scanner_connector_revision = NULL,
    scanner_approval_reference = NULL;

ALTER TABLE public.attachment_security_config
  DROP CONSTRAINT IF EXISTS attachment_security_config_vendor_required;

ALTER TABLE public.attachment_security_config
  ADD CONSTRAINT attachment_security_config_vendor_required
  CHECK (NOT scanner_enabled OR NULLIF(BTRIM(scanner_vendor), '') IS NOT NULL),
  ADD CONSTRAINT attachment_security_config_timeout_bounds
  CHECK (scanner_timeout_ms BETWEEN 1000 AND 120000),
  ADD CONSTRAINT attachment_security_config_size_bounds
  CHECK (max_scan_bytes BETWEEN 1 AND 10485760);

CREATE OR REPLACE FUNCTION public.validate_attachment_security_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  FORBIDDEN_CONNECTOR CONSTANT text := '^(pending|replace|replace_with.*|todo|placeholder|example|dummy|unknown|operator|local|test|fixture|changeme)$';
  FORBIDDEN_APPROVAL CONSTANT text := '^(pending|replace|replace_with.*|todo|placeholder|example|dummy|unknown|operator|local|test|fixture|changeme)$';
BEGIN
  IF NEW.scanner_enabled AND NOT NEW.connector_approved THEN
    RAISE EXCEPTION 'approved scanner connector is required'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.scanner_enabled AND (
    NULLIF(BTRIM(NEW.scanner_connector_id), '') IS NULL
    OR NEW.scanner_connector_id ~* FORBIDDEN_CONNECTOR
    OR NULLIF(BTRIM(NEW.scanner_connector_revision), '') IS NULL
    OR NEW.scanner_connector_revision ~* FORBIDDEN_CONNECTOR
  ) THEN
    RAISE EXCEPTION 'reviewed scanner connector is required'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.scanner_enabled AND (
    NULLIF(BTRIM(NEW.scanner_approval_reference), '') IS NULL
    OR NEW.scanner_approval_reference ~* FORBIDDEN_APPROVAL
  ) THEN
    RAISE EXCEPTION 'scanner approval evidence is required'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_attachment_security_config ON public.attachment_security_config;
CREATE TRIGGER validate_attachment_security_config
  BEFORE INSERT OR UPDATE ON public.attachment_security_config
  FOR EACH ROW EXECUTE FUNCTION public.validate_attachment_security_config();

CREATE OR REPLACE FUNCTION public.request_attachment_scan(p_attachment_id uuid)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  file_path text,
  file_size integer,
  scan_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service-role scanner context required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.case_attachments AS attachment
  SET malware_scan_status = 'pending',
      malware_scan_at = NULL,
      scan_attempts = attachment.scan_attempts + 1,
      scan_requested_at = clock_timestamp(),
      scan_last_error_code = NULL
  WHERE attachment.id = p_attachment_id
    AND attachment.malware_scan_status IN ('quarantined', 'pending', 'error')
  RETURNING
    attachment.id,
    attachment.tenant_id,
    attachment.file_path,
    attachment.file_size,
    attachment.scan_attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.request_attachment_scan(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_attachment_scan(uuid)
  TO service_role;

REVOKE UPDATE, DELETE, TRUNCATE
  ON public.attachment_security_config
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE UPDATE
  ON public.case_attachments
  FROM service_role;

GRANT SELECT
  ON public.attachment_security_config
  TO service_role;

COMMIT;
