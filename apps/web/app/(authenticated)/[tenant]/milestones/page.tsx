import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import ErrorDisplay from '@/components/ErrorDisplay';
import EmptyState from '@/components/EmptyState';
import MilestonesMatrix from '@/components/MilestonesMatrix';

interface MilestoneRow {
  id: string;
  sub_competency: string;
  description: string | null;
  level_1_label: string | null;
  level_2_label: string | null;
  level_3_label: string | null;
  level_4_label: string | null;
  level_5_label: string | null;
  specialty: string | null;
}

interface EpaMappingRow {
  id: string;
  milestone_id: string;
  epa_name: string;
  epa_description: string | null;
  required_level: number;
}

export default async function MilestonesPage({
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
  const isDirectorPlus =
    role === 'director' || role === 'institution_admin' || role === 'admin';
  const isResident = role === 'resident';

  // Fetch milestones for the tenant
  const { data: milestones, error: milestonesError } = await supabase
    .from('milestones')
    .select(
      'id, sub_competency, description, level_1_label, level_2_label, level_3_label, level_4_label, level_5_label, specialty'
    )
    .eq('tenant_id', tenantId)
    .order('sub_competency', { ascending: true });

  if (milestonesError) {
    return (
      <div className="space-y-7">
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em]">
            Milestones
          </h1>
          <p className="text-[0.9rem] text-text-muted mt-1">
            Error loading milestones.
          </p>
        </div>
        <ErrorDisplay message={milestonesError.message} />
      </div>
    );
  }

  // Fetch EPA mappings
  const { data: epaMappings, error: epaError } = await supabase
    .from('epa_mappings')
    .select('id, milestone_id, epa_name, epa_description, required_level')
    .eq('tenant_id', tenantId);

  if (epaError) {
    return (
      <div className="space-y-7">
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em]">
            Milestones
          </h1>
          <p className="text-[0.9rem] text-text-muted mt-1">
            Error loading EPA mappings.
          </p>
        </div>
        <ErrorDisplay message={epaError.message} />
      </div>
    );
  }

  // Fetch residents for director+ filter
  let residents: { id: string; full_name: string }[] = [];
  if (isDirectorPlus) {
    const { data: residentData } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .eq('role', 'resident')
      .order('full_name', { ascending: true });
    residents = (residentData ?? []) as { id: string; full_name: string }[];
  }

  const typedMilestones = (milestones ?? []) as MilestoneRow[];
  const typedEpaMappings = (epaMappings ?? []) as EpaMappingRow[];

  // Fetch current level assessments if a resident is selected or viewing own
  const currentLevels: Record<string, number> = {};
  const targetId = isResident
    ? auth.profile.id
    : residentFilter || auth.profile.id;

  if (targetId && typedMilestones.length > 0) {
    const milestoneIds = typedMilestones.map((m) => m.id);
    const { data: assessments } = await supabase
      .from('milestone_assessments')
      .select('milestone_id, current_level')
      .eq('resident_id', targetId)
      .in('milestone_id', milestoneIds);

    if (assessments) {
      for (const a of assessments) {
        currentLevels[a.milestone_id] = a.current_level;
      }
    }
  }

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em]">
            Milestones
          </h1>
          <p className="text-[0.9rem] text-text-muted mt-1">
            {typedMilestones.length} milestone{typedMilestones.length !== 1 ? 's' : ''}{' '}
            defined
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Resident filter for directors */}
          {isDirectorPlus && residents.length > 0 && (
            <select
              value={residentFilter ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                const params = new URLSearchParams();
                if (val) params.set('resident', val);
                window.location.href = `/${tenantSlug}/milestones${params.toString() ? '?' + params.toString() : ''}`;
              }}
              className="rounded-xl bg-surface-solid border border-border p-2.5 text-sm"
              aria-label="Select resident"
            >
              <option value="">Select a Resident</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </select>
          )}

          <Link
            href={`/${tenantSlug}/goals`}
            className="rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
          >
            View Related Goals
          </Link>
        </div>
      </div>

      {typedMilestones.length === 0 ? (
        <EmptyState
          icon={
            <svg
              className="w-5 h-5 text-text-muted"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z"
                clipRule="evenodd"
              />
            </svg>
          }
          title="No milestones configured"
          description="Milestones have not been set up for this program yet. Contact your program director."
        />
      ) : (
        <MilestonesMatrix
          milestones={typedMilestones}
          epaMappings={typedEpaMappings}
          currentLevels={currentLevels}
          residentId={targetId}
          tenantId={tenantId}
          isEditable={isDirectorPlus}
        />
      )}
    </div>
  );
}
