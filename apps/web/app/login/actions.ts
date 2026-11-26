'use server';

import { createServerSupabase } from '@/lib/supabase/server';

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
      // Never echo GoTrue's text: "Email not confirmed" vs "Invalid login
      // credentials" tells an attacker whether an account exists.
      return { error: 'Invalid email or password.' };
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('tenants!inner(slug)')
      .eq('user_id', data.user.id)
      .single();

    const tenants = profile?.tenants as { slug: string }[] | null;
    const slug = tenants?.[0]?.slug ?? 'demo';

    return { redirectUrl: `/${slug}/dashboard` };
  } catch (err) {
    console.error('[loginAction] Error:', err);
    return { error: 'Sign-in is temporarily unavailable. Try again.' };
  }
}
