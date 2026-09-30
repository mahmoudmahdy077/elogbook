BEGIN;

LOCK TABLE public.case_attachments IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.case_attachments
  ADD COLUMN IF NOT EXISTS quarantine_entered_at TIMESTAMPTZ;

UPDATE public.case_attachments
SET quarantine_entered_at = COALESCE(uploaded_at, NOW())
WHERE quarantine_entered_at IS NULL;

ALTER TABLE public.case_attachments
  ALTER COLUMN quarantine_entered_at SET DEFAULT NOW(),
  ALTER COLUMN quarantine_entered_at SET NOT NULL,
  ALTER COLUMN malware_scan_status SET DEFAULT 'quarantined';

UPDATE public.case_attachments
SET malware_scan_status = 'quarantined',
    malware_scan_at = NULL
WHERE malware_scan_status = 'clean';

UPDATE public.case_attachments
SET malware_scan_status = 'quarantined'
WHERE malware_scan_status IS NULL
   OR malware_scan_status NOT IN (
     'quarantined',
     'pending',
     'scanning',
     'clean',
     'infected',
     'error'
   );

ALTER TABLE public.case_attachments
  ALTER COLUMN malware_scan_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.case_attachments'::regclass
      AND conname = 'case_attachments_malware_scan_status_check'
  ) THEN
    ALTER TABLE public.case_attachments
      ADD CONSTRAINT case_attachments_malware_scan_status_check
      CHECK (
        malware_scan_status IN (
          'quarantined',
          'pending',
          'scanning',
          'clean',
          'infected',
          'error'
        )
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.case_attachments
  VALIDATE CONSTRAINT case_attachments_malware_scan_status_check;

CREATE TABLE IF NOT EXISTS public.attachment_security_config (
  id SMALLINT PRIMARY KEY DEFAULT 1,
  scanner_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  scanner_vendor TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attachment_security_config_singleton CHECK (id = 1),
  CONSTRAINT attachment_security_config_vendor_required
    CHECK (NOT scanner_enabled OR NULLIF(BTRIM(scanner_vendor), '') IS NOT NULL)
);

INSERT INTO public.attachment_security_config (id, scanner_enabled)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.attachment_security_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachment_security_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.attachment_security_config FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.attachment_security_config TO service_role;

ALTER TABLE public.case_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_attachments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read case attachments" ON public.case_attachments;
DROP POLICY IF EXISTS "Residents insert own case attachments" ON public.case_attachments;
DROP POLICY IF EXISTS "Residents delete own case attachments" ON public.case_attachments;
DROP POLICY IF EXISTS "Supervisor+ delete case attachments in tenant" ON public.case_attachments;

CREATE POLICY "Clean attachment owners and roles read case attachments"
  ON public.case_attachments
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = get_tenant_id()
    AND malware_scan_status = 'clean'
    AND (
      uploaded_by = (
        SELECT profile.id
        FROM public.profiles AS profile
        WHERE profile.user_id = auth.uid()
        LIMIT 1
      )
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.case_attachments
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.case_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_attachments TO service_role;

CREATE INDEX IF NOT EXISTS case_attachments_tenant_entry_idx
  ON public.case_attachments (tenant_id, entry_id);

CREATE OR REPLACE FUNCTION public.enforce_case_attachment_upload_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.tenant_id::TEXT || ':' || NEW.entry_id::TEXT, 0)
  );

  IF (
    SELECT count(*)
    FROM public.case_attachments
    WHERE tenant_id = NEW.tenant_id
      AND entry_id = NEW.entry_id
  ) >= 20 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'case attachment count limit exceeded';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_case_attachment_upload_limit()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_case_attachment_upload_limit
  ON public.case_attachments;

CREATE TRIGGER enforce_case_attachment_upload_limit
  BEFORE INSERT ON public.case_attachments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_case_attachment_upload_limit();

DROP POLICY IF EXISTS "tenant attachment access" ON storage.objects;
DROP POLICY IF EXISTS "case_att_select_tenant_folder" ON storage.objects;
DROP POLICY IF EXISTS "case_att_insert_tenant_folder" ON storage.objects;
DROP POLICY IF EXISTS "case_att_update_tenant_folder" ON storage.objects;
DROP POLICY IF EXISTS "case_att_delete_tenant_folder" ON storage.objects;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON storage.objects
  FROM PUBLIC, anon, authenticated;

COMMIT;
