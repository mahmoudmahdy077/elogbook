const PROTOCOLS = new Set(['saml', 'oidc']);
const ROLES = new Set(['resident', 'supervisor', 'director', 'institution_admin']);

type UnknownRecord = Record<string, unknown>;

export interface SsoSafeConfig {
  id: string | null;
  protocol: 'saml' | 'oidc' | null;
  metadata_url: string | null;
  discovery_url: string | null;
  idp_entity_id: string | null;
  client_id: string | null;
  default_role: 'resident' | 'supervisor' | 'director' | 'institution_admin' | null;
  is_active: boolean;
  has_client_secret: boolean;
  has_idp_certificate: boolean;
  created_at: string | null;
  updated_at: string | null;
}

function recordOf(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function boolOrFalse(value: unknown): boolean {
  return value === true;
}

export function projectSsoConfig(value: unknown): SsoSafeConfig {
  const row = recordOf(value);
  const protocol = stringOrNull(row.protocol);
  const defaultRole = stringOrNull(row.default_role);
  return {
    id: stringOrNull(row.id),
    protocol: protocol && PROTOCOLS.has(protocol) ? protocol as 'saml' | 'oidc' : null,
    metadata_url: stringOrNull(row.metadata_url),
    discovery_url: stringOrNull(row.discovery_url),
    idp_entity_id: stringOrNull(row.idp_entity_id),
    client_id: stringOrNull(row.client_id),
    default_role: defaultRole && ROLES.has(defaultRole) ? defaultRole as SsoSafeConfig['default_role'] : null,
    is_active: boolOrFalse(row.is_active),
    has_client_secret: boolOrFalse(row.has_client_secret)
      || row.client_secret !== undefined && row.client_secret !== null
      || row.client_secret_enc !== undefined && row.client_secret_enc !== null
      || row.client_secret_encrypted !== undefined && row.client_secret_encrypted !== null,
    has_idp_certificate: boolOrFalse(row.has_idp_certificate)
      || row.idp_certificate !== undefined && row.idp_certificate !== null
      || row.idp_certificate_enc !== undefined && row.idp_certificate_enc !== null,
    created_at: stringOrNull(row.created_at),
    updated_at: stringOrNull(row.updated_at),
  };
}
