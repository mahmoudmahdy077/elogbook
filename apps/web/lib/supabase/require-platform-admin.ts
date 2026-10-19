import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { getServerVerifiedAal } from './security-context';

/**
 * Platform operator guard (T17).
 *
 * Authority comes ONLY from the `platform_admins` registry — a tenant
 * `admin`/`institution_admin` label confers no host permission. Checks,
 * in order: live session, active home profile (any tenant), active
 * registry row (via service-role; RLS denies direct reads), then MFA.
 *
 * MFA is required: an enrolled, verified factor plus server-verified AAL2. The
 * `DISABLE_MFA=true` development bypass is honoured only outside production and
 * only outside setup mode, and it logs `platform_admin.mfa_bypassed` every time
 * it is taken so the weakened control is never silent.
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
    .from('profiles') // tenant-scope-exempt: user-scoped lookup by user_id (1:1), not tenant list — owner=human expiry=2026-12-31
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

  // The bypass exists for local development only. It is refused outright while
  // the instance is in setup mode, because setup mode is the one state in which
  // the control plane is reachable and unowned: an operator who set both flags
  // would otherwise reach backup/restore/uninstall with no verified factor.
  if (process.env.SETUP_MODE === 'true') {
    return { ok: false as const, error: 'Platform access is unavailable during setup', status: 403 as const };
  }

  const mfaDisabledForNonProduction =
    process.env.NODE_ENV !== 'production' && process.env.DISABLE_MFA === 'true';

  if (mfaDisabledForNonProduction) {
    // Never silent: the bypass weakens exactly the control that makes this
    // endpoint safe, and it is reachable wherever the control plane is.
    logger.warn('platform_admin.mfa_bypassed', {
      userId: user.id,
      nodeEnv: process.env.NODE_ENV ?? 'unset',
    });
  } else {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user?.id && session.user.id !== user.id) {
      return { ok: false as const, error: 'Session identity mismatch', status: 401 as const };
    }
    const aal = await getServerVerifiedAal(supabase, session);
    let verifiedFactors = false;
    try {
      const { data: mfaData } = await supabase.auth.mfa.listFactors();
      verifiedFactors = mfaData?.all?.some((f) => f.status === 'verified') ?? false;
    } catch {
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
