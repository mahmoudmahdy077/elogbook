// ADMIN-001: shared tenant admin guard
import type { SupabaseClient } from '@supabase/supabase-js';

export async function requireTenantAdmin(
  supabase: SupabaseClient,
  tenantSlug: string,
  allowedRoles: string[] = ['institution_admin', 'admin'],
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, error: 'Unauthorized', status: 401 as const };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, user_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return { ok: false as const, error: 'Profile not found', status: 403 as const };
  }

  const tenant = (profile as unknown as { tenants: unknown }).tenants as unknown as
    | { slug: string }
    | { slug: string }[];
  const slug = Array.isArray(tenant)
    ? (tenant as { slug: string }[])[0]?.slug
    : (tenant as { slug: string } | null)?.slug;
  if (slug !== tenantSlug) {
    return { ok: false as const, error: 'Tenant mismatch', status: 403 as const };
  }

  if (!allowedRoles.includes(profile.role)) {
    return { ok: false as const, error: 'Insufficient permissions', status: 403 as const };
  }

  return { ok: true as const, profile, user };
}
