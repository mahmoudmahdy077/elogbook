import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader, Chip } from '@heroui/react';
import { notFound } from 'next/navigation';
import ApprovalActions from '@/components/ApprovalActions';

export default async function ApprovalsPage({ params }: { params: { tenant: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id')
    .eq('user_id', user.id)
    .single();

  if (!profile || !['supervisor', 'director', 'admin'].includes(profile.role)) notFound();

  const { data: requests } = await supabase
    .from('approval_requests')
    .select(`
      id,
      entry_id,
      requested_at,
      case_entries!inner(
        id,
        patient_mrn,
        patient_dob,
        case_date,
        field_values,
        case_templates(name, specialty),
        profiles!case_entries_resident_id_fkey(full_name)
      )
    `)
    .eq('supervisor_id', profile.id)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Pending Approvals</h1>

      {(!requests || requests.length === 0) ? (
        <Card>
          <CardBody>
            <p className="text-default-500">No pending approvals.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => {
            const entry = r.case_entries as any;
            return (
              <Card key={r.id}>
                <CardHeader className="flex justify-between">
                  <div>
                    <h3 className="font-semibold">
                      {entry?.case_templates?.specialty} — {entry?.case_templates?.name}
                    </h3>
                    <p className="text-sm text-default-500">
                      Resident: {entry?.profiles?.full_name} | Date: {entry?.case_date}
                    </p>
                  </div>
                  <Chip color="primary" size="sm">Pending</Chip>
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                    <div><span className="text-default-500">MRN:</span> {entry?.patient_mrn}</div>
                    <div><span className="text-default-500">DOB:</span> {entry?.patient_dob}</div>
                  </div>
                  {entry?.field_values && typeof entry.field_values === 'object' && (
                    <div className="space-y-1 mb-4 text-sm">
                      {Object.entries(entry.field_values as Record<string, unknown>).map(([k, v]) => (
                        <div key={k} className="flex justify-between border-b border-divider py-1">
                          <span className="text-default-500">{k.replace(/_/g, ' ')}</span>
                          <span>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <ApprovalActions requestId={r.id} entryId={entry.id} tenant={params.tenant} />
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
