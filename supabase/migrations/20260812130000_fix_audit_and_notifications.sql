-- 20260812130000_fix_audit_and_notifications.sql
-- S4: trg_audit_institutions fails every mutation (institutions has no
-- tenant_id, audit_logs.tenant_id is NOT NULL); audit_program_goals writes a
-- profiles.id into audit_logs.user_id (FK auth.users) and reads NEW on DELETE.
-- S5: notifications_insert_tenant allowed spoofing notifications for any user
-- in the caller's tenant.

-- institutions is platform-level data mutated by service_role/migrations only;
-- the generic audit trigger cannot represent it (no tenant_id). Drop it.
DROP TRIGGER IF EXISTS trg_audit_institutions ON public.institutions;

-- program_goals audit: map director profile to auth user id; use OLD on DELETE.
CREATE OR REPLACE FUNCTION audit_program_goals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
    VALUES (
      OLD.tenant_id,
      (SELECT user_id FROM public.profiles WHERE id = OLD.director_id LIMIT 1),
      'delete',
      'program_goal',
      OLD.id,
      '{}'::jsonb
    );
    RETURN OLD;
  END IF;

  INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes)
  VALUES (
    NEW.tenant_id,
    (SELECT user_id FROM public.profiles WHERE id = NEW.director_id LIMIT 1),
    TG_OP,
    'program_goal',
    NEW.id,
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_program_goals ON public.program_goals;
CREATE TRIGGER trg_audit_program_goals
  AFTER INSERT OR UPDATE OR DELETE ON public.program_goals
  FOR EACH ROW EXECUTE FUNCTION audit_program_goals();

-- notifications: only the target user or a supervisor+ of the same tenant
-- may create notification rows.
DROP POLICY IF EXISTS notifications_insert_tenant ON public.notifications;

CREATE POLICY notifications_insert_tenant ON public.notifications
  FOR INSERT
  WITH CHECK (
    tenant_id = get_tenant_id()
    AND (
      user_id = auth.uid()
      OR get_user_role() IN ('supervisor', 'director', 'institution_admin', 'admin')
    )
  );
