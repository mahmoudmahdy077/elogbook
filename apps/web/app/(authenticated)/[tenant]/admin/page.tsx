import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AdminTabPanel from '@/components/AdminTabPanel';
import ErrorDisplay from '@/components/ErrorDisplay';

export default async function AdminPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenants = profile.tenants as { slug: string }[];
  const tenant = tenants[0];
  if (!tenant || tenant.slug !== tenantSlug) redirect('/login');

  if (!['director', 'institution_admin', 'admin'].includes(profile.role)) {
    redirect('/login');
  }

  const [
    { data: templates, error: templatesError },
    { data: users, error: usersError },
    { data: aiConfigRaw, error: aiConfigError },
    { data: paymentConfigRaw, error: paymentConfigError },
    { data: caseCounts, error: caseCountsError },
  ] = await Promise.all([
      supabase
        .from('case_templates')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('ai_config')
        .select('id, tenant_id, provider, model, endpoint_url, is_active, encrypted_api_key')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle(),
      supabase
        .from('payment_gateway_config')
        .select('id, tenant_id, provider, publishable_key, endpoint_url, is_active, encrypted_secret_key, encrypted_webhook_secret')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle(),
      supabase
        .from('case_entries')
        .select('status', { count: 'exact' })
        .eq('tenant_id', profile.tenant_id),
    ]);

  if (templatesError) return <ErrorDisplay message={templatesError.message} />;
  if (usersError) return <ErrorDisplay message={usersError.message} />;
  if (aiConfigError) return <ErrorDisplay message={aiConfigError.message} />;
  if (paymentConfigError) return <ErrorDisplay message={paymentConfigError.message} />;
  if (caseCountsError) return <ErrorDisplay message={caseCountsError.message} />;

  interface AiConfigRaw {
    id: string;
    tenant_id: string;
    provider: string;
    model: string;
    endpoint_url: string | null;
    is_active: boolean;
    encrypted_api_key?: string;
  }

  interface PaymentConfigRaw {
    id: string;
    tenant_id: string;
    provider: string;
    publishable_key: string;
    endpoint_url: string | null;
    is_active: boolean;
    encrypted_secret_key?: string;
    encrypted_webhook_secret?: string;
  }

  const aiConfig = aiConfigRaw
    ? {
        id: (aiConfigRaw as AiConfigRaw).id,
        tenant_id: (aiConfigRaw as AiConfigRaw).tenant_id,
        provider: (aiConfigRaw as AiConfigRaw).provider,
        model: (aiConfigRaw as AiConfigRaw).model,
        endpoint_url: (aiConfigRaw as AiConfigRaw).endpoint_url,
        is_active: (aiConfigRaw as AiConfigRaw).is_active,
        has_key: !!((aiConfigRaw as AiConfigRaw).encrypted_api_key),
      }
    : null;

  const paymentConfig = paymentConfigRaw
    ? {
        id: (paymentConfigRaw as PaymentConfigRaw).id,
        tenant_id: (paymentConfigRaw as PaymentConfigRaw).tenant_id,
        provider: (paymentConfigRaw as PaymentConfigRaw).provider,
        publishable_key: (paymentConfigRaw as PaymentConfigRaw).publishable_key,
        endpoint_url: (paymentConfigRaw as PaymentConfigRaw).endpoint_url,
        is_active: (paymentConfigRaw as PaymentConfigRaw).is_active,
        has_secret_key: !!((paymentConfigRaw as PaymentConfigRaw).encrypted_secret_key),
        has_webhook_secret: !!((paymentConfigRaw as PaymentConfigRaw).encrypted_webhook_secret),
      }
    : null;

  const totalCases = caseCounts?.length ?? 0;
  const pendingCases = (caseCounts ?? []).filter((c: { status: string }) => c.status === 'pending').length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Admin Panel</h1>
      <AdminTabPanel
        tenantSlug={tenantSlug}
        tenantId={profile.tenant_id}
        profileRole={profile.role}
        templates={templates ?? []}
        users={users ?? []}
        aiConfig={aiConfig}
        paymentConfig={paymentConfig}
        totalCases={totalCases}
        pendingCases={pendingCases}
      />
    </div>
  );
}
