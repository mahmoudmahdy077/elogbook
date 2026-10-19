'use server';

import { createServerSupabase } from '@/lib/supabase/server';
import { getServerVerifiedAal } from '@/lib/supabase/security-context';
import { logger } from '@/lib/logger';

export async function loginAction(email: string, password: string) {
  if (!email || !password) {
    return { error: 'Email and password are required' };
  }

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { error: error.message };
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, tenant_id, role, status, pending_role')
      .eq('user_id', data.user.id)
      .single();
    if (profileError || !profile) {
      return { error: 'Account profile is not available.' };
    }

    const { data: { session } } = await supabase.auth.getSession();
    const aal = await getServerVerifiedAal(supabase, session);
    const requiresPromotion = profile.status === 'pending'
      && typeof profile.pending_role === 'string'
      && profile.pending_role !== 'resident';
    if (requiresPromotion && aal !== 'aal2') {
      return { redirectUrl: '/mfa/verify?next=/onboarding' };
    }
    if (requiresPromotion && aal === 'aal2') {
      const promotion = await supabase.rpc('promote_pending_profile');
      const promotionSucceeded = (promotion.data as { success?: boolean } | null)?.success === true;
      if (promotion.error || !promotionSucceeded) return { error: 'Account promotion failed. Please retry.' };
    }

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('slug,status')
      .eq('id', profile.tenant_id)
      .single();
    if (tenantError || !tenant?.slug || tenant.status !== 'active') {
      return { error: 'Account is not assigned to an active tenant.' };
    }

    return { redirectUrl: `/${tenant.slug}/dashboard` };
  } catch (err) {
    logger.error('Login action failed', err);
    return { error: 'Login failed' };
  }
}
