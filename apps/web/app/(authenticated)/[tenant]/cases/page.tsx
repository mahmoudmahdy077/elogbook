import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';
import EmptyState from '@/components/EmptyState';
import CaseFilters from '@/components/CaseFilters';
import { StatusBadge } from '@elogbook/shared/components/web';
import type { StatusVariant } from '@elogbook/shared/components/web';

type CaseEntryRow = {
  id: string;
  case_date: string;
  patient_mrn: string | null;
  status: string;
  resident_id: string;
  case_templates: { name: string; specialty: string } | { name: string; specialty: string }[];
};

const PAGE_SIZE = 20;

function statusToVariant(status: string): StatusVariant {
  if (status === 'draft' || status === 'pending' || status === 'approved' || status === 'rejected') {
    return status;
  }
  return 'draft';
}

export default async function CasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ page?: string; search?: string; status?: string | string[]; sort?: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const { page: pageStr, search: searchFilter, status: statusFilter, sort: sortFilter } = await searchParams;
  const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);

  const auth = await getAuthContext();
  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();
  const offset = (page - 1) * PAGE_SIZE;

  const statusList = statusFilter
    ? (Array.isArray(statusFilter) ? statusFilter : [statusFilter])
    : [];

  // U4.4: residents see only their own cases; supervisors+ see all
  const isResident = auth.profile.role === 'resident';

  let casesQuery = supabase
    .from('case_entries')
    .select('id, case_date, patient_mrn, status, resident_id, case_templates!inner(name, specialty)', { count: 'exact' })
    .eq('tenant_id', auth.profile.tenant_id);
  if (isResident) casesQuery = casesQuery.eq('resident_id', auth.profile.id);
  if (searchFilter) casesQuery = casesQuery.ilike('case_templates.name', `%${searchFilter}%`);
  if (statusList.length > 0) casesQuery = casesQuery.in('status', statusList);
  let orderColumn = 'created_at';
  let orderAsc = false;
  if (sortFilter === 'date_asc') orderAsc = true;
  else if (sortFilter === 'status_asc') { orderColumn = 'status'; orderAsc = true; }
  else if (sortFilter === 'status_desc') orderColumn = 'status';
  const { data: entries, error, count } = await casesQuery
    .order(orderColumn, { ascending: orderAsc })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) {
    return (
      <div>
        <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em] font-sans mb-6">My Cases</h1>
        <ErrorDisplay message={error.message} />
      </div>
    );
  }

  const totalPages = Math.ceil((count || 0) / PAGE_SIZE);

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[2rem] font-semibold text-text-primary tracking-[-0.03em] font-sans">My Cases</h1>
          <p className="text-[0.9rem] text-text-muted mt-1 font-normal">
            {count ?? 0} case{(count ?? 0) !== 1 ? 's' : ''} logged
          </p>
        </div>
        <Link
          href={`/${tenantSlug}/cases/new`}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z"/></svg>
          Log New Case
        </Link>
      </div>

      {/* Filters */}
      <CaseFilters basePath={`/${tenantSlug}/cases`} />

      {/* Cases Table */}
      {(!entries || entries.length === 0) ? (
        <EmptyState
          icon={
            <svg className="w-5 h-5 text-text-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M2 3.5A1.5 1.5 0 013.5 2h1.148a1.5 1.5 0 011.317.727L6.5 3.5h7A2.5 2.5 0 0116 6v.003a.75.75 0 11-1.5 0V6a1 1 0 00-1-1h-7l-.535-1.023A.375.375 0 005.648 3.5H3.5a.375.375 0 00-.375.375V16.5a.75.75 0 01-1.5 0V3.5zM4.75 10.75a.75.75 0 01.75-.75h9a.75.75 0 010 1.5h-9a.75.75 0 01-.75-.75zm.75 4.25a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5z" clipRule="evenodd" />
            </svg>
          }
          title="No cases logged yet"
          description="Start building your logbook by recording your first clinical case."
          action={{
            label: 'Log your first case',
            href: `/${tenantSlug}/cases/new`,
          }}
        />
      ) : (
        <div className="bg-surface-solid rounded-2xl border border-border overflow-hidden">
          {/* Table Header */}
          <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_auto] gap-4 px-5 py-3 border-b border-border bg-backdrop">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Case</span>
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">MRN</span>
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Status</span>
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider sr-only">Actions</span>
          </div>

          {/* Table Rows */}
          <div className="divide-y divide-border">
            {entries.map((entry: CaseEntryRow) => {
              const template = Array.isArray(entry.case_templates) ? entry.case_templates[0] : entry.case_templates;
              return (
                <div
                  key={entry.id}
                  className="sm:grid sm:grid-cols-[2fr_1fr_1fr_auto] gap-4 px-5 py-3.5 flex flex-col hover:bg-neutral-dark transition-colors"
                >
                  {/* Case info */}
                  <div className="min-w-0">
                    <Link
                      href={`/${tenantSlug}/cases/${entry.id}`}
                      className="text-sm font-medium text-text-primary truncate hover:text-primary transition-colors focus-visible:outline-none focus-visible:underline"
                    >
                      {template?.specialty}{template?.name ? ` — ${template.name}` : ''}
                    </Link>
                    <p className="text-xs text-text-muted mt-0.5 sm:hidden">{entry.case_date}</p>
                  </div>

                  {/* MRN */}
                  <div className="sm:flex items-center hidden">
                    <span className="text-sm text-text-secondary tabular-nums">
                      {entry.patient_mrn || '—'}
                    </span>
                  </div>
                  <div className="sm:hidden text-xs text-text-muted">
                    MRN: {entry.patient_mrn || '—'}
                  </div>

                  {/* Status + Date (mobile) */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted sm:hidden">{entry.case_date}</span>
                    <StatusBadge status={statusToVariant(entry.status)} size="sm" />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/${tenantSlug}/cases/${entry.id}`}
                      className="px-3 py-1.5 rounded-full text-xs font-medium text-primary hover:bg-primary/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      View
                    </Link>
                    {entry.resident_id === auth.profile.id && (
                      <Link
                        href={`/${tenantSlug}/cases/new?duplicateFrom=${entry.id}`}
                        className="px-3 py-1.5 rounded-full text-xs font-medium text-text-muted hover:bg-neutral-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        Duplicate
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
          <div className="flex items-center justify-between">
          <p className="text-sm text-text-muted">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/${tenantSlug}/cases?page=${page - 1}${searchFilter ? `&search=${encodeURIComponent(searchFilter)}` : ''}${statusFilter ? `&status=${Array.isArray(statusFilter) ? statusFilter.map(s => encodeURIComponent(s)).join('&status=') : encodeURIComponent(statusFilter)}` : ''}${sortFilter && sortFilter !== 'date_desc' ? `&sort=${encodeURIComponent(sortFilter)}` : ''}`}
                className="px-4 py-2 rounded-full text-sm font-medium text-text-secondary bg-surface-solid border border-border hover:bg-neutral-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/${tenantSlug}/cases?page=${page + 1}${searchFilter ? `&search=${encodeURIComponent(searchFilter)}` : ''}${statusFilter ? `&status=${Array.isArray(statusFilter) ? statusFilter.map(s => encodeURIComponent(s)).join('&status=') : encodeURIComponent(statusFilter)}` : ''}${sortFilter && sortFilter !== 'date_desc' ? `&sort=${encodeURIComponent(sortFilter)}` : ''}`}
                className="px-4 py-2 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Next Page
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
