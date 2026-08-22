import { createServerSupabase } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/supabase/auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';
import WebAdsExportButton from '@/components/WebAdsExportButton';
import GapAnalysisRunner from '@/components/GapAnalysisRunner';

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ date_from?: string; date_to?: string }> }) {
  const { tenant: tenantSlug } = await params;
  const { date_from, date_to } = await searchParams;
  const auth = await getAuthContext();
  if (auth.tenant.slug !== tenantSlug) redirect('/login');
  const supabase = await createServerSupabase();
  const tenantId = auth.tenant.id;
  const isResident = auth.profile.role === 'resident';
  const isDirectorPlus = ['supervisor', 'director', 'institution_admin', 'admin'].includes(auth.profile.role);

  const { data: reportData, error: reportError } = await supabase.rpc('get_report_counts', {
    p_tenant_id: tenantId,
    p_date_from: date_from ?? '',
    p_date_to: date_to ?? '',
  });

  if (reportError) return <ErrorDisplay message={reportError.message} />;

  // Residents list for the gap-analysis runner (director+ only)
  let residentOptions: { id: string; full_name: string }[] = [];
  if (isDirectorPlus) {
    const { data: residentRows } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .eq('role', 'resident')
      .order('full_name');
    residentOptions = residentRows ?? [];
  }

  const rpc = reportData as unknown as {
    status_counts: Record<string, number>;
    specialty_counts: Record<string, number>;
    eval_averages: { clinical: number; prof: number; proc: number };
    eval_count: number;
  };

  const statusCounts: Record<string, number> = {
    draft: rpc.status_counts?.draft ?? 0,
    pending: rpc.status_counts?.pending ?? 0,
    approved: rpc.status_counts?.approved ?? 0,
    rejected: rpc.status_counts?.rejected ?? 0,
  };
  const totalCount = statusCounts.draft + statusCounts.pending + statusCounts.approved + statusCounts.rejected;
  const approvedCount = statusCounts.approved;
  const pendingCount = statusCounts.pending;
  const draftCount = statusCounts.draft;
  const specialtyCounts: Record<string, number> = rpc.specialty_counts ?? {};

  const evalStats = {
    clinical: String(rpc.eval_averages?.clinical ?? 0),
    prof: String(rpc.eval_averages?.prof ?? 0),
    proc: String(rpc.eval_averages?.proc ?? 0),
  };

  const maxSpecialty = Math.max(1, ...Object.values(specialtyCounts));

  const statusColors: Record<string, string> = {
    approved: 'bg-success',
    pending: 'bg-primary',
    draft: 'bg-text-muted',
    rejected: 'bg-danger',
  };

  const statusLabels: Record<string, string> = {
    approved: 'Approved',
    pending: 'Pending',
    draft: 'Draft',
    rejected: 'Rejected',
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-7 flex-wrap gap-4">
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em] font-sans">Reports &amp; Analytics</h1>
          <p className="text-[0.9rem] text-text-muted mt-1">Review case statistics, specialty distribution, and evaluation summaries.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <form className="flex items-center gap-2" method="GET">
            <input
              type="date"
              name="date_from"
              defaultValue={date_from || ''}
              className="px-3 py-2 rounded-full bg-surface-solid border border-border text-sm text-text-secondary focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-xs text-text-muted font-medium">to</span>
            <input
              type="date"
              name="date_to"
              defaultValue={date_to || ''}
              className="px-3 py-2 rounded-full bg-surface-solid border border-border text-sm text-text-secondary focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-full border border-border bg-surface-solid text-sm font-medium text-text-secondary hover:bg-backdrop transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Filter
            </button>
          </form>
          <Link
            href={`/api/${tenantSlug}/export-pdf`}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Export PDF
          </Link>
          {isDirectorPlus && (
            <WebAdsExportButton tenantSlug={tenantSlug} dateFrom={date_from} dateTo={date_to} />
          )}
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <div className="bg-surface-solid rounded-2xl border border-border p-5 flex flex-col items-center gap-2.5">
          <div className="w-[68px] h-[68px] rounded-full bg-backdrop flex items-center justify-center">
            <span className="text-xl font-semibold text-text-primary tracking-tight">{totalCount ?? 0}</span>
          </div>
          <span className="text-[0.7rem] font-semibold text-text-muted uppercase tracking-wider">Total</span>
        </div>
        <div className="bg-surface-solid rounded-2xl border border-border p-5 flex flex-col items-center gap-2.5">
          <div className="w-[68px] h-[68px] rounded-full bg-success/10 flex items-center justify-center">
            <span className="text-xl font-semibold text-success tracking-tight">{approvedCount ?? 0}</span>
          </div>
          <span className="text-[0.7rem] font-semibold text-text-muted uppercase tracking-wider">Approved</span>
        </div>
        <div className="bg-surface-solid rounded-2xl border border-border p-5 flex flex-col items-center gap-2.5">
          <div className="w-[68px] h-[68px] rounded-full bg-warning/10 flex items-center justify-center">
            <span className="text-xl font-semibold text-warning tracking-tight">{pendingCount ?? 0}</span>
          </div>
          <span className="text-[0.7rem] font-semibold text-text-muted uppercase tracking-wider">Pending</span>
        </div>
        <div className="bg-surface-solid rounded-2xl border border-border p-5 flex flex-col items-center gap-2.5">
          <div className="w-[68px] h-[68px] rounded-full bg-backdrop flex items-center justify-center">
            <span className="text-xl font-semibold text-text-muted tracking-tight">{draftCount ?? 0}</span>
          </div>
          <span className="text-[0.7rem] font-semibold text-text-muted uppercase tracking-wider">Drafts</span>
        </div>
      </div>

            {/* Competency Gap Analysis (director+) */}
      {isDirectorPlus && <GapAnalysisRunner tenantSlug={tenantSlug} residents={residentOptions} />}

{/* Charts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Cases by Specialty */}
        <div className="bg-surface-solid rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">Cases by Specialty</h2>
            <Link
              href={`/api/${tenantSlug}/reports/specialty.csv?date_from=${date_from || ''}&date_to=${date_to || ''}`}
              className="text-xs font-medium text-primary hover:opacity-80 transition-opacity"
            >
              Export CSV
            </Link>
          </div>
          {Object.keys(specialtyCounts).length === 0 ? (
            <p className="text-sm text-text-muted">No cases logged yet.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(specialtyCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([specialty, count]) => (
                  <div key={specialty}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-text-secondary font-medium truncate pr-2">{specialty}</span>
                      <span className="text-text-muted font-medium">{count}</span>
                    </div>
                    <div className="h-1 rounded-full bg-black/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(count / maxSpecialty) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Status Distribution */}
        <div className="bg-surface-solid rounded-2xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">Status Distribution</h2>
            <Link
              href={`/api/${tenantSlug}/reports/status.csv?date_from=${date_from || ''}&date_to=${date_to || ''}`}
              className="text-xs font-medium text-primary hover:opacity-80 transition-opacity"
            >
              Export CSV
            </Link>
          </div>
          <div className="flex items-center justify-center gap-6 py-4">
            {Object.entries(statusCounts).map(([status, count]) => (
              <div key={status} className="flex flex-col items-center gap-1.5">
                <div
                  className={`w-6 h-6 rounded-full ${statusColors[status] || 'bg-text-muted'}`}
                />
                <span className="text-xs text-text-muted font-medium">{statusLabels[status]}</span>
                <span className="text-lg font-semibold text-text-primary tracking-[-0.02em]">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Evaluation Averages — only for non-residents */}
        {!isResident && (
          <div className="bg-surface-solid rounded-2xl border border-border p-5 md:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">Evaluation Averages</h2>
              <Link
                href={`/api/${tenantSlug}/reports/evaluations.csv?date_from=${date_from || ''}&date_to=${date_to || ''}`}
                className="text-xs font-medium text-primary hover:opacity-80 transition-opacity"
              >
                Export CSV
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center py-4">
              <div>
                <p className="text-xs text-text-muted font-medium mb-1">Clinical Skills</p>
                <p className="text-2xl font-semibold text-text-primary tracking-[-0.02em]">{evalStats.clinical}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted font-medium mb-1">Professionalism</p>
                <p className="text-2xl font-semibold text-text-primary tracking-[-0.02em]">{evalStats.prof}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted font-medium mb-1">Procedures</p>
                <p className="text-2xl font-semibold text-text-primary tracking-[-0.02em]">{evalStats.proc}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
