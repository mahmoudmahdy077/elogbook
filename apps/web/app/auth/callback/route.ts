import { createServerSupabase } from '@/lib/supabase/server';
import { safeRelativePath } from '@/lib/safe-redirect';
import { getServerVerifiedAal } from '@/lib/supabase/security-context';
import { isMfaRequiredForRole, type UserRole } from '@/lib/supabase/auth';
import { NextResponse } from 'next/server';

const DEFAULT_APP_ORIGIN = 'http://localhost:3000';

function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return DEFAULT_APP_ORIGIN;
  try {
    const url = new URL(configured);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
  return DEFAULT_APP_ORIGIN;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = appOrigin();
  const code = searchParams.get('code');
  const next = safeRelativePath(searchParams.get('next'));

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id, role, status, pending_role')
          .eq('user_id', user.id)
          .single();

        if (profile) {
          const { data: { session } } = await supabase.auth.getSession();
          const aal = await getServerVerifiedAal(supabase, session);
          const requiresPromotion = profile.status === 'pending'
            && typeof profile.pending_role === 'string'
            && profile.pending_role !== 'resident';
          if ((isMfaRequiredForRole(profile.role as UserRole) || requiresPromotion) && aal !== 'aal2') {
            return NextResponse.redirect(`${origin}/mfa/verify?next=${encodeURIComponent(next === '/' ? '/onboarding' : next)}`);
          }
          if (requiresPromotion && aal === 'aal2') {
            const promotion = await supabase.rpc('promote_pending_profile');
            const promotionSucceeded = (promotion.data as { success?: boolean } | null)?.success === true;
            if (promotion.error || !promotionSucceeded) {
              return NextResponse.redirect(`${origin}/login?error=promotion_failed`);
            }
          }

          if (next !== '/') {
            return NextResponse.redirect(`${origin}${next}`);
          }

          const { data: tenant } = await supabase
            .from('tenants')
            .select('slug')
            .eq('id', profile.tenant_id)
            .single();
          const slug = tenant?.slug ?? 'default';
          return NextResponse.redirect(`${origin}/${slug}/dashboard`);
        }
      }

      return NextResponse.redirect(`${origin}/dashboard`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
