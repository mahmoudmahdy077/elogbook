import { getAuthContext, canAccessTenant } from '@/lib/supabase/auth';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import MobileNav from '@/components/MobileNav';
import ClientProviders from '@/components/ClientProviders';
import { SubscriptionStatusProvider } from '@/components/SubscriptionStatusProvider';
import ReadOnlyBanner from '@/components/ReadOnlyBanner';

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

  let auth;
  try {
    auth = await getAuthContext();
  } catch {
    redirect('/login');
  }

  if (!canAccessTenant(auth, paramTenant)) {
    redirect(`/${auth.tenant.slug}/dashboard`);
  }

  // P6.1: enforce TOTP MFA for director / institution_admin / admin.
  // The /mfa/* pages live at the top level (outside this layout), so
  // no recursion guard is needed here.
  if (auth.mfaRequired) {
    redirect(`/${auth.tenant.slug}/mfa/verify?next=/${auth.tenant.slug}/dashboard`);
  }

  const userRole = auth.profile.role;
  const tenantSlug = auth.tenant.slug;
  const subscriptionStatus = (auth.subscription?.status as 'active' | 'trialing' | 'past_due' | 'unpaid' | 'canceled') ?? 'active';

  const visibleLinks = NAV_LINKS.filter((link) => link.roles.includes(userRole));

  return (
    <div className="min-h-screen bg-backdrop flex">
      <Sidebar visibleLinks={visibleLinks} tenantSlug={tenantSlug} />
      <MobileNav visibleLinks={visibleLinks} tenantSlug={tenantSlug} />
      <SubscriptionStatusProvider status={subscriptionStatus} periodEnd={auth.subscription?.current_period_end}>
        <main id="main-content" className="flex-1 overflow-auto pb-16 md:pb-6">
          <ReadOnlyBanner tenantSlug={tenantSlug} />
          <div className="p-6">
            <ClientProviders>{children}</ClientProviders>
          </div>
        </main>
      </SubscriptionStatusProvider>
    </div>
  );
}
