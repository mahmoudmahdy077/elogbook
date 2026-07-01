import { cache } from 'react';
import { createServerSupabase } from './server';

export type UserRole = 'resident' | 'supervisor' | 'director' | 'institution_admin' | 'admin';

export const MFA_REQUIRED_ROLES: ReadonlyArray<UserRole> = ['director', 'institution_admin', 'admin'];

export function isMfaRequiredForRole(role: UserRole): boolean {
  return MFA_REQUIRED_ROLES.includes(role);
}

export interface AuthResult {
  user: { id: string; email?: string };
  profile: {
    id: string;
    tenant_id: string;
    role: UserRole;
    full_name: string;
    specialty: string | null;
    onboarding_completed: boolean;
  };
  tenant: {
    id: string;
    slug: string;
    tenant_type: string;
  };
  subscription: {
    status: string;
    plan_id: string | null;
    current_period_end: string | null;
  } | null;
  aal: 'aal1' | 'aal2';
  mfaRequired: boolean;
}

export const getAuthContext = cache(async (): Promise<AuthResult> => {
  const supabase = await createServerSupabase();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('Not authenticated');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, full_name, specialty, onboarding_completed')
    .eq('user_id', user.id)
    .single();

  if (profileError || !profile) {
    throw new Error(`Profile not found: ${profileError?.message ?? 'unknown error'}`);
  }

  const [tenantResult, subscriptionResult, aalResult] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, slug, tenant_type')
      .eq('id', profile.tenant_id)
      .single(),
    supabase
      .from('subscriptions')
      .select('status, plan_id, current_period_end')
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  if (tenantResult.error || !tenantResult.data) {
    throw new Error(`Tenant not found: ${tenantResult.error?.message ?? 'unknown error'}`);
  }

  const tenant = tenantResult.data;
  const subscription = subscriptionResult.data;
  const role = profile.role as UserRole;
  const aal = (aalResult.data?.currentLevel === 'aal2' ? 'aal2' : 'aal1') as 'aal1' | 'aal2';

  return {
    user: { id: user.id, email: user.email },
    profile: {
      id: profile.id,
      tenant_id: profile.tenant_id,
      role,
      full_name: profile.full_name,
      specialty: profile.specialty,
      onboarding_completed: profile.onboarding_completed ?? false,
    },
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      tenant_type: tenant.tenant_type,
    },
    subscription: subscription
      ? { status: subscription.status, plan_id: subscription.plan_id, current_period_end: subscription.current_period_end }
      : null,
    aal,
    mfaRequired: isMfaRequiredForRole(role) && aal !== 'aal2',
  };
});

export function canAccessTenant(auth: AuthResult, requestedTenantSlug: string): boolean {
  // P4.8: global 'admin' no longer has automatic cross-tenant access.
  // Cross-tenant access now requires an explicit grant via the
  // admin_tenants join table (see migration 00064_admin_tenants.sql)
  // and an audit-logged re-authentication. For now, the only
  // tenant a profile can access is the one in their JWT.
  // (TODO P6.x: add the join table + admin tenant-switcher UI.)
  return auth.tenant.slug === requestedTenantSlug;
}