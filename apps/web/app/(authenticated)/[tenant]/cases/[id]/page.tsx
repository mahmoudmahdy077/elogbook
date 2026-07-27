import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';
import { PhiFields } from '@/components/PhiFields';

export default async function CaseDetailPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: tenantSlug, id } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();

  const { data: entry, error: entryError } = await supabase
    .from('case_entries')
    .select(`
      *,
      case_templates(name, specialty, fields),
      profiles!case_entries_resident_id_fkey(full_name),
      tenants(tenant_type)
    `)
    .eq('id', id)
    .single();

  if (entryError) {
    return <ErrorDisplay message={entryError.message} />;
  }

  if (!entry) notFound();

  const isResident = auth.profile.role === 'resident';
  if (isResident && entry.resident_id !== auth.profile.id) notFound();
  if (!isResident && entry.tenant_id !== auth.tenant.id) notFound();

  const { data: approvals, error: approvalsError } = await supabase
    .from('approval_requests')
    .select('*, profiles(full_name)')
    .eq('entry_id', id)
    .order('requested_at', { ascending: false });

  if (approvalsError) {
    return <ErrorDisplay message={approvalsError.message} />;
  }

  const statusColor = (s: string) => {
    switch (s) {
      case 'draft': return 'bg-warning/10 text-warning';
      case 'pending': return 'bg-primary/10 text-primary';
      case 'approved': return 'bg-success/10 text-success';
      case 'rejected': return 'bg-danger/10 text-danger';
      default: return 'bg-default-100 text-text-muted';
    }
  };

  const approvalStatusColor = (s: string) => {
    switch (s) {
      case 'approved': return 'bg-success/10 text-success';
      case 'rejected': return 'bg-danger/10 text-danger';
      default: return 'bg-primary/10 text-primary';
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* U5.5: PHI/confidentiality banner. De-identified cases show that
          the MRN/DOB are intentionally blank; identified cases warn the
          viewer that the data is sensitive (HIPAA). */}
      {entry.is_deidentified ? (
        <div className="bg-pending/10 border border-pending/30 text-pending text-xs rounded-lg p-2.5" role="status">
          This case is de-identified. Patient MRN and DOB are not stored; a hash is used for matching.
        </div>
      ) : (
        <div className="bg-danger/10 border border-danger/30 text-danger text-xs rounded-lg p-2.5" role="status">
          <strong>PHI:</strong> This case contains identified patient data. Handle with care per HIPAA guidelines.
        </div>
      )}
      <div className="panel">
        <div className="flex justify-between items-center pb-4 border-b border-border">
          <div>
            <h1 className="text-xl font-bold">
              {entry.case_templates?.specialty} — {entry.case_templates?.name}
            </h1>
            <p className="text-sm text-text-muted">Logged by {entry.profiles?.full_name}</p>
          </div>
          <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(entry.status)}`}>
            {entry.status}
          </span>
        </div>
        <div className="pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <PhiFields
              mrn={entry.patient_mrn}
              dob={entry.patient_dob}
              entryId={entry.id}
              tenantId={auth.tenant.id}
              userId={auth.profile.id}
            />
            <div>
              <dl><dt className="text-text-muted text-xs font-medium uppercase tracking-wider">Case Date</dt><dd className="text-text-primary">{entry.case_date}</dd></dl>
            </div>
          </div>

          <div>
            <dt className="text-text-muted text-xs font-medium uppercase tracking-wider">Case Details</dt>
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
            <form action={`/${tenantSlug}/cases/${id}/submit`} method="POST">
              <button
                type="submit"
                className="rounded-full bg-primary text-text-on-primary px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Submit for Approval
              </button>
            </form>
          )}
          <div className="pt-4">
            <Link
              href={`/${tenantSlug}/cases/new?duplicateFrom=${entry.id}`}
              className="inline-flex items-center rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
            >
              Duplicate
            </Link>
          </div>
        </div>
      </div>

      {approvals && approvals.length > 0 && (
        <div className="panel">
          <div className="pb-4 border-b border-border">
            <h2 className="text-lg font-semibold">Approval History</h2>
          </div>
          <div className="pt-4">
            <div className="space-y-3">
              {approvals.map((a: { id: string; supervisor_id: string; status: string; comment: string | null; resolved_at: string | null; profiles?: { full_name?: string } }) => (
                <div
                  key={a.id}
                  className="flex justify-between items-center border-b border-divider pb-2"
                >
                  <div>
                    <p className="font-medium">{a.profiles?.full_name}</p>
                    <p className="text-sm text-text-muted">
                      {a.comment || 'No comment'}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${approvalStatusColor(a.status)}`}
                  >
                    {a.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
