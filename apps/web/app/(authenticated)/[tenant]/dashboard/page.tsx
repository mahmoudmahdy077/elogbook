import { createServerSupabase } from '@/lib/supabase/server';
import { Card, Button } from '@heroui/react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AIInsightsPanel from '@/components/AIInsightsPanel';

export default async function DashboardPage({ params }: { params: Promise<{ tenant: string }> }) {
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
          <Link href={`/${tenantSlug}/cases/new`}>
            <Button color="primary">
              Log New Case
            </Button>
          </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="panel">
          <Card.Header className="font-heading">Draft Cases</Card.Header>
          <Card.Content><p className="text-3xl font-bold clinical-data">{draftCount ?? 0}</p></Card.Content>
        </Card>
        <Card className="panel">
          <Card.Header className="font-heading">Pending Review</Card.Header>
          <Card.Content><p className="text-3xl font-bold clinical-data">{pendingCount ?? 0}</p></Card.Content>
        </Card>
        <Card className="panel">
          <Card.Header className="font-heading">Approved Cases</Card.Header>
          <Card.Content><p className="text-3xl font-bold clinical-data">{approvedCount ?? 0}</p></Card.Content>
        </Card>
      </div>

      {showAIInsights && (
        <AIInsightsPanel tenantId={profile.tenant_id} residentId={profile.id} />
      )}
    </div>
  );
}
