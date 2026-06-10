import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');
  return <>{children}</>;
}
