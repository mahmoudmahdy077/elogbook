import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DutyHoursChart from '@/components/DutyHoursChart';
import ErrorDisplay from '@/components/ErrorDisplay';
import { Button } from '@heroui/react';

export default async function DutyHoursReportPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ date_from?: string; date_to?: string }> }) {
  const { tenant: tenantSlug } = await params;
  const { date_from, date_to } = await searchParams;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();
  const { profile } = auth;
  const role = profile.role;
  const tenantId = profile.tenant_id;

  let query = supabase
    .from('duty_periods')
    .select('shift_date, hours_worked, shift_type')
    .eq('tenant_id', tenantId);

  if (role === 'resident') {
    query = query.eq('resident_id', profile.id);
  }

  if (date_from) query = query.gte('shift_date', date_from);
  if (date_to) query = query.lte('shift_date', date_to);

  const { data: periods, error } = await query.order('shift_date', { ascending: false }).limit(100);

  if (error) return <ErrorDisplay message={error.message} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Duty Hours Report</h1>
        <a href={`/api/${tenantSlug}/reports/duty-hours.csv?date_from=${date_from || ''}&date_to=${date_to || ''}`}>
          <Button variant="ghost" size="sm">Export CSV</Button>
        </a>
      </div>
      <DutyHoursChart periods={periods ?? []} />
    </div>
  );
}