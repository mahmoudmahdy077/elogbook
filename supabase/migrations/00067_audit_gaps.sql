-- Migration 00067: Audit triggers for goals, templates, profile updates

-- Trigger for program_goals changes
CREATE OR REPLACE FUNCTION audit_program_goals()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    NEW.tenant_id,
    NEW.director_id,
    CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE TG_OP END,
    'program_goal',
    NEW.id,
    CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_program_goals ON program_goals;
CREATE TRIGGER trg_audit_program_goals
  AFTER INSERT OR UPDATE OR DELETE ON program_goals
  FOR EACH ROW EXECUTE FUNCTION audit_program_goals();

-- Trigger for case_templates changes
CREATE OR REPLACE FUNCTION audit_case_templates()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    NEW.tenant_id,
    (SELECT user_id FROM profiles WHERE id = NEW.created_by),
    CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE TG_OP END,
    'case_template',
    NEW.id,
    CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_case_templates ON case_templates;
CREATE TRIGGER trg_audit_case_templates
  AFTER INSERT OR UPDATE OR DELETE ON case_templates
  FOR EACH ROW EXECUTE FUNCTION audit_case_templates();

-- Trigger for profile role changes
CREATE OR REPLACE FUNCTION audit_profile_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
    VALUES (
      COALESCE(NEW.tenant_id, OLD.tenant_id),
      NEW.user_id,
      'update',
      'profile',
      NEW.id,
      jsonb_build_object('old_role', OLD.role, 'new_role', NEW.role)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_profile ON profiles;
CREATE TRIGGER trg_audit_profile
  AFTER UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION audit_profile_changes();

-- Down migration:
-- DROP TRIGGER IF EXISTS trg_audit_program_goals ON program_goals;
-- DROP TRIGGER IF EXISTS trg_audit_case_templates ON case_templates;
-- DROP TRIGGER IF EXISTS trg_audit_profile ON profiles;
-- DROP FUNCTION IF EXISTS audit_program_goals();
-- DROP FUNCTION IF EXISTS audit_case_templates();
-- DROP FUNCTION IF EXISTS audit_profile_changes();