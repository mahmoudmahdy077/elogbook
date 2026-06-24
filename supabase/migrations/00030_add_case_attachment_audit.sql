-- Migration 00030: Add audit columns to case_attachments for HIPAA compliance
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE case_attachments ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES profiles(id);

-- Backfill from existing data
UPDATE case_attachments
  SET file_name = SPLIT_PART(file_path, '/', array_length(string_to_array(file_path, '/'), 1)),
      uploaded_by = ce.resident_id
  FROM case_entries ce
  WHERE case_attachments.entry_id = ce.id;
