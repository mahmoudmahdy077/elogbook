-- Seed: subscription plans and default case templates
-- Run after all schema migrations

-- Subscription plans
INSERT INTO subscription_plans (id, name, slug, price_monthly, features, tenant_type, max_residents)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Free', 'free', 0.00,
   '{"max_cases": 20, "ai": false, "pdf_export": false, "approval_workflow": false, "goal_tracking": false}',
   'individual', NULL)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO subscription_plans (id, name, slug, price_monthly, features, tenant_type, max_residents)
VALUES
  ('00000000-0000-0000-0000-000000000002', 'Individual Premium', 'individual-premium', 9.99,
   '{"ai": true, "pdf_export": true, "goal_tracking": true}',
   'individual', NULL)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO subscription_plans (id, name, slug, price_monthly, features, tenant_type, max_residents)
VALUES
  ('00000000-0000-0000-0000-000000000003', 'Institution Basic', 'institution-basic', 49.99,
   '{"pdf_export": true, "approval_workflow": true}',
   'institution', 10)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO subscription_plans (id, name, slug, price_monthly, features, tenant_type, max_residents)
VALUES
  ('00000000-0000-0000-0000-000000000004', 'Institution Pro', 'institution-pro', 149.99,
   '{"ai": true, "pdf_export": true, "approval_workflow": true, "goal_tracking": true, "audit_trail": true}',
   'institution', 50)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO subscription_plans (id, name, slug, price_monthly, features, tenant_type, max_residents)
VALUES
  ('00000000-0000-0000-0000-000000000005', 'Institution Enterprise', 'institution-enterprise', 0.00,
   '{"ai": true, "pdf_export": true, "approval_workflow": true, "goal_tracking": true, "audit_trail": true, "sso": true}',
   'institution', NULL)
ON CONFLICT (slug) DO NOTHING;

-- Global templates tenant
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
    {"key":"procedure_name","label":"Procedure Name","type":"text"},
    {"key":"anesthesia_type","label":"Anesthesia Type","type":"select","options":["General","Regional","Local","Sedation","None"]},
    {"key":"supervision_level","label":"Supervision Level","type":"select","options":["Observed","Assisted","Performed Under Supervision","Performed Independently"]},
    {"key":"complications","label":"Complications","type":"textarea"}
  ]'::JSONB,
  '["procedure_name","anesthesia_type","supervision_level"]'::JSONB
)
ON CONFLICT DO NOTHING;

-- Radiology template
INSERT INTO case_templates (id, tenant_id, specialty, name, fields, required_fields)
VALUES (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000000',
  'radiology',
  'Radiology Report Log',
  '[
    {"key":"modality","label":"Modality","type":"select","options":["X-Ray","CT","MRI","Ultrasound","Mammography","Nuclear Medicine"]},
    {"key":"body_part","label":"Body Part/Region","type":"text"},
    {"key":"findings","label":"Key Findings","type":"textarea"},
    {"key":"impression","label":"Impression/Diagnosis","type":"textarea"},
    {"key":"contrast_used","label":"Contrast Used","type":"select","options":["None","IV Contrast","Oral Contrast","Other"]}
  ]'::JSONB,
  '["modality","body_part","findings","impression"]'::JSONB
)
ON CONFLICT DO NOTHING;
