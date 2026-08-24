import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import ErrorDisplay from '@/components/ErrorDisplay';
import EmptyState from '@/components/EmptyState';
import MilestonesMatrix, { type MilestoneDefinitionRow } from '@/components/MilestonesMatrix';

const ALLOWED_ROLES = ['director', 'institution_admin', 'admin'];

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
  const isDirectorPlus = ALLOWED_ROLES.includes(role);
  const isResident = role === 'resident';

  // ---- Resident assessments (real per-resident rows in `milestones`) ----
  const targetId = isResident ? auth.profile.id : residentFilter || auth.profile.id;

  const [assessmentsRes, frameworkRes] = await Promise.all([
    supabase
      .from('milestones')
      .select(
        'id, competency_area, sub_competency, level, assessment_date, assessor_id, comments'
      )
      .eq('tenant_id', tenantId)
      .eq('resident_id', targetId)
      .order('assessment_date', { ascending: false }),
    // Milestone definitions live on the accreditation framework (JSONB column).
    supabase
      .from('accreditation_frameworks')
      .select('id, name, milestones')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  if (assessmentsRes.error) {
    return (
      <div className="space-y-7">
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em]">
            Milestones
          </h1>
          <p className="text-[0.9rem] text-text-muted mt-1">
            Error loading milestone assessments.
          </p>
        </div>
        <ErrorDisplay message={assessmentsRes.error.message} />
      </div>
    );
  }

  type AssessmentRow = {
    id: string;
    competency_area: string;
    sub_competency: string;
    level: number;
    assessment_date: string;
    assessor_id: string | null;
    comments: string | null;
  };
  const assessments = (assessmentsRes.data ?? []) as AssessmentRow[];

  // Latest level per sub-competency (rows are date-desc).
  const latestBySub: Record<string, AssessmentRow> = {};
  for (const a of assessments) {
    if (!latestBySub[a.sub_competency]) latestBySub[a.sub_competency] = a;
  }

  // Build definition rows from the framework JSONB (falls back to observed sub-competencies).
  type FrameworkMilestone = {
    id?: string;
    competency_area?: string;
    sub_competency: string;
    description?: string | null;
    levels?: string[];
  };
  const framework = (frameworkRes.data ?? null) as {
    id: string;
    name: string;
    milestones: FrameworkMilestone[] | null;
  } | null;

  const definitions: MilestoneDefinitionRow[] = [];
  const seen = new Set<string>();
  for (const fm of framework?.milestones ?? []) {
    if (!fm?.sub_competency || seen.has(fm.sub_competency)) continue;
    seen.add(fm.sub_competency);
    definitions.push({
      id: seen.size.toString(),
      competency_area: fm.competency_area ?? '',
      sub_competency: fm.sub_competency,
      description: fm.description ?? null,
      labels: [
        fm.levels?.[0] ?? 'Level 1',
        fm.levels?.[1] ?? 'Level 2',
        fm.levels?.[2] ?? 'Level 3',
        fm.levels?.[3] ?? 'Level 4',
        fm.levels?.[4] ?? 'Level 5',
      ],
    });
  }
  for (const a of Object.values(latestBySub)) {
    if (seen.has(a.sub_competency)) continue;
    seen.add(a.sub_competency);
    definitions.push({
      id: `observed-${definitions.length + 1}`,
      competency_area: a.competency_area,
      sub_competency: a.sub_competency,
      description: null,
      labels: ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5'],
    });
  }

  // Current level map keyed by the definition ids the matrix renders.
  const currentLevels: Record<string, number> = {};
  for (const d of definitions) {
    const latest = latestBySub[d.sub_competency];
    if (latest) currentLevels[d.id] = latest.level;
  }

  // Residents list for director+ filter
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

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em]">
            Milestones
          </h1>
          <p className="text-[0.9rem] text-text-muted mt-1">
            {definitions.length} sub-competenc{definitions.length !== 1 ? 'ies' : 'y'} tracked
            {framework ? ` · ${framework.name}` : ''}
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

      {definitions.length === 0 ? (
        <EmptyState
          icon={
            <svg
              className="w-5 h-5 text-text-muted"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h6.5z"
                clipRule="evenodd"
              />
            </svg>
          }
          title="No milestones configured"
          description="Milestones have not been set up for this program yet. Contact your program director."
        />
      ) : (
        <MilestonesMatrix
          milestones={definitions}
          currentLevels={currentLevels}
          residentId={targetId}
          tenantId={tenantId}
          isEditable
        />
      )}
    </div>
  );
}
