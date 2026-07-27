-- P1.2: Attachment lifecycle hardening

-- Add MIME signature validation and size limits
ALTER TABLE public.case_attachments
  ADD COLUMN IF NOT EXISTS mime_signature TEXT,
  ADD COLUMN IF NOT EXISTS malware_scan_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS malware_scan_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retention_until TIMESTAMPTZ;

-- Create storage bucket for attachments if not exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'case-attachments',
  'case-attachments',
  false,
  20971520,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv'
  ]
) ON CONFLICT (id) DO UPDATE SET
  file_size_limit = 20971520,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  public = false;

-- Storage bucket RLS policy: tenant-scoped access
CREATE POLICY "tenant attachment access"
  ON storage.objects FOR ALL
  TO authenticated
  USING (bucket_id = 'case-attachments' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'case-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Revoke public access to attachment bucket
REVOKE ALL ON storage.objects FROM anon;
