import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader, Chip, Button } from '@heroui/react';
import { notFound } from 'next/navigation';

export default async function CaseDetailPage({ params }: { params: { tenant: string; id: string } }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: entry } = await supabase
    .from('case_entries')
    .select(`
      *,
      case_templates(name, specialty, fields),
      profiles!case_entries_resident_id_fkey(full_name),
      tenants(tenant_type)
    `)
    .eq('id', params.id)
    .single();

  if (!entry) notFound();

  const { data: approvals } = await supabase
    .from('approval_requests')
    .select('*, profiles(full_name)')
    .eq('entry_id', params.id)
    .order('requested_at', { ascending: false });

  const statusColor = (s: string) => {
    switch (s) {
      case 'draft': return 'warning' as const;
      case 'pending': return 'primary' as const;
      case 'approved': return 'success' as const;
      case 'rejected': return 'danger' as const;
      default: return 'default' as const;
    }
  };

  const approvalStatusColor = (s: string) => {
    switch (s) {
      case 'approved': return 'success' as const;
      case 'rejected': return 'danger' as const;
      default: return 'primary' as const;
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader className="flex justify-between">
          <div>
            <h1 className="text-xl font-bold">
              {entry.case_templates?.specialty} — {entry.case_templates?.name}
            </h1>
            <p className="text-sm text-default-500">Logged by {entry.profiles?.full_name}</p>
          </div>
          <Chip color={statusColor(entry.status)} variant="flat">{entry.status}</Chip>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-default-500">Patient MRN</label>
              <p>{entry.patient_mrn}</p>
            </div>
            <div>
              <label className="text-sm text-default-500">Patient DOB</label>
              <p>{entry.patient_dob}</p>
            </div>
            <div>
              <label className="text-sm text-default-500">Case Date</label>
              <p>{entry.case_date}</p>
            </div>
          </div>

          <div>
            <label className="text-sm text-default-500 block mb-2">Case Details</label>
            {Array.isArray(entry.case_templates?.fields) &&
              (entry.case_templates.fields as Record<string, unknown>[]).map((f) => (
                <div key={f.key as string} className="flex justify-between py-1 border-b border-divider">
                  <span className="text-sm">{f.label as string}</span>
                  <span className="text-sm font-medium">
                    {String(
                      (entry.field_values as Record<string, unknown>)[f.key as string] ?? '—'
                    )}
                  </span>
                </div>
              ))}
          </div>

          {entry.status === 'draft' && (
            <form action={`/${params.tenant}/cases/${params.id}/submit`} method="POST">
              <Button type="submit" color="primary">
                Submit for Approval
              </Button>
            </form>
          )}
        </CardBody>
      </Card>

      {approvals && approvals.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Approval History</h2>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              {approvals.map((a) => (
                <div
                  key={a.id}
                  className="flex justify-between items-center border-b border-divider pb-2"
                >
                  <div>
                    <p className="font-medium">{a.profiles?.full_name}</p>
                    <p className="text-sm text-default-500">
                      {a.comment || 'No comment'}
                    </p>
                  </div>
                  <Chip
                    color={approvalStatusColor(a.status)}
                    size="sm"
                    variant="flat"
                  >
                    {a.status}
                  </Chip>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
