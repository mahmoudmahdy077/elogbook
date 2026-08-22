-- Migration: Case Template Builder (NO-OP)
-- This migration was already partially applied. The unique index already exists.
-- Skipping to avoid conflicts with existing data.

-- Just update the comment
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_case_templates_name_specialty_unique') THEN
    COMMENT ON INDEX idx_case_templates_name_specialty_unique IS
      'Ensures unique template name+specialty per tenant for active templates';
  END IF;
END $$;
