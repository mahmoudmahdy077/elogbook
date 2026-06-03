import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader, Button } from '@heroui/react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AIInsightsPanel from '@/components/AIInsightsPanel';

export default async function DashboardPage({ params }: { params: { tenant: string } }) {
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

  const { count: draftCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('resident_id', profile.id)
    .eq('status', 'draft');

  const { count: approvedCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('resident_id', profile.id)
    .eq('status', 'approved');

  const { count: pendingCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('resident_id', profile.id)
    .eq('status', 'pending');

  const { data: aiToggle } = await supabase
    .from('resident_ai_toggle')
    .select('enabled')
    .eq('tenant_id', profile.tenant_id)
    .eq('resident_id', profile.id)
    .maybeSingle();

  const showAIInsights = aiToggle?.enabled === true;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Button as={Link} href={`/${params.tenant}/cases/new`} color="primary">
          Log New Case
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>Draft Cases</CardHeader>
          <CardBody><p className="text-3xl font-bold">{draftCount ?? 0}</p></CardBody>
        </Card>
        <Card>
          <CardHeader>Pending Review</CardHeader>
          <CardBody><p className="text-3xl font-bold">{pendingCount ?? 0}</p></CardBody>
        </Card>
        <Card>
          <CardHeader>Approved Cases</CardHeader>
          <CardBody><p className="text-3xl font-bold">{approvedCount ?? 0}</p></CardBody>
        </Card>
      </div>

      {showAIInsights && (
        <AIInsightsPanel tenantId={profile.tenant_id} residentId={profile.id} />
      )}
    </div>
  );
}
