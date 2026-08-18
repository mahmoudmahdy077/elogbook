import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';
import CaseEditForm from '@/components/CaseEditForm';

export default async function CaseEditPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: tenantSlug, id } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();

  const { data: entry, error: entryError } = await supabase
    .from('case_entries')
    .select(`
      *,
      case_templates(name, specialty, fields)
    `)
    .eq('id', id)
    .single();

  if (entryError) {
    return <ErrorDisplay message={entryError.message} />;
  }

  if (!entry) notFound();

  // Only the resident who owns the case can edit it
  if (entry.resident_id !== auth.profile.id) notFound();

  // Only draft cases can be edited
  if (entry.status !== 'draft') {
    return <ErrorDisplay message="Only draft cases can be edited." />;
  }

  return (
    <CaseEditForm
      entry={entry}
      tenantSlug={tenantSlug}
    />
  );
}
