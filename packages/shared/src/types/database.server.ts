// Server-only types containing secret fields.
// These types MUST NEVER be imported in client-side code.
// Import directly from '@elogbook/shared/types/database.server' in
// server-side code only — an ESLint rule (P3.12) blocks this from
// client bundles.

export interface AIConfigServer {
  id: string;
  tenant_id: string;
  provider: 'openai' | 'anthropic' | 'azure' | 'openrouter' | 'aihubmix' | 'custom';
  model: string;
  /** AES-encrypted bytes (pgp_sym_encrypt output) — see migration 00053. */
  api_key_enc: Uint8Array;
  /** The current encryption key version (for rotation; see P7.7). */
  key_version: number;
  endpoint_url: string | null;
  is_active: boolean;
  mode: 'test' | 'live';
  created_at: string;
  updated_at: string;
}

export interface PaymentGatewayConfigServer {
  id: string;
  tenant_id: string;
  provider: 'stripe' | 'paddle' | 'lemonsqueezy' | 'custom';
  publishable_key: string;
  /** AES-encrypted bytes (pgp_sym_encrypt output). */
  secret_key_enc: Uint8Array;
  /** AES-encrypted bytes (pgp_sym_encrypt output). */
  webhook_secret_enc: Uint8Array;
  /** The current encryption key version (for rotation; see P7.7). */
  key_version: number;
  endpoint_url: string | null;
  is_active: boolean;
  mode: 'test' | 'live';
  created_at: string;
  updated_at: string;
}
