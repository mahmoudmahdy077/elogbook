import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

type NavLink = {
  href: string;
  label: string;
  roles: string[];
};

const NAV_LINKS: NavLink[] = [
  { href: '/dashboard', label: 'Dashboard', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'] },
  { href: '/cases', label: 'Cases', roles: ['resident', 'supervisor'] },
  { href: '/approvals', label: 'Approvals', roles: ['supervisor', 'director', 'admin'] },
  { href: '/goals', label: 'Goals', roles: ['resident', 'director', 'admin'] },
  { href: '/reports', label: 'Reports', roles: ['resident', 'supervisor', 'director', 'institution_admin', 'admin'] },
  { href: '/billing', label: 'Billing', roles: ['resident', 'admin'] },
  { href: '/audit', label: 'Audit', roles: ['director', 'institution_admin', 'admin'] },
  { href: '/admin', label: 'Admin', roles: ['director', 'institution_admin', 'admin'] },
];

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: paramTenant } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, user_id, tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenant = profile.tenants as unknown as { slug: string };
  if (tenant.slug !== paramTenant) redirect('/login');

  const userRole = profile.role as string;
  const tenantSlug = paramTenant;

  const visibleLinks = NAV_LINKS.filter((link) => link.roles.includes(userRole));

  return (
    <div className="min-h-screen bg-backdrop flex">
      <aside className="w-56 panel flex-shrink-0 p-4 flex flex-col max-md:hidden">
        <div className="mb-6">
          <Link href={`/${tenantSlug}/dashboard`} className="font-bold text-xl font-heading">
            E-Logbook
          </Link>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {visibleLinks.map((link) => (
            <Link
              key={link.href}
              href={`/${tenantSlug}${link.href}`}
              className="block px-3 py-2 rounded-lg text-sm hover:bg-default-100 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <form action="/auth/signout" method="post" className="mt-auto pt-4 border-t border-border">
          <button type="submit" className="block w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-danger/10 text-danger transition-colors">
            Sign Out
          </button>
        </form>
      </aside>
      <div className="md:hidden fixed bottom-0 left-0 right-0 panel rounded-none border-t z-40">
        <nav className="flex justify-around py-2 px-1">
          {visibleLinks.slice(0, 5).map((link) => (
            <Link
              key={link.href}
              href={`/${tenantSlug}${link.href}`}
              className="flex flex-col items-center gap-0.5 px-1 py-1 text-xs text-neutral-light/60"
            >
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>
      </div>
      <main id="main-content" className="flex-1 p-6 overflow-auto pb-16 md:pb-6">{children}</main>
    </div>
  );
}
