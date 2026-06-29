import { createServerSupabase } from '@/lib/supabase/server';
import { safeRelativePath } from '@/lib/safe-redirect';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeRelativePath(searchParams.get('next'));

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (next !== '/') {
        return NextResponse.redirect(`${origin}${next}`);
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('user_id', user.id)
          .single();

        if (profile) {
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
