import { createServerSupabase } from '@/lib/supabase/server';
import {
  Table,
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

export default async function CasesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
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
  if (tenant.slug !== tenantSlug) redirect('/login');

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
        <Link href={`/${tenantSlug}/cases/new`}>
          <Button color="primary">
            Log New Case
          </Button>
        </Link>
      </div>

      {(!entries || entries.length === 0) ? (
        <div className="text-center py-12 text-default-500">
          <p className="text-lg">No cases logged yet.</p>
          <p className="text-sm mt-1">Click &quot;Log New Case&quot; to get started.</p>
        </div>
      ) : (
        <div className="panel p-4">
        <Table aria-label="Case entries table">
          <Table.Header>
            <Table.Column>Date</Table.Column>
            <Table.Column>Template</Table.Column>
            <Table.Column>MRN</Table.Column>
            <Table.Column>Status</Table.Column>
            <Table.Column>Actions</Table.Column>
          </Table.Header>
          <Table.Body>
            {entries.map((entry: any) => (
              <Table.Row key={entry.id}>
                <Table.Cell className="clinical-data">{entry.case_date}</Table.Cell>
                <Table.Cell>
                  {entry.case_templates?.specialty} - {entry.case_templates?.name}
                </Table.Cell>
                <Table.Cell className="clinical-data">{entry.patient_mrn}</Table.Cell>
                <Table.Cell>
                  <Chip color={statusColorMap[entry.status] || 'default'} variant="flat" size="sm" className={`badge-${entry.status}`}>
                    {entry.status}
                  </Chip>
                </Table.Cell>
                <Table.Cell>
                  <Link href={`/${tenantSlug}/cases/${entry.id}`}>
                    <Button
                      variant="light"
                      size="sm"
                    >
                      View
                    </Button>
                  </Link>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
        </div>
      )}
    </div>
  );
}
