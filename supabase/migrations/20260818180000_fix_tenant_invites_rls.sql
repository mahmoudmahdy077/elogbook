-- Fix tenant_invites RLS policy to not reference auth.users
-- The original policy references auth.users which is not accessible to authenticated role

-- Drop the old policy
DROP POLICY IF EXISTS "Users can view their own invites" ON tenant_invites;

-- Create new policy that uses profiles table instead
CREATE POLICY "Users can view their own invites"
  ON tenant_invites FOR SELECT
  TO authenticated
  USING (
    email = (SELECT email FROM profiles WHERE user_id = auth.uid())
  );
