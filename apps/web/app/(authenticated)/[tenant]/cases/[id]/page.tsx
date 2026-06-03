import { createServerSupabase } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { Card, CardBody, CardHeader, Chip, Button } from '@heroui/react';
import Link from 'next/link';

const statusColorMap: Record<string, 'warning' | 'primary' | 'success' | 'danger'> = {
  draft: 'warning',
  pending: 'primary',
  approved: 'success',
  rejected: 'danger',
};

export default async function CaseDetailPage({
  params,
}: {
  params: { tenant: string; id: string };
}) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, full_name, tenants!inner(slug, tenant_type)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenant = profile.tenants as unknown as { slug: string; tenant_type: string };
  if (tenant.slug !== params.tenant) redirect('/login');

  const { data: entry, error } = await supabase
    .from('case_entries')
    .select(`
      id, case_date, patient_mrn, patient_dob, field_values, status, created_at, updated_at,
      case_templates!inner(name, specialty, fields),
      profiles!case_entries_resident_id_fkey(full_name)
    `)
    .eq('id', params.id)
    .single();

  if (error || !entry) {
    notFound();
  }

  const template = entry.case_templates as unknown as {
    name: string;
    specialty: string;
    fields: { key?: string; name?: string; label: string; type: string; options?: string[] }[];
  };
  const resident = entry.profiles as unknown as { full_name: string };

  const getFieldKey = (f: { key?: string; name?: string }) => f.key || f.name || '';
  const templateFields = template.fields || [];

  const fieldValues = entry.field_values as Record<string, unknown>;

  const { data: approvals } = await supabase
    .from('approval_requests')
    .select('id, status, comment, requested_at, resolved_at, profiles(full_name)')
    .eq('entry_id', entry.id)
    .order('requested_at', { ascending: false });

  const showSubmitButton = entry.status === 'draft';

  return (
    <div>
      <Card className="mb-6">
        <CardHeader className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold">
              {template.specialty} - {template.name}
            </h1>
            <p className="text-sm text-default-500">by {resident.full_name}</p>
          </div>
          <Chip color={statusColorMap[entry.status] || 'default'} variant="flat">
            {entry.status}
          </Chip>
        </CardHeader>
        <CardBody className="gap-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-default-500">Case Date</p>
              <p className="font-medium">{entry.case_date}</p>
            </div>
            <div>
              <p className="text-sm text-default-500">Patient MRN</p>
              <p className="font-medium">{entry.patient_mrn}</p>
            </div>
            <div>
              <p className="text-sm text-default-500">Patient DOB</p>
              <p className="font-medium">{entry.patient_dob}</p>
            </div>
          </div>

          {templateFields.length > 0 && (
            <div className="border-t pt-4 mt-2">
              <h3 className="font-semibold mb-3">Case Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {templateFields.map((field) => {
                  const key = getFieldKey(field);
                  const value = fieldValues[key];
                  const displayValue =
                    value === null || value === undefined
                      ? '—'
                      : typeof value === 'boolean'
                        ? value ? 'Yes' : 'No'
                        : String(value);

                  return (
                    <div key={key}>
                      <p className="text-sm text-default-500">{field.label}</p>
                      <p className="font-medium">{displayValue}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {showSubmitButton && (
        <div className="mb-6">
          <form action={`/${params.tenant}/cases/${params.id}/submit`} method="POST">
            <Button type="submit" color="primary">
              Submit for Approval
            </Button>
          </form>
        </div>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Approval History</h2>
        </CardHeader>
        <CardBody>
          {!approvals || approvals.length === 0 ? (
            <p className="text-default-500 text-sm">No approval requests yet.</p>
          ) : (
            <div className="space-y-3">
              {(approvals as any[]).map((approval) => (
                <div key={approval.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">
                      {approval.profiles?.full_name || 'Unknown'}
                    </p>
                    <Chip
                      color={
                        approval.status === 'approved'
                          ? 'success'
                          : approval.status === 'rejected'
                            ? 'danger'
                            : 'warning'
                      }
                      variant="flat"
                      size="sm"
                    >
                      {approval.status}
                    </Chip>
                  </div>
                  {approval.comment && (
                    <p className="text-sm text-default-600 mt-1">{approval.comment}</p>
                  )}
                  <p className="text-xs text-default-400 mt-1">
                    Requested: {new Date(approval.requested_at).toLocaleDateString()}
                    {approval.resolved_at &&
                      ` · Resolved: ${new Date(approval.resolved_at).toLocaleDateString()}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
