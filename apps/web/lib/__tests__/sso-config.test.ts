import { describe, expect, it } from 'vitest';
import { projectSsoConfig } from '../sso-config';

describe('SSO safe projection', () => {
  it('never returns encrypted or plaintext secret material', () => {
    const projected = projectSsoConfig({
      id: 'config-1',
      protocol: 'oidc',
      metadata_url: null,
      discovery_url: 'https://idp.example.test/.well-known/openid-configuration',
      idp_entity_id: 'https://idp.example.test',
      client_id: 'client-1',
      default_role: 'resident',
      is_active: true,
      created_at: '2026-09-25T00:00:00.000Z',
      updated_at: '2026-09-25T00:00:00.000Z',
      client_secret: 'client-secret',
      idp_certificate: 'CERT_SECRET_VALUE',
      client_secret_encrypted: 'ciphertext',
      client_secret_enc: 'ciphertext',
      idp_certificate_enc: 'ciphertext',
    });

    expect(projected).toEqual({
      id: 'config-1',
      protocol: 'oidc',
      metadata_url: null,
      discovery_url: 'https://idp.example.test/.well-known/openid-configuration',
      idp_entity_id: 'https://idp.example.test',
      client_id: 'client-1',
      default_role: 'resident',
      is_active: true,
      has_client_secret: true,
      has_idp_certificate: true,
      created_at: '2026-09-25T00:00:00.000Z',
      updated_at: '2026-09-25T00:00:00.000Z',
    });
    expect(JSON.stringify(projected)).not.toContain('client-secret');
    expect(JSON.stringify(projected)).not.toContain('CERT_SECRET_VALUE');
    expect(JSON.stringify(projected)).not.toContain('ciphertext');
  });

  it('does not synthesize secret presence from an untrusted response field', () => {
    const projected = projectSsoConfig({ protocol: 'saml', is_active: false });
    expect(projected.has_client_secret).toBe(false);
    expect(projected.has_idp_certificate).toBe(false);
  });
});
