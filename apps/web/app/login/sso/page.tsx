import { createServerSupabase } from '@/lib/supabase/server';
import { safeRelativePath } from '@/lib/safe-redirect';
import { Button } from '@heroui/react';
import { redirect } from 'next/navigation';

interface SsoLookupResult {
  id: string;
  protocol: 'saml' | 'oidc';
  metadata_url: string | null;
  discovery_url: string | null;
  is_active: boolean;
}

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

function buildSsoCallbackUrl(tenantSlug: string, cfg: SsoLookupResult, next: string): string {
  const params = new URLSearchParams();
  params.set('tenant', tenantSlug);
  if (cfg.protocol === 'oidc' && cfg.discovery_url) {
    params.set('discovery', cfg.discovery_url);
  }
  if (cfg.protocol === 'saml' && cfg.metadata_url) {
    params.set('metadata', cfg.metadata_url);
  }
  params.set('next', next);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return `${base}/functions/v1/sso-callback?${params.toString()}`;
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
      <div className="flex min-h-screen items-center justify-center bg-backdrop p-4">
        <form
          action="/login/sso"
          method="get"
          className="w-full max-w-md panel p-8 space-y-4"
        >
          <h1 className="text-2xl font-heading font-bold text-center">Sign in with SSO</h1>
          <p className="text-sm text-neutral-light/60 text-center">
            Enter your institution slug to continue.
          </p>
          <div>
            <label htmlFor="tenant" className="block text-sm font-medium mb-1.5">
              Institution Slug
            </label>
            <input
              id="tenant"
              name="tenant"
              type="text"
              required
              autoFocus
              placeholder="acme-medical"
              className="w-full px-3 py-2 rounded-lg bg-neutral-dark border border-border text-neutral-light placeholder:text-neutral-light/30 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary-glow text-sm"
            />
          </div>
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="primary" className="w-full">
            Continue
          </Button>
        </form>
      </div>
    );
  }

  const cfg = await lookupSsoForTenant(tenantSlug);
  if (!cfg) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-backdrop p-4">
        <div className="w-full max-w-md panel p-8 text-center space-y-3">
          <h1 className="text-2xl font-heading font-bold">SSO Unavailable</h1>
          <p className="text-sm text-neutral-light/60">
            No active SSO configuration was found for <code>{tenantSlug}</code>.
          </p>
          <a href="/login" className="text-sm text-primary hover:underline">
            Back to sign-in
          </a>
        </div>
      </div>
    );
  }

  redirect(buildSsoCallbackUrl(tenantSlug, cfg, next));
}
