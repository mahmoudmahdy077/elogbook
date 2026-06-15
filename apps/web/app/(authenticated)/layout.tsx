import { getAuthContext } from '@/lib/supabase/auth';
import { redirect } from 'next/navigation';

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  try {
    await getAuthContext();
  } catch {
    redirect('/login');
  }
  return <>{children}</>;
}
