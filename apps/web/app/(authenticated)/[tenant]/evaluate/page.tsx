import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import ErrorDisplay from '@/components/ErrorDisplay';

export default async function EvaluatePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');

  const supabase = await createServerSupabase();
  const { profile } = auth;

  if (profile.role === 'resident') redirect(`/${tenantSlug}/dashboard`);

  const { data: residents, error } = await supabase
    .from('profiles')
    .select('id, full_name, specialty')
    .eq('tenant_id', profile.tenant_id)
    .eq('role', 'resident');

  if (error) return <ErrorDisplay message={error.message} />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Evaluate Residents</h1>
      {residents && residents.length > 0 ? (
        <div className="grid gap-3">
          {residents.map((r: { id: string; full_name: string; specialty: string | null }) => (
            <Link
              key={r.id}
              href={`/${tenantSlug}/evaluate/resident/${r.id}`}
              className="panel p-4 hover:bg-neutral-dark/50 transition-colors"
            >
              <p className="font-medium">{r.full_name}</p>
              <p className="text-xs text-neutral-light/50">{r.specialty || ' — '}</p>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-neutral-light/50">No residents in your program.</p>
      )}
    </div>
  );
}