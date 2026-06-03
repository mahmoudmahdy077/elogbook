import { createServerSupabase } from '@/lib/supabase/server';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Button,
} from '@heroui/react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

const statusColorMap: Record<string, 'warning' | 'primary' | 'success' | 'danger'> = {
  draft: 'warning',
  pending: 'primary',
  approved: 'success',
  rejected: 'danger',
};

export default async function CasesPage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, user_id, tenant_id, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenant = profile.tenants as unknown as { slug: string; tenant_type: string };
  if (tenant.slug !== params.tenant) redirect('/login');

  const { data: entries, error } = await supabase
    .from('case_entries')
    .select('id, case_date, patient_mrn, status, case_templates!inner(name, specialty)')
    .eq('resident_id', profile.id)
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">My Cases</h1>
        <p className="text-danger">Failed to load cases: {error.message}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">My Cases</h1>
        <Button as={Link} href={`/${params.tenant}/cases/new`} color="primary">
          Log New Case
        </Button>
      </div>

      {(!entries || entries.length === 0) ? (
        <div className="text-center py-12 text-default-500">
          <p className="text-lg">No cases logged yet.</p>
          <p className="text-sm mt-1">Click &quot;Log New Case&quot; to get started.</p>
        </div>
      ) : (
        <Table aria-label="Case entries table">
          <TableHeader>
            <TableColumn>Date</TableColumn>
            <TableColumn>Template</TableColumn>
            <TableColumn>MRN</TableColumn>
            <TableColumn>Status</TableColumn>
            <TableColumn>Actions</TableColumn>
          </TableHeader>
          <TableBody>
            {entries.map((entry: any) => (
              <TableRow key={entry.id}>
                <TableCell>{entry.case_date}</TableCell>
                <TableCell>
                  {entry.case_templates?.specialty} - {entry.case_templates?.name}
                </TableCell>
                <TableCell>{entry.patient_mrn}</TableCell>
                <TableCell>
                  <Chip color={statusColorMap[entry.status] || 'default'} variant="flat" size="sm">
                    {entry.status}
                  </Chip>
                </TableCell>
                <TableCell>
                  <Button
                    as={Link}
                    href={`/${params.tenant}/cases/${entry.id}`}
                    variant="light"
                    size="sm"
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
