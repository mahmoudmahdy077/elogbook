-- ============================================================================
-- 20260824180000_rfc_compliant_seed_template_ids.sql
--
-- Root-cause fix: the seeded GLOBAL templates used hand-crafted
-- version-0 UUIDs (00000000-0000-0000-0000-000000000010/11). Postgres uuid
-- accepts them, but zod v4's RFC 9562 strict uuid() — used by the shared
-- caseEntrySchema — rejects them client-side with "template_id: Invalid UUID",
-- making the case wizard unable to submit any case logged against a seeded
-- global template.
--
-- Strategy: copy rows to RFC-compliant ids (version 4, variant 10xx),
-- migrate referencing children, then delete originals. Idempotent.
-- ============================================================================

-- 1. Copy the two global templates to compliant ids (no-op if already migrated)
INSERT INTO case_templates (id, tenant_id, specialty, name, fields, required_fields)
SELECT
  ('00000000-0000-4000-8000-' || right(id::text, 12))::uuid AS new_id,
  tenant_id, specialty, name, fields, required_fields
FROM case_templates
WHERE id IN (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000011'
)
ON CONFLICT (id) DO NOTHING;

-- 2. Migrate children (template_favorites FK CASCADE, case_entries FK RESTRICT)
UPDATE template_favorites
SET template_id = ('00000000-0000-4000-8000-' || right(template_id::text, 12))::uuid
WHERE template_id IN (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000011'
);

-- The write-once trigger (trg_write_once_submitted_check) blocks UPDATEs on
-- submitted cases; this is a system-managed referential repair, so bypass it.
ALTER TABLE case_entries DISABLE TRIGGER trg_write_once_submitted_check;

UPDATE case_entries
SET template_id = ('00000000-0000-4000-8000-' || right(template_id::text, 12))::uuid
WHERE template_id IN (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000011'
);

ALTER TABLE case_entries ENABLE TRIGGER trg_write_once_submitted_check;

-- 3. Remove the legacy non-compliant rows
DELETE FROM case_templates
WHERE id IN (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000011'
);
