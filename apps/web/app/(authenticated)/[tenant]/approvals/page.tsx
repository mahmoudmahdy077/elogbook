import { createServerSupabase } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import ApprovalsDashboard from '@/components/approvals/ApprovalsDashboard';

export default async function ApprovalsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id')
    .eq('user_id', user.id)
    .single();

  if (!profile || !['supervisor', 'director', 'admin'].includes(profile.role)) notFound();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Pending Approvals</h1>
      <ApprovalsDashboard tenantId={profile.tenant_id} tenantSlug={tenantSlug} />
    </div>
  );
}
