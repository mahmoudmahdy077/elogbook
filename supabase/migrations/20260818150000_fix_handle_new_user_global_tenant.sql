-- Fix handle_new_user to support global tenant and invites
-- New users without an invite are assigned to the global tenant
-- New users with an invite are assigned to the invited tenant

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_tenant_id UUID;
  new_profile_id UUID;
  role_text TEXT;
  invite_record RECORD;
  global_tenant_id UUID;
BEGIN
  role_text := COALESCE(NEW.raw_user_meta_data->>'role', 'resident');

  IF role_text NOT IN ('resident', 'supervisor') THEN
    role_text := 'resident';
  END IF;

  -- Check if user was invited to a specific tenant
  SELECT * INTO invite_record
  FROM tenant_invites
  WHERE email = NEW.email AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF invite_record IS NOT NULL THEN
    -- User was invited - assign to that tenant
    new_tenant_id := invite_record.tenant_id;
    
    -- Update invite status
    UPDATE tenant_invites
    SET status = 'accepted', accepted_at = NOW()
    WHERE id = invite_record.id;
    
    -- Use the role from the invite if specified
    IF invite_record.role IS NOT NULL THEN
      role_text := invite_record.role;
    END IF;
  ELSE
    -- No invite - assign to global tenant
    SELECT id INTO global_tenant_id
    FROM tenants
    WHERE slug = 'global-community'
    LIMIT 1;
    
    IF global_tenant_id IS NOT NULL THEN
      new_tenant_id := global_tenant_id;
    ELSE
      -- Fallback: create individual tenant if global tenant doesn't exist
      INSERT INTO tenants (name, slug, tenant_type, mrn_hash_salt)
      VALUES (NEW.email, 'user-' || NEW.id, 'individual', encode(extensions.gen_random_bytes(32), 'hex'))
      RETURNING id INTO new_tenant_id;
    END IF;
  END IF;

  INSERT INTO profiles (tenant_id, user_id, role, full_name)
  VALUES (
    new_tenant_id,
    NEW.id,
    role_text,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  RETURNING id INTO new_profile_id;

  UPDATE auth.users
  SET raw_app_meta_data = jsonb_build_object(
    'tenant_id', new_tenant_id,
    'user_role', role_text,
    'profile_id', new_profile_id
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
