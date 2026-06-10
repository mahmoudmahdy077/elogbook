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

  const tenant = profile.tenants as unknown as { slug: string; tenant_type: string };
  if (tenant.slug !== tenantSlug) redirect('/login');

  const initialStatus = tenant.tenant_type === 'individual' ? 'pending' : 'draft';

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
