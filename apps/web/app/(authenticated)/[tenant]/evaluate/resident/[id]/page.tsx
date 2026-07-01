import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import FacultyEvaluationForm from '@/components/FacultyEvaluationForm';
import ErrorDisplay from '@/components/ErrorDisplay';

export default async function EvaluateResidentPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: tenantSlug, id: residentId } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();

  const { data: resident, error } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', residentId)
    .single();

  if (error) return <ErrorDisplay message={error.message} />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Evaluate Resident</h1>
      <p className="text-lg">{resident?.full_name ?? 'Unknown'}</p>
      <FacultyEvaluationForm
        residentId={residentId}
        tenantId={auth.profile.tenant_id}
        evaluatorId={auth.profile.id}
      />
    </div>
  );
}