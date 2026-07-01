import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DutyHoursForm from '@/components/DutyHoursForm';
import ErrorDisplay from '@/components/ErrorDisplay';

export default async function DutyHoursPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();

  const { data: entries, error } = await supabase
    .from('duty_periods')
    .select('*')
    .eq('resident_id', auth.profile.id)
    .order('shift_date', { ascending: false })
    .limit(50);

  if (error) return <ErrorDisplay message={error.message} />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Duty Hours</h1>
      <DutyHoursForm residentId={auth.profile.id} tenantId={auth.profile.tenant_id} />
      {entries && entries.length > 0 && (
        <div className="panel">
          <h2 className="text-lg font-semibold mb-3">Recent Entries</h2>
          <div className="space-y-2">
            {entries.map((e: { shift_date: string; hours_worked: number; shift_type: string }) => (
              <div key={e.shift_date} className="flex justify-between text-sm">
                <span>{e.shift_date}</span>
                <span>{e.hours_worked}h — {e.shift_type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}