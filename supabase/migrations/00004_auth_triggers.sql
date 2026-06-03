-- Auto-create profile + tenant on first signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_tenant_id UUID;
  role_text TEXT;
BEGIN
  role_text := COALESCE(NEW.raw_user_meta_data->>'role', 'resident');

  -- Create personal tenant for the user
  INSERT INTO tenants (name, slug, tenant_type)
  VALUES (NEW.email, 'user-' || NEW.id, 'individual')
  RETURNING id INTO new_tenant_id;

  -- Create profile
  INSERT INTO profiles (tenant_id, user_id, role, full_name)
  VALUES (
    new_tenant_id,
    NEW.id,
    role_text,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );

  -- Set tenant_id and role in JWT claims
  UPDATE auth.users
  SET raw_app_meta_data = jsonb_build_object(
    'tenant_id', new_tenant_id,
    'user_role', role_text
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
