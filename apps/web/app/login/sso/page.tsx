import { createServerSupabase } from '@/lib/supabase/server';
import { safeRelativePath } from '@/lib/safe-redirect';
import { buildSsoCallbackUrl, type SsoLookupResult } from '@/lib/sso';
import { redirect } from 'next/navigation';
import { APP_NAME } from '@elogbook/shared';

async function lookupSsoForTenant(tenantSlug: string): Promise<SsoLookupResult | null> {
  const supabase = await createServerSupabase();
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .maybeSingle();
  if (tenantError || !tenant) return null;

  const { data: cfg, error: cfgError } = await supabase
    .from('tenant_sso_configs')
    .select('id, protocol, metadata_url, discovery_url, is_active')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .maybeSingle();
  if (cfgError || !cfg) return null;
  return cfg as SsoLookupResult;
}

export default async function SsoPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant?: string[] }>;
  searchParams: Promise<{ tenant?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const p = await params;
  const tenantSlug = sp.tenant ?? p.tenant?.[0] ?? '';
  const next = safeRelativePath(sp.next);

  if (!tenantSlug) {
    return (
      <div className="min-h-dvh bg-backdrop flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <h1 className="text-xl sm:text-2xl font-heading font-bold text-text-primary">{APP_NAME}</h1>
            <p className="text-sm text-text-muted mt-1">Sign in with SSO</p>
          </div>

          <div className="bg-surface-solid border border-border rounded-2xl p-6 sm:p-8">
            <p className="text-sm text-text-muted mb-4">Enter your institution slug to continue.</p>
            <form action="/login/sso" method="get" className="space-y-4">
              <div>
                <label htmlFor="tenant" className="block text-sm font-medium mb-1.5 text-text-primary">
                  Institution Slug
                </label>
                <input
                  id="tenant"
                  name="tenant"
                  type="text"
                  required
                  autoFocus
                  placeholder="acme-medical"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-dark border border-border text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary-glow/50 text-sm transition-colors"
                />
              </div>
              <input type="hidden" name="next" value={next} />
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-primary text-white font-medium text-sm hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-glow"
              >
                Continue
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const cfg = await lookupSsoForTenant(tenantSlug);
  if (!cfg) {
    return (
      <div className="min-h-dvh bg-backdrop flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-surface-solid border border-border rounded-2xl p-6 sm:p-8 text-center space-y-3">
            <h1 className="text-lg font-heading font-semibold text-text-primary">SSO Unavailable</h1>
            <p className="text-sm text-text-muted">
              No active SSO configuration was found for <code className="text-text-primary">{tenantSlug}</code>.
            </p>
            <a href="/login" className="inline-block text-sm text-primary hover:underline">Back to sign-in</a>
          </div>
        </div>
      </div>
    );
  }

   const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
   redirect(buildSsoCallbackUrl(supabaseUrl, tenantSlug, cfg, next));
}
