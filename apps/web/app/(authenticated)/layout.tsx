import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Navbar, NavbarBrand, NavbarContent, NavbarItem, Button } from '@heroui/react';
import Link from 'next/link';

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, tenants(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenantSlug = (profile.tenants as any)?.slug ?? 'me';

  return (
    <div className="min-h-screen bg-background">
      <Navbar isBordered>
        <NavbarBrand>
          <Link href={`/${tenantSlug}/dashboard`} className="font-bold text-xl">E-Logbook</Link>
        </NavbarBrand>
        <NavbarContent justify="end">
          <NavbarItem>
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="light" size="sm">Sign Out</Button>
            </form>
          </NavbarItem>
        </NavbarContent>
      </Navbar>
      <main className="p-6">{children}</main>
    </div>
  );
}
