import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ReflectionsJournal, {
  type ReflectionRow,
} from '@/components/ReflectionsJournal';

export default async function ReflectionsPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const isLeadership = ['director', 'institution_admin', 'admin'].includes(
    auth.profile.role
  );

  const supabase = await createServerSupabase();

  // Own reflections: every role. RLS additionally gates rows, so the author
  // filter is defense-in-depth rather than the only boundary.
  // Shared-with-leadership: fetched only for director/admin roles.
  const reflectionsQuery = supabase
    .from('reflections')
    .select(
      'id, author_id, case_id, reflection_type, title, body, prompt, shared, created_at' +
        (isLeadership ? ', profiles(full_name)' : '')
    )
    .eq('tenant_id', auth.profile.tenant_id)
    .order('created_at', { ascending: false });

  const { data: reflections, error: reflectionsError } = await reflectionsQuery;

  if (reflectionsError) {
    throw new Error(`Reflections fetch failed: ${reflectionsError.message}`);
  }

  // Leadership sees own + shared; other roles only their own rows.
  const typedRows = (reflections ?? []) as unknown as ReflectionRow[];
  const rows = typedRows.filter(
    (r) => r.author_id === auth.profile.id || isLeadership
  );

  return (
    <ReflectionsJournal
      tenantId={auth.profile.tenant_id}
      authorId={auth.profile.id}
      isLeadership={isLeadership}
      reflections={rows}
    />
  );
}
