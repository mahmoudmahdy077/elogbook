const SSO_FUNCTION_PATH = '/functions/v1/sso-callback';

export interface SsoLookupResult {
  id: string;
  protocol: 'saml' | 'oidc';
  metadata_url: string | null;
  discovery_url: string | null;
  is_active: boolean;
}

export function buildSsoCallbackUrl(
  supabaseUrl: string,
  tenantSlug: string,
  cfg: SsoLookupResult,
  next: string,
): string {
  const params = new URLSearchParams();
  params.set('tenant', tenantSlug);
  if (cfg.protocol === 'oidc' && cfg.discovery_url) {
    params.set('discovery', cfg.discovery_url);
  }
  if (cfg.protocol === 'saml' && cfg.metadata_url) {
    params.set('metadata', cfg.metadata_url);
  }
  params.set('next', next);
  return `${supabaseUrl}${SSO_FUNCTION_PATH}?${params.toString()}`;
}
