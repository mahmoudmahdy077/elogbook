import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, tenants(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenantSlug = (profile.tenants as any)?.slug;

  if (tenantSlug) {
    redirect(`/${tenantSlug}/dashboard`);
  }

  return null;
}
