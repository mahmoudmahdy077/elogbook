import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/lib/supabase/admin';

/**
 * Platform operator guard (T17).
 *
 * Authority comes ONLY from the `platform_admins` registry — a tenant
 * `admin`/`institution_admin` label confers no host permission. Checks,
 * in order: live session, active home profile (any tenant), active
 * registry row (via service-role; RLS denies direct reads), AAL2 with an
 * enrolled factor (fail closed; DISABLE_MFA=true bypasses for local dev
 * only, mirroring auth.ts P6.1).
 *
 * Server-side only: imports the service-role client. Never import from
 * client components or the mobile app.
 */
export async function requirePlatformAdmin(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, error: 'Unauthorized', status: 401 as const };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, status')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile as { status?: string | null }).status !== 'active') {
    return { ok: false as const, error: 'Account is not active', status: 403 as const };
  }

  const adminClient = createServiceRoleClient();
  const { data: operator } = await adminClient
    .from('platform_admins')
    .select('user_id, status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!operator || (operator as { status?: string | null }).status !== 'active') {
    return { ok: false as const, error: 'Platform access required', status: 403 as const };
  }

  if (process.env.DISABLE_MFA !== 'true') {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const aal = (session as { aal?: string } | null)?.aal ?? null;
    let verifiedFactors = false;
    try {
      const { data: mfaData } = await supabase.auth.mfa.listFactors();
      verifiedFactors = mfaData?.all?.some((f) => f.status === 'verified') ?? false;
    } catch {
      // MFA service unavailable: fail closed below (no factors proven).
      verifiedFactors = false;
    }
    if (!verifiedFactors) {
      return { ok: false as const, error: 'MFA enrollment required for platform access', status: 403 as const };
    }
    if (aal !== 'aal2') {
      return { ok: false as const, error: 'Re-authentication with MFA required', status: 403 as const };
    }
  }

  return { ok: true as const, operator, user, profile };
}
