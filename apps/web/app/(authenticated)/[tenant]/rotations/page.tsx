import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import RotationCalendar from '@/components/RotationCalendar';

interface RotationRow {
  id: string;
  title: string;
  specialty: string;
  start_date: string;
  end_date: string;
  site: string | null;
  resident_id: string;
  profiles: { full_name: string } | null;
}

interface ResidentRow {
  id: string;
  full_name: string;
}

export default async function RotationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ resident?: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const { resident: residentFilter } = await searchParams;
  const auth = await getAuthContext();
  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();
  const tenantId = auth.profile.tenant_id;
  const role = auth.profile.role;
  const isDirector = role === 'director' || role === 'institution_admin' || role === 'admin';
  const isResident = role === 'resident';

  // Build rotations query
  let rotationsQuery = supabase
    .from('rotations')
    .select('id, title, specialty, start_date, end_date, site, resident_id, profiles!inner(full_name)')
    .eq('tenant_id', tenantId);

  if (isResident) {
    rotationsQuery = rotationsQuery.eq('resident_id', auth.profile.id);
  } else if (residentFilter) {
    rotationsQuery = rotationsQuery.eq('resident_id', residentFilter);
  }

  const { data: rotations, error: rotationsError } = await rotationsQuery
    .order('start_date', { ascending: false });

  if (rotationsError) {
    return (
      <div className="space-y-7">
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em]">Rotations</h1>
          <p className="text-[0.9rem] text-text-muted mt-1">Error loading rotations.</p>
        </div>
        <div className="panel p-6 text-danger text-sm">{rotationsError.message}</div>
      </div>
    );
  }

  // Fetch shifts for the visible rotations
  const rotationIds = (rotations ?? []).map((r: RotationRow) => r.id);
  if (rotationIds.length > 0) {
    await supabase
      .from('shifts')
      .select('id, rotation_id, date, shift_type, hours')
      .in('rotation_id', rotationIds);
  }

  // Fetch residents for filter (directors+ only)
  let residents: ResidentRow[] = [];
  if (isDirector) {
    const { data: residentData } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .eq('role', 'resident');
    residents = (residentData ?? []) as ResidentRow[];
  }

  const rotationRows: RotationRow[] = (rotations ?? []) as RotationRow[];

  return (
    <RotationCalendar
      rotations={rotationRows}
      residents={residents}
      tenantSlug={tenantSlug}
      canEdit={role === 'director' || role === 'institution_admin' || role === 'admin'}
      selectedResidentId={residentFilter ?? null}
    />
  );
}
