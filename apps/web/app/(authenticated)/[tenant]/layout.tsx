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
  params: { tenant: string };
}) {
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
  if (tenant.slug !== params.tenant) redirect('/login');

  const userRole = profile.role as string;
  const tenantSlug = params.tenant;

  const visibleLinks = NAV_LINKS.filter((link) => link.roles.includes(userRole));

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-56 border-r border-divider flex-shrink-0 p-4">
        <div className="mb-6">
          <Link href={`/${tenantSlug}/dashboard`} className="font-bold text-xl">
            E-Logbook
          </Link>
        </div>
        <nav className="flex flex-col gap-1">
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
      </aside>
      <main className="flex-1 p-6 overflow-auto">{children}</main>
    </div>
  );
}
