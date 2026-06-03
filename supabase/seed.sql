-- ============================================================================
-- Seed Data: Subscription Plans & Default Case Templates
-- ============================================================================

-- ============================================================================
-- Subscription Plans
-- ============================================================================

INSERT INTO subscription_plans (id, name, slug, price_monthly, features, tenant_type, max_residents)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'Free',
    'free',
    0.00,
    '{"max_cases": 20, "templates": "basic", "ai": false, "pdf_export": false, "approval_workflow": false, "goal_tracking": false, "audit_trail": false}',
    'individual',
    NULL
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'Individual Premium',
    'individual-premium',
    9.99,
    '{"max_cases": -1, "templates": "full", "ai": true, "pdf_export": true, "approval_workflow": false, "goal_tracking": true, "audit_trail": true}',
    'individual',
    NULL
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'Institution Basic',
    'institution-basic',
    49.99,
    '{"max_cases": -1, "templates": "full", "ai": false, "pdf_export": true, "approval_workflow": true, "goal_tracking": false, "audit_trail": false}',
    'institution',
    10
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    'Institution Pro',
    'institution-pro',
    149.99,
    '{"max_cases": -1, "templates": "custom", "ai": true, "pdf_export": true, "approval_workflow": true, "goal_tracking": true, "audit_trail": true}',
    'institution',
    50
  ),
  (
    '00000000-0000-0000-0000-000000000005',
    'Institution Enterprise',
    'institution-enterprise',
    0.00,
    '{"max_cases": -1, "templates": "custom", "ai": true, "pdf_export": true, "approval_workflow": true, "goal_tracking": true, "audit_trail": true, "sso": true, "dedicated_support": true, "baa": true}',
    'institution',
    NULL
  );

-- ============================================================================
-- Default Case Templates (global, no tenant — null tenant_id means global)
-- ============================================================================

-- Note: tenant_id is NOT NULL in the schema, so we alter temporarily for global templates
-- We'll use a special "global" tenant approach instead.

-- Global templates tenant (shared across all tenants for default templates)
INSERT INTO tenants (id, name, slug, tenant_type, settings)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'Global Templates',
  'global-templates',
  'institution',
  '{"system": true}'
) ON CONFLICT (slug) DO NOTHING;

-- Surgery template
INSERT INTO case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000000',
  'surgery',
  'General Surgery Log',
  '[
    {"name": "procedure_name", "label": "Procedure Name", "type": "text", "placeholder": "e.g. Appendectomy"},
    {"name": "anesthesia_type", "label": "Anesthesia Type", "type": "select", "options": ["General", "Regional", "Local", "Sedation", "None"]},
    {"name": "supervision_level", "label": "Supervision Level", "type": "select", "options": ["Observed", "Assisted", "Performed Under Supervision", "Performed Independently"]},
    {"name": "procedure_category", "label": "Category", "type": "select", "options": ["Elective", "Emergency", "Trauma"]},
    {"name": "complications", "label": "Complications", "type": "textarea", "placeholder": "Describe any complications or note None"},
    {"name": "outcome", "label": "Outcome", "type": "select", "options": ["Successful", "Complicated - Resolved", "Complicated - Ongoing", "Death"]},
    {"name": "duration_minutes", "label": "Duration (minutes)", "type": "number", "placeholder": "e.g. 90"},
    {"name": "assistant_name", "label": "Assistant/Supervisor Name", "type": "text", "placeholder": "Dr. Name"}
  ]'::JSONB,
  '["procedure_name", "anesthesia_type", "supervision_level"]'::JSONB
) ON CONFLICT DO NOTHING;

-- Radiology template
INSERT INTO case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000000',
  'radiology',
  'Radiology Report Log',
  '[
    {"name": "modality", "label": "Modality", "type": "select", "options": ["X-Ray", "CT", "MRI", "Ultrasound", "Mammography", "Nuclear Medicine", "Fluoroscopy", "Angiography", "PET-CT"]},
    {"name": "body_part", "label": "Body Part/Region", "type": "text", "placeholder": "e.g. Chest, Abdomen, Brain"},
    {"name": "clinical_indication", "label": "Clinical Indication", "type": "textarea", "placeholder": "Reason for imaging study"},
    {"name": "findings", "label": "Key Findings", "type": "textarea", "placeholder": "Describe radiological findings"},
    {"name": "impression", "label": "Impression/Diagnosis", "type": "textarea", "placeholder": "Primary impression and differential diagnoses"},
    {"name": "contrast_used", "label": "Contrast Used", "type": "select", "options": ["None", "IV Contrast", "Oral Contrast", "Rectal Contrast", "Other"]},
    {"name": "comparison_studies", "label": "Comparison Studies", "type": "text", "placeholder": "Date or accession of prior studies"},
    {"name": "urgency", "label": "Urgency", "type": "select", "options": ["Routine", "Urgent", "STAT"]}
  ]'::JSONB,
  '["modality", "body_part", "findings", "impression"]'::JSONB
) ON CONFLICT DO NOTHING;
