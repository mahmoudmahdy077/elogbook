import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';

export default async function MyEvaluationsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();

  const { data: evaluations, error } = await supabase
    .from('faculty_evaluations')
    .select('evaluation_date, clinical_skills, professionalism, procedures, comments')
    .eq('resident_id', auth.profile.id)
    .order('evaluation_date', { ascending: false });

  if (error) return <ErrorDisplay message={error.message} />;

  const avg = (evaluations ?? []).reduce(
    (acc: { clinical: number; prof: number; proc: number }, e: { clinical_skills: number; professionalism: number; procedures: number }) => ({
      clinical: acc.clinical + (e.clinical_skills ?? 0),
      prof: acc.prof + (e.professionalism ?? 0),
      proc: acc.proc + (e.procedures ?? 0),
    }),
    { clinical: 0, prof: 0, proc: 0 }
  );

  const count = evaluations?.length ?? 0;
  const avgClinical = count > 0 ? (avg.clinical / count).toFixed(1) : '0';
  const avgProf = count > 0 ? (avg.prof / count).toFixed(1) : '0';
  const avgProc = count > 0 ? (avg.proc / count).toFixed(1) : '0';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Evaluations</h1>

      <div className="panel p-6">
        <h2 className="text-lg font-semibold mb-4">Average Scores</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-sm text-default-500">Clinical Skills</p>
            <p className="text-3xl font-bold">{avgClinical}</p>
          </div>
          <div>
            <p className="text-sm text-default-500">Professionalism</p>
            <p className="text-3xl font-bold">{avgProf}</p>
          </div>
          <div>
            <p className="text-sm text-default-500">Procedures</p>
            <p className="text-3xl font-bold">{avgProc}</p>
          </div>
        </div>
      </div>

      {evaluations && evaluations.length > 0 && (
        <div className="panel p-6">
          <h2 className="text-lg font-semibold mb-4">History</h2>
          <div className="space-y-3">
            {evaluations.map((e: { evaluation_date: string; clinical_skills: number; professionalism: number; procedures: number; comments: string | null }) => (
              <div key={e.evaluation_date} className="border-b border-divider pb-2">
                <p className="text-sm font-medium">{e.evaluation_date}</p>
                <p className="text-xs text-default-500">
                  Skills: {e.clinical_skills} | Prof: {e.professionalism} | Proc: {e.procedures}
                </p>
                {e.comments && <p className="text-xs mt-1">{e.comments}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}