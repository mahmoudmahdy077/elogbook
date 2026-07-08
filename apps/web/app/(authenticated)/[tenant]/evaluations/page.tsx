import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import ErrorDisplay from '@/components/ErrorDisplay';
import EmptyState from '@/components/EmptyState';
import { EvaluationFormPicker } from '@/components/evaluations/EvaluationFormPicker';

interface EvalFormRow {
  id: string;
  form_type: string;
  domains: Record<string, unknown>;
  total_score: number | null;
  completed_at: string | null;
  evaluator_notes: string | null;
  profiles: { full_name: string } | null;
  created_at: string;
}

export default async function EvaluationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ form_type?: string; resident?: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const { form_type: formTypeFilter, resident: residentFilter } = await searchParams;
  const auth = await getAuthContext();
  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();
  const tenantId = auth.profile.tenant_id;
  const role = auth.profile.role;
  const isDirectorPlus =
    role === 'director' || role === 'institution_admin' || role === 'admin';
  const isResident = role === 'resident';

  // Build evaluation_forms query
  let query = supabase
    .from('evaluation_forms')
    .select(
      'id, form_type, domains, total_score, completed_at, evaluator_notes, created_at, profiles!inner(full_name)'
    )
    .eq('tenant_id', tenantId);

  if (isResident) {
    query = query.eq('resident_id', auth.profile.id);
  } else if (residentFilter) {
    query = query.eq('resident_id', residentFilter);
  }

  if (formTypeFilter) {
    query = query.eq('form_type', formTypeFilter);
  }

  const { data: forms, error: formsError } = await query.order('created_at', {
    ascending: false,
  });

  if (formsError) {
    return (
      <div className="space-y-7">
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em]">
            Evaluations
          </h1>
          <p className="text-[0.9rem] text-text-muted mt-1">
            Error loading evaluations.
          </p>
        </div>
        <ErrorDisplay message={formsError.message} />
      </div>
    );
  }

  // Fetch residents for filter (director+ only)
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

  const typedForms = (forms ?? []) as EvalFormRow[];

  // Group by form_type
  const grouped = typedForms.reduce<Record<string, EvalFormRow[]>>(
    (acc, form) => {
      const key = form.form_type || 'Other';
      if (!acc[key]) acc[key] = [];
      acc[key].push(form);
      return acc;
    },
    {}
  );

  const formTypeKeys = Object.keys(grouped);

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em]">
            Evaluations
          </h1>
          <p className="text-[0.9rem] text-text-muted mt-1">
            {typedForms.length} evaluation{typedForms.length !== 1 ? 's' : ''} recorded
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
                if (formTypeFilter) params.set('form_type', formTypeFilter);
                window.location.href = `/${tenantSlug}/evaluations${params.toString() ? '?' + params.toString() : ''}`;
              }}
              className="rounded-xl bg-surface-solid border border-border p-2.5 text-sm"
              aria-label="Filter by resident"
            >
              <option value="">All Residents</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </select>
          )}

          {/* Form type filter */}
          <select
            value={formTypeFilter ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              const params = new URLSearchParams();
              if (residentFilter) params.set('resident', residentFilter);
              if (val) params.set('form_type', val);
              window.location.href = `/${tenantSlug}/evaluations${params.toString() ? '?' + params.toString() : ''}`;
            }}
            className="rounded-xl bg-surface-solid border border-border p-2.5 text-sm"
            aria-label="Filter by form type"
          >
            <option value="">All Types</option>
            <option value="Mini-CEX">Mini-CEX</option>
            <option value="DOPS">DOPS</option>
            <option value="CBD">CBD</option>
          </select>

          {isDirectorPlus && (
            <Link
              href={`/${tenantSlug}/evaluations?new=true`}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              New Evaluation
            </Link>
          )}
        </div>
      </div>

      {typedForms.length === 0 ? (
        <EmptyState
          icon={
            <svg
              className="w-5 h-5 text-text-muted"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                clipRule="evenodd"
              />
            </svg>
          }
          title="No evaluations found"
          description={
            isDirectorPlus
              ? 'Create an evaluation for a resident to begin tracking performance.'
              : 'Your evaluations will appear here once faculty complete them.'
          }
          action={
            isDirectorPlus
              ? {
                  label: 'Start an Evaluation',
                  href: `/${tenantSlug}/evaluations?new=true`,
                }
              : undefined
          }
        />
      ) : (
        <div className="space-y-8">
          {formTypeKeys.map((formType) => (
            <div key={formType} className="space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-text-primary">
                  {formType}
                </h2>
                <span className="inline-flex items-center bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium">
                  {grouped[formType].length}
                </span>
              </div>

              <div className="bg-surface-solid rounded-2xl border border-border overflow-hidden">
                {/* Table Header */}
                <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-5 py-3 border-b border-border bg-neutral-dark">
                  <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Resident
                  </span>
                  <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Score
                  </span>
                  <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Date
                  </span>
                  <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Status
                  </span>
                  <span className="sr-only">Actions</span>
                </div>

                {/* Table Rows */}
                <div className="divide-y divide-border">
                  {grouped[formType].map((form) => (
                    <div
                      key={form.id}
                      className="sm:grid sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-5 py-3.5 flex flex-col hover:bg-black/[0.02] transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {form.profiles?.full_name ?? 'Unknown'}
                        </p>
                      </div>
                      <div className="flex items-center">
                        <span className="text-sm text-text-secondary tabular-nums">
                          {form.total_score != null
                            ? form.total_score
                            : '—'}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <span className="text-sm text-text-muted">
                          {form.completed_at
                            ? new Date(form.completed_at).toLocaleDateString()
                            : 'Pending'}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            form.completed_at
                              ? 'bg-success-50 text-approved'
                              : 'bg-warning-50 text-pending'
                          }`}
                        >
                          {form.completed_at ? 'Completed' : 'In Progress'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/${tenantSlug}/evaluations/${form.id}`}
                          className="px-3 py-1.5 rounded-full text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                        >
                          View
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
