import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import SCIManager from '@/components/SCIManager';
import ErrorDisplay from '@/components/ErrorDisplay';

export default async function AdminScimPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) redirect('/login');

  const tenants = profile.tenants as { slug: string }[];
  const tenant = tenants[0];
  if (!tenant || tenant.slug !== tenantSlug) redirect('/login');

  if (!['director', 'institution_admin', 'admin'].includes(profile.role)) {
    redirect('/login');
  }

  // Fetch SCIM tokens using service role (bypass RLS)
  const adminClient = createServiceRoleClient();
  const { data: tokens, error: tokensError } = await adminClient
    .from('scim_tokens')
    .select('id, tenant_id, description, created_by, created_at, last_used_at, revoked_at')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  if (tokensError) {
    return <ErrorDisplay message={tokensError.message} />;
  }

  // Determine the SCIM base URL from Supabase URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const scimUrl = supabaseUrl
    ? `${supabaseUrl}/functions/v1/scim/scim/v2`
    : '';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">SCIM Provisioning</h1>
        <Link
          href={`/${tenantSlug}/admin`}
          className="text-sm text-primary hover:underline"
        >
          ← Back to Admin
        </Link>
      </div>
      <SCIManager
        tenantId={profile.tenant_id}
        tenantSlug={tenantSlug}
        initialTokens={tokens ?? []}
        initialScimUrl={scimUrl}
      />
    </div>
  );
}
