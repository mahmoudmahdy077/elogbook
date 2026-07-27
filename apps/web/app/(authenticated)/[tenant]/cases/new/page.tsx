import { createServerSupabase } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import ClientCaseForm from '@/components/ClientCaseForm';

export default async function NewCasePage({ params, searchParams }: { params: Promise<{ tenant: string }>, searchParams: Promise<{ duplicateFrom?: string; repeatLast?: string }> }) {
  const { tenant: tenantSlug } = await params;
  const { duplicateFrom, repeatLast } = await searchParams;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenant = profile.tenants as { slug: string; tenant_type: string };
  if (!tenant || tenant.slug !== tenantSlug) redirect('/login');

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();

  const isReadOnly = subscription?.status === 'past_due' || subscription?.status === 'unpaid';
  const initialStatus = tenant.tenant_type === 'individual' ? 'pending' : 'draft';

  // Check case quota
  const { data: quota } = await supabase
    .rpc('check_case_quota', { p_tenant_id: profile.tenant_id });
  const quotaInfo = quota?.[0];
  const isOverQuota = quotaInfo && !quotaInfo.allowed;

  if (isReadOnly) {
    return (
      <div className="panel p-6">
        <h1 className="text-2xl font-bold mb-4">Log New Case</h1>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 text-amber-200">
          <p className="font-semibold mb-1">Subscription renewal required</p>
          <p className="text-sm">New case logging is temporarily disabled because your institution subscription has lapsed. Please renew to restore full access.</p>
        </div>
      </div>
    );
  }

  if (isOverQuota) {
    return (
      <div className="panel p-6">
        <h1 className="text-2xl font-bold mb-4">Log New Case</h1>
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-6 text-center">
          <h2 className="text-xl font-semibold text-text-primary mb-2">Upgrade to log more cases</h2>
          <p className="text-sm text-text-muted mb-4">
            You&apos;ve reached the limit of your current plan ({quotaInfo?.max_cases} cases).
          </p>
          <Link
            href={`/${tenantSlug}/billing`}
            className="inline-block px-6 py-2.5 rounded-full bg-primary text-white font-medium text-sm hover:opacity-90 transition-opacity"
          >
            View upgrade options
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Log New Case</h1>
        {!duplicateFrom && !repeatLast && (
          <Link href={`/${tenantSlug}/cases/new?repeatLast=true`} className="text-sm text-primary hover:text-primary/80 transition-colors">
            ↻ Repeat last entry
          </Link>
        )}
      </div>
      <ClientCaseForm
        tenantId={profile.tenant_id}
        tenantSlug={tenant.slug}
        initialStatus={initialStatus}
        duplicateCaseId={duplicateFrom}
        lastEntry={repeatLast === 'true'}
      />
    </div>
  );
}
