import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Tabs } from '@heroui/react';
import TemplateEditor from '@/components/TemplateEditor';
import UserManager from '@/components/UserManager';
import AIConfigPanel from '@/components/AIConfigPanel';
import PaymentGatewayPanel from '@/components/PaymentGatewayPanel';
import CompetencyManager from '@/components/CompetencyManager';

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

  const tenant = profile.tenants as unknown as { slug: string };
  if (tenant.slug !== tenantSlug) redirect('/login');

  if (!['director', 'institution_admin', 'admin'].includes(profile.role)) {
    redirect('/login');
  }

  const [{ data: templates }, { data: users }, { data: aiConfig }, { data: paymentConfig }] =
    await Promise.all([
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
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle(),
      supabase
        .from('payment_gateway_config')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle(),
    ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Admin Panel</h1>
      <Tabs aria-label="Admin panels">
        <Tabs.List>
          <Tabs.Tab id="templates">Case Templates</Tabs.Tab>
          <Tabs.Tab id="users">Users & Roles</Tabs.Tab>
          <Tabs.Tab id="ai">AI Config</Tabs.Tab>
          <Tabs.Tab id="payment">Payment Gateway</Tabs.Tab>
          <Tabs.Tab id="accreditation">Accreditation</Tabs.Tab>
        </Tabs.List>
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
