-- 20261127000200_attachment_heic_mime.sql
--
-- The mobile app allows HEIC/HEIF (the iOS camera default) in its attachment
-- validator, but the bucket's allowed_mime_types list rejected it, so a photo
-- picked on an iPhone failed at upload. Accept the two Apple image types; the
-- existing size limit (20 MB) and private bucket are unchanged.
--
-- destructive: no — bucket MIME allow-list extended.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/heic', 'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv'
]
WHERE id = 'case-attachments';
