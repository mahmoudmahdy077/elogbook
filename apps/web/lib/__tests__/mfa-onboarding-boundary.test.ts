import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd(), '..', '..');
const readIfPresent = (relativePath: string) => {
  const path = resolve(repoRoot, relativePath);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};
const inviteRoute = readFileSync(
  resolve(repoRoot, 'apps/web/app/api/[tenant]/admin/invite/route.ts'),
  'utf8',
);
const invitationAcceptRoute = readFileSync(
  resolve(repoRoot, 'apps/web/app/api/invitations/accept/route.ts'),
  'utf8',
);
const setupRoute = readFileSync(
  resolve(repoRoot, 'apps/web/app/api/setup/create-admin/route.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(repoRoot, 'supabase/migrations/20260925000002_pending_profile_mfa_promotion.sql'),
  'utf8',
);
const profileAdminMigration = readIfPresent(
  'supabase/migrations/20260925000005_profile_admin_rpcs.sql',
);
const invitationMigration = readIfPresent(
  'supabase/migrations/20260926000006_invitation_signup_boundary.sql',
);
const callback = readFileSync(resolve(repoRoot, 'apps/web/app/auth/callback/route.ts'), 'utf8');
const mfaEnroll = readFileSync(resolve(repoRoot, 'apps/web/app/mfa/enroll/page.tsx'), 'utf8');
const mfaVerify = readFileSync(resolve(repoRoot, 'apps/web/app/mfa/verify/page.tsx'), 'utf8');
const promotionHelper = readIfPresent('apps/web/lib/supabase/profile-promotion.ts');
const assignRoleRoute = readFileSync(
  resolve(repoRoot, 'apps/web/app/api/[tenant]/admin/assign-role/route.ts'),
  'utf8',
);
const userRoute = readFileSync(
  resolve(repoRoot, 'apps/web/app/api/[tenant]/admin/users/[id]/route.ts'),
  'utf8',
);
const userActionRoute = readFileSync(
  resolve(repoRoot, 'apps/web/app/api/[tenant]/admin/users/[id]/action/route.ts'),
  'utf8',
);
const authContext = readFileSync(resolve(repoRoot, 'apps/web/lib/supabase/auth.ts'), 'utf8');

describe('MFA onboarding boundary', () => {
  it('creates a usable auth invite without returning credentials or tokens', () => {
    // The identity is created on redemption, not at invite time: the admin
    // route mints a token and queues the link, POST /api/invitations/accept
    // creates the identity once the token is presented.
    expect(invitationAcceptRoute).toContain('inviteUserByEmail');
    expect(invitationAcceptRoute).toContain('redirectTo');
    expect(inviteRoute).not.toContain('inviteUserByEmail');
    // The setup wizard is the one path that legitimately creates an identity
    // outright; the tenant invitation routes must not.
    for (const source of [inviteRoute, invitationAcceptRoute]) {
      expect(source).not.toContain('auth.admin.createUser');
      expect(source).not.toMatch(/return NextResponse\.json\(\{[^}]*\b(userId|queued|token|password|access_token|refresh_token)\b/);
    }
    expect(setupRoute).toContain('auth.admin.createUser');
  });

  it('does not create a second profile after auth user creation', () => {
    for (const source of [inviteRoute, setupRoute, invitationAcceptRoute]) {
      expect(source).not.toContain(".from('profiles').insert");
    }
    expect(setupRoute).toContain('pending_role');
    expect(invitationMigration).toContain('pending_role');
  });

  it('deletes the auth user when a partially created identity must be undone', () => {
    // The admin route no longer creates an identity, so the only rollback left
    // on the invitation path is the redemption route's partial-failure unwind.
    expect(invitationAcceptRoute).toContain('auth.admin.deleteUser');
    expect(setupRoute).toContain('auth.admin.deleteUser');
    expect(inviteRoute).toContain("from('tenant_invites')");
    expect(inviteRoute).toContain('.delete()');
  });

  it('promotes only pending profiles after the MFA verification boundary', () => {
    expect(callback).toContain('promote_pending_profile');
    expect(mfaEnroll).toContain('promotePendingProfileIfNeeded');
    expect(mfaVerify).toContain('promotePendingProfileIfNeeded');
    expect(mfaEnroll).not.toContain("const promotion = await supabase.rpc('promote_pending_profile')");
    expect(mfaVerify).not.toContain("const promotion = await supabase.rpc('promote_pending_profile')");
    expect(promotionHelper).toContain("profile.status === 'active'");
    expect(promotionHelper).toContain("profile.status === 'pending'");
    expect(promotionHelper).toContain('promote_pending_profile');
    expect(authContext).toContain("process.env.NODE_ENV === 'production' || process.env.DISABLE_MFA !== 'true'");
    expect(migration).toContain('pending_role');
    expect(migration).toContain("status = 'pending'");
    expect(migration).toContain('promote_pending_profile');
    expect(migration).toContain('has_aal2()');
    expect(migration).toContain('role = \'resident\'');
    expect(migration).toContain('protect_tenant_invite_authority');
    expect(migration).toContain("NEW.role IN ('institution_admin', 'admin')");
  });

  it('does not trust user metadata for tenant or privileged role assignment', () => {
    expect(migration).toContain("v_requested_role := 'resident'");
    expect(migration).not.toContain("NEW.raw_user_meta_data->>'tenant_id'");
    expect(migration).toMatch(/WHERE\s+LOWER\(invite\.email\)\s*=\s*LOWER\(NEW\.email\)/);
  });

  it('creates a pending invite before privileged auth user creation', () => {
    expect(inviteRoute).toMatch(/\.from\('tenant_invites'\)[\s\S]*?\.insert\(/);
    expect(setupRoute).toMatch(/INSERT INTO public\.tenant_invites[\s\S]*?RETURNING id/);
    expect(inviteRoute).not.toMatch(/user_metadata:\s*\{[^}]*\brole\s*:/);
    expect(setupRoute).not.toMatch(/user_metadata:\s*\{[^}]*\brole\s*:/);
  });
});

describe('authenticated profile administration boundary', () => {
  it('uses authenticated RPCs for profile, role, and status mutations', () => {
    expect(assignRoleRoute).toContain("rpc('admin_assign_role'");
    expect(userRoute).toContain("rpc('admin_update_profile'");
    expect(userActionRoute).toContain("rpc('admin_set_profile_status'");
    expect(assignRoleRoute).not.toMatch(/adminClient[\s\S]{0,500}\.from\('profiles'\)[\s\S]{0,500}\.update\(/);
    expect(userRoute).not.toMatch(/adminClient[\s\S]{0,500}\.from\('profiles'\)[\s\S]{0,500}\.update\(/);
    expect(userActionRoute).not.toMatch(/adminClient[\s\S]{0,500}\.from\('profiles'\)[\s\S]{0,500}\.update\(/);
  });

  it('defines AAL2, tenant-scoped, last-admin-protected RPCs', () => {
    expect(profileAdminMigration).toContain('SECURITY DEFINER');
    expect(profileAdminMigration).toContain('admin_update_profile');
    expect(profileAdminMigration).toContain('admin_delete_profile');
    expect(profileAdminMigration).toContain('get_authoritative_principal_with_aal');
    expect(profileAdminMigration).toContain("v_principal.aal IS DISTINCT FROM 'aal2'");
    expect(profileAdminMigration).toContain('FOR UPDATE');
    expect(profileAdminMigration).toContain('institution_admin');
    expect(profileAdminMigration).not.toMatch(/service_role[\s\S]{0,180}has_aal2/);
  });

  it('keeps mutation errors and audit payloads generic', () => {
    for (const source of [assignRoleRoute, userRoute, userActionRoute]) {
      expect(source).not.toContain('error.message');
      expect(source).not.toContain('changes: updates');
      expect(source).not.toContain('full_name: full_name');
      expect(source).not.toContain('specialty: specialty');
    }
  });
});
