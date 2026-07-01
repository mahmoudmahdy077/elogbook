import { getAuthContext, type UserRole } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Table,
  Chip,
  Button,
} from '@heroui/react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';
import EmptyState from '@/components/EmptyState';

type CaseEntryRow = {
  id: string;
  case_date: string;
  patient_mrn: string | null;
  status: string;
  resident_id: string;
  case_templates: { name: string; specialty: string } | { name: string; specialty: string }[];
};

const PAGE_SIZE = 20;

export default async function CasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const { page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);

  const auth = await getAuthContext();
  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();
  const offset = (page - 1) * PAGE_SIZE;

  // U4.4: residents see only their own cases; supervisors+ see all
  // tenant cases. Previously the page filtered by resident_id for
  // every role, leaving supervisors with an empty list outside the
  // approvals queue.
  const isResident = auth.profile.role === 'resident';

  let casesQuery = supabase
    .from('case_entries')
    .select('id, case_date, patient_mrn, status, resident_id, case_templates!inner(name, specialty)', { count: 'exact' })
    .eq('tenant_id', auth.profile.tenant_id);
  if (isResident) casesQuery = casesQuery.eq('resident_id', auth.profile.id);
  const { data: entries, error, count } = await casesQuery
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">My Cases</h1>
        <ErrorDisplay message={error.message} />
      </div>
    );
  }

  const totalPages = Math.ceil((count || 0) / PAGE_SIZE);

  const statusColorMap: Record<string, 'warning' | 'accent' | 'success' | 'danger'> = {
    draft: 'warning',
    pending: 'accent',
    approved: 'success',
    rejected: 'danger',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Cases</h1>
        <Link href={`/${tenantSlug}/cases/new`}>
          <Button variant="primary">
            Log New Case
          </Button>
        </Link>
      </div>

      {(!entries || entries.length === 0) ? (
        <EmptyState
          icon={
            <svg className="w-5 h-5 text-neutral-light/50" viewBox="0 0 20 20" fill="currentColor">
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
        <div className="panel p-4 overflow-x-auto">
        <Table.Root aria-label="Case entries table" variant="primary">
          <Table.Content>
          <Table.Header>
            <Table.Column id="date">Date</Table.Column>
            <Table.Column id="template">Template</Table.Column>
            <Table.Column id="mrn">MRN</Table.Column>
            <Table.Column id="status">Status</Table.Column>
            <Table.Column id="actions">Actions</Table.Column>
          </Table.Header>
          <Table.Body>
            {entries.map((entry: CaseEntryRow) => {
              const template = Array.isArray(entry.case_templates) ? entry.case_templates[0] : entry.case_templates;
              return (
              <Table.Row key={entry.id} id={entry.id}>
                <Table.Cell className="clinical-data">{entry.case_date}</Table.Cell>
                <Table.Cell>
                  {template?.specialty} - {template?.name}
                </Table.Cell>
                <Table.Cell className="clinical-data">{entry.patient_mrn}</Table.Cell>
                <Table.Cell>
                  <Chip color={statusColorMap[entry.status] || 'default'} variant="soft" size="sm">
                    {entry.status}
                  </Chip>
                </Table.Cell>
                <Table.Cell>
                  <div className="flex gap-1">
                    <Link href={`/${tenantSlug}/cases/${entry.id}`}>
                      <Button variant="ghost" size="sm">View</Button>
                    </Link>
                    {entry.resident_id === auth.profile.id && (
                      <Link href={`/${tenantSlug}/cases/new?duplicateFrom=${entry.id}`}>
                        <Button variant="ghost" size="sm">Duplicate</Button>
                      </Link>
                    )}
                  </div>
                </Table.Cell>
              </Table.Row>
            )})}
          </Table.Body>
          </Table.Content>
        </Table.Root>
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-divider">
            <p className="text-sm text-default-500">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/${tenantSlug}/cases?page=${page - 1}`}>
                  <Button variant="ghost" size="sm">Previous</Button>
                </Link>
              )}
              {page < totalPages && (
                <Link href={`/${tenantSlug}/cases?page=${page + 1}`}>
                  <Button variant="primary" size="sm">Next Page</Button>
                </Link>
              )}
            </div>
          </div>
        )}
        </div>
      )}
    </div>
  );
}