-- Migration: Case Template Builder
-- Adds unique index for template name+specialty within tenant

-- Partial unique index: prevents duplicate template names per specialty per tenant
-- Only applies to non-deleted templates
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_templates_name_specialty_unique
  ON case_templates (tenant_id, name, specialty)
  WHERE deleted_at IS NULL;

-- Comment for documentation
COMMENT ON INDEX idx_case_templates_name_specialty_unique IS
  'Ensures unique template name+specialty per tenant for active templates';
