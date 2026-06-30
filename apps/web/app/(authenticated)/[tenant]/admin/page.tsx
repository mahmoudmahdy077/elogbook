import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Tabs, Card, Button } from '@heroui/react';
import TemplateEditor from '@/components/TemplateEditor';
import UserManager from '@/components/UserManager';
import AIConfigPanel from '@/components/AIConfigPanel';
import PaymentGatewayPanel from '@/components/PaymentGatewayPanel';
import CompetencyManager from '@/components/CompetencyManager';
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
    encrypted_api_key?: string;
    [key: string]: unknown;
  }

  interface PaymentConfigRaw {
    encrypted_secret_key?: string;
    encrypted_webhook_secret?: string;
    [key: string]: unknown;
  }

  const aiConfig = aiConfigRaw
    ? { ...aiConfigRaw, has_key: !!(aiConfigRaw as AiConfigRaw).encrypted_api_key, encrypted_api_key: undefined }
    : null;

  const paymentConfig = paymentConfigRaw
    ? { ...paymentConfigRaw, has_secret_key: !!(paymentConfigRaw as PaymentConfigRaw).encrypted_secret_key, has_webhook_secret: !!(paymentConfigRaw as PaymentConfigRaw).encrypted_webhook_secret, encrypted_secret_key: undefined, encrypted_webhook_secret: undefined }
    : null;

  const totalCases = caseCounts?.length ?? 0;
  const pendingCases = (caseCounts ?? []).filter((c: { status: string }) => c.status === 'pending').length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Admin Panel</h1>
      <Tabs aria-label="Admin panels">
        <Tabs.List>
          <Tabs.Tab id="overview">Overview</Tabs.Tab>
          <Tabs.Tab id="templates">Case Templates</Tabs.Tab>
          <Tabs.Tab id="users">Users & Roles</Tabs.Tab>
          <Tabs.Tab id="ai">AI Config</Tabs.Tab>
          <Tabs.Tab id="payment">Payment Gateway</Tabs.Tab>
          <Tabs.Tab id="accreditation">Accreditation</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel id="overview">
          <Card className="panel p-5">
            <h2 className="text-lg font-heading font-semibold mb-2">Program Analytics</h2>
            <p className="text-sm text-neutral-light/60 mb-4">
              View institution-wide completion rates, pending verifications, and specialty distribution.
            </p>
            <div className="flex gap-6 mb-4">
              <div>
                <p className="text-xs text-neutral-light/50">Total Cases</p>
                <p className="text-2xl font-bold font-heading">{totalCases}</p>
              </div>
              <div>
                <p className="text-xs text-amber-400/60">Pending Verification</p>
                <p className="text-2xl font-bold font-heading text-amber-400">{pendingCases}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-light/50">Residents</p>
                <p className="text-2xl font-bold font-heading">{(users ?? []).length}</p>
              </div>
            </div>
            <Link href={`/${tenantSlug}/admin/overview`}>
              <Button variant="primary">Open Program Overview</Button>
            </Link>
          </Card>
        </Tabs.Panel>
        <Tabs.Panel id="templates">
          <TemplateEditor tenantId={profile.tenant_id} templates={templates ?? []} />
        </Tabs.Panel>
        <Tabs.Panel id="users">
          <UserManager
            tenantId={profile.tenant_id}
            users={users ?? []}
            currentUserRole={profile.role}
          />
        </Tabs.Panel>
        <Tabs.Panel id="ai">
          <AIConfigPanel tenantId={profile.tenant_id} config={aiConfig} />
        </Tabs.Panel>
        <Tabs.Panel id="payment">
          <PaymentGatewayPanel tenantId={profile.tenant_id} config={paymentConfig} />
        </Tabs.Panel>
        <Tabs.Panel id="accreditation">
          <CompetencyManager tenantId={profile.tenant_id} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
