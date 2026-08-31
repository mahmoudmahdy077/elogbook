import { getAuthContext } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import ErrorDisplay from '@/components/ErrorDisplay';
import WhiteLabelForm from './WhiteLabelForm';

export default async function WhiteLabelPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: tenantSlug } = await params;
  const auth = await getAuthContext();

  if (auth.tenant.slug !== tenantSlug) redirect('/login');
  if (!['director', 'institution_admin', 'admin'].includes(auth.profile.role)) {
    redirect(`/${tenantSlug}/dashboard`);
  }

  const supabase = await createServerSupabase();
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name, slug, custom_branding')
    .eq('id', auth.profile.tenant_id)
    .single();

  if (tenantError) {
    return <ErrorDisplay message={tenantError.message} />;
  }

  const branding = (tenant as unknown as { custom_branding?: Record<string, unknown> })?.custom_branding ?? {};

  // Check if plan includes custom_branding for informational banner (non-blocking)
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('subscription_plans!inner(features)')
    .eq('tenant_id', auth.profile.tenant_id)
    .eq('status', 'active')
    .maybeSingle();
  const features = (sub as unknown as { subscription_plans?: { features?: Record<string, unknown> } | null })?.subscription_plans?.features ?? null;
  const hasBrandingFeature = Boolean(features?.custom_branding);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">White-Label Branding</h1>
          <p className="text-sm text-text-muted mt-1">
            Customize logo and primary color for {tenantSlug}. Stored in <code className="text-xs bg-muted px-1 py-0.5 rounded">tenants.custom_branding</code> (JSONB).
          </p>
        </div>
        <Link href={`/${tenantSlug}/admin`} className="text-sm text-primary hover:underline">
          ← Back to Admin
        </Link>
      </div>

      {!hasBrandingFeature && (
        <div className="panel p-4 mb-6 border border-amber-500/20 bg-amber-500/5">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Custom branding is an Enterprise feature. You can still configure it here; it will apply when your plan is upgraded. Self-serve theming roadmap: logo upload &amp; CSS variable theming.
          </p>
        </div>
      )}

      <WhiteLabelForm
        tenantSlug={tenantSlug}
        tenantId={auth.profile.tenant_id}
        initialBranding={branding as Record<string, string>}
      />

      <div className="panel p-4 mt-6">
        <h2 className="text-sm font-medium mb-2">Current branding JSON</h2>
        <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-48">{JSON.stringify(branding, null, 2)}</pre>
        <p className="text-xs text-text-muted mt-2">
          Roadmap: self-serve logo upload (Supabase Storage), font selection, and email footer branding. Contact support for custom domain.
        </p>
      </div>
    </div>
  );
}
