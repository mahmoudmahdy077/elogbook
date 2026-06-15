import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import CaseForm from '@/components/CaseForm';

export default async function NewCasePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenants = profile.tenants as { slug: string; tenant_type: string }[];
  const tenant = tenants[0];
  if (!tenant || tenant.slug !== tenantSlug) redirect('/login');

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle();

  const isReadOnly = subscription?.status === 'past_due' || subscription?.status === 'unpaid';
  const initialStatus = tenant.tenant_type === 'individual' ? 'pending' : 'draft';

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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Log New Case</h1>
      <CaseForm
        tenantId={profile.tenant_id}
        tenantSlug={tenant.slug}
        initialStatus={initialStatus}
      />
    </div>
  );
}
