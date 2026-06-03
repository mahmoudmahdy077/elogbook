import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader } from '@heroui/react';

export default async function DashboardPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const { count: draftCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('resident_id', user!.id)
    .eq('status', 'draft');

  const { count: approvedCount } = await supabase
    .from('case_entries')
    .select('*', { count: 'exact', head: true })
    .eq('resident_id', user!.id)
    .eq('status', 'approved');

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>Draft Cases</CardHeader>
          <CardBody><p className="text-3xl font-bold">{draftCount ?? 0}</p></CardBody>
        </Card>
        <Card>
          <CardHeader>Approved Cases</CardHeader>
          <CardBody><p className="text-3xl font-bold">{approvedCount ?? 0}</p></CardBody>
        </Card>
        <Card>
          <CardHeader>Pending Review</CardHeader>
          <CardBody><p className="text-3xl font-bold">0</p></CardBody>
        </Card>
      </div>
    </div>
  );
}
