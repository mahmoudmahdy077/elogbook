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
      <div className="min-h-dvh bg-[#F2F2F7] flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <h1 className="text-xl sm:text-2xl font-heading font-bold text-black">{APP_NAME}</h1>
            <p className="text-sm text-[#8E8E93] mt-1">Sign in with SSO</p>
          </div>

          <div className="bg-white border border-black/5 rounded-2xl p-6 sm:p-8">
            <p className="text-sm text-[#8E8E93] mb-4">Enter your institution slug to continue.</p>
            <form action="/login/sso" method="get" className="space-y-4">
              <div>
                <label htmlFor="tenant" className="block text-sm font-medium mb-1.5 text-black">
                  Institution Slug
                </label>
                <input
                  id="tenant"
                  name="tenant"
                  type="text"
                  required
                  autoFocus
                  placeholder="acme-medical"
                  className="w-full px-4 py-3 rounded-xl bg-white border border-black/10 text-black placeholder:text-[#8E8E93]/60 focus:outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[rgba(0,122,255,0.12)] text-[15px] transition-colors"
                />
              </div>
              <input type="hidden" name="next" value={next} />
              <button
                type="submit"
                className="w-full py-3 rounded-full bg-[#007AFF] text-white font-medium text-sm hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,122,255,0.2)]"
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
      <div className="min-h-dvh bg-[#F2F2F7] flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="bg-white border border-black/5 rounded-2xl p-6 sm:p-8 text-center space-y-3">
            <h1 className="text-lg font-heading font-semibold text-black">SSO Unavailable</h1>
            <p className="text-sm text-[#8E8E93]">
              No active SSO configuration was found for <code className="text-black">{tenantSlug}</code>.
            </p>
            <a href="/login" className="inline-block text-sm text-[#007AFF] hover:underline">Back to sign-in</a>
          </div>
        </div>
      </div>
    );
  }

   const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
   redirect(buildSsoCallbackUrl(supabaseUrl, tenantSlug, cfg, next));
}
