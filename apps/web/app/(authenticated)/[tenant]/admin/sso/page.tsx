import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import SSOManager from '@/components/SSOManager';
import ErrorDisplay from '@/components/ErrorDisplay';

export default async function AdminSsoPage({
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

  // Fetch SSO configs using service role (bypass RLS)
  const adminClient = createServiceRoleClient();
  const { data: configs, error: configsError } = await adminClient
    .from('tenant_sso_configs')
    .select('id, protocol, metadata_url, discovery_url, idp_entity_id, client_id, default_role, is_active, created_at, updated_at')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  if (configsError) {
    return <ErrorDisplay message={configsError.message} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">SSO Configuration</h1>
        <Link
          href={`/${tenantSlug}/admin`}
          className="text-sm text-primary hover:underline"
        >
          ← Back to Admin
        </Link>
      </div>
      <SSOManager
        tenantId={profile.tenant_id}
        tenantSlug={tenantSlug}
        initialConfigs={configs ?? []}
      />
    </div>
  );
}
