import { getAuthContext } from '@/lib/supabase/auth';
import { redirect } from 'next/navigation';

export default async function DashboardRedirectPage() {
  const auth = await getAuthContext();

  redirect(`/${auth.tenant.slug}/dashboard`);
}