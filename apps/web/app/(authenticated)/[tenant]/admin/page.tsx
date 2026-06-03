import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Tabs, Tab } from '@heroui/react';
import TemplateEditor from '@/components/TemplateEditor';
import UserManager from '@/components/UserManager';
import AIConfigPanel from '@/components/AIConfigPanel';
import PaymentGatewayPanel from '@/components/PaymentGatewayPanel';

export default async function AdminPage({ params }: { params: { tenant: string } }) {
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
  if (tenant.slug !== params.tenant) redirect('/login');

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
        <Tab key="templates" title="Case Templates">
          <TemplateEditor tenantId={profile.tenant_id} templates={templates ?? []} />
        </Tab>
        <Tab key="users" title="Users & Roles">
          <UserManager
            tenantId={profile.tenant_id}
            users={users ?? []}
            currentUserRole={profile.role}
          />
        </Tab>
        <Tab key="ai" title="AI Config">
          <AIConfigPanel tenantId={profile.tenant_id} config={aiConfig} />
        </Tab>
        <Tab key="payment" title="Payment Gateway">
          <PaymentGatewayPanel tenantId={profile.tenant_id} config={paymentConfig} />
        </Tab>
      </Tabs>
    </div>
  );
}
