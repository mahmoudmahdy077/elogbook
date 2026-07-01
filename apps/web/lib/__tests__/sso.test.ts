import { describe, it, expect } from 'vitest';
import { buildSsoCallbackUrl } from '../sso';
import type { SsoLookupResult } from '../sso';

const SUPABASE_URL = 'https://project.supabase.co';
const TENANT = 'demo-hospital';
const NEXT = '/dashboard';

const oidcConfig: SsoLookupResult = {
  id: 'cfg-1',
  protocol: 'oidc',
  discovery_url: 'https://idp.example.com/.well-known/openid-configuration',
  metadata_url: null,
  is_active: true,
};

const samlConfig: SsoLookupResult = {
  id: 'cfg-2',
  protocol: 'saml',
  metadata_url: 'https://idp.example.com/metadata.xml',
  discovery_url: null,
  is_active: true,
};

describe('buildSsoCallbackUrl', () => {
  it('builds OIDC callback URL with discovery param', () => {
    const url = buildSsoCallbackUrl(SUPABASE_URL, TENANT, oidcConfig, NEXT);
    expect(url).toContain('/functions/v1/sso-callback');
    expect(url).toContain('tenant=demo-hospital');
    expect(url).toContain('discovery=https%3A%2F%2Fidp.example.com%2F.well-known%2Fopenid-configuration');
    expect(url).toContain('next=%2Fdashboard');
    expect(url).not.toContain('metadata');
  });

  it('builds SAML callback URL with metadata param', () => {
    const url = buildSsoCallbackUrl(SUPABASE_URL, TENANT, samlConfig, NEXT);
    expect(url).toContain('/functions/v1/sso-callback');
    expect(url).toContain('tenant=demo-hospital');
    expect(url).toContain('metadata=https%3A%2F%2Fidp.example.com%2Fmetadata.xml');
    expect(url).toContain('next=%2Fdashboard');
    expect(url).not.toContain('discovery');
  });

  it('includes root-level next when next is /', () => {
    const url = buildSsoCallbackUrl(SUPABASE_URL, TENANT, oidcConfig, '/');
    expect(url).toContain('next=%2F');
  });

  it('omits metadata_url when protocol is OIDC even if set', () => {
    const mixed = { ...oidcConfig, metadata_url: 'https://idp.example.com/metadata.xml' };
    const url = buildSsoCallbackUrl(SUPABASE_URL, TENANT, mixed, NEXT);
    expect(url).not.toContain('metadata');
  });

  it('omits discovery_url when protocol is SAML even if set', () => {
    const mixed = { ...samlConfig, discovery_url: 'https://idp.example.com/discovery' };
    const url = buildSsoCallbackUrl(SUPABASE_URL, TENANT, mixed, NEXT);
    expect(url).not.toContain('discovery');
  });

  it('omits both metadata and discovery when both are null', () => {
    const minimal: SsoLookupResult = {
      id: 'cfg-3',
      protocol: 'oidc',
      discovery_url: null,
      metadata_url: null,
      is_active: true,
    };
    const url = buildSsoCallbackUrl(SUPABASE_URL, TENANT, minimal, NEXT);
    expect(url).not.toContain('discovery');
    expect(url).not.toContain('metadata');
    expect(url).toContain('tenant=demo-hospital');
  });

  it('starts with the supabase base URL', () => {
    const url = buildSsoCallbackUrl(SUPABASE_URL, TENANT, oidcConfig, NEXT);
    expect(url.startsWith(SUPABASE_URL)).toBe(true);
  });
});
