// Server-only types containing secret fields.
// These types MUST NEVER be imported in client-side code.
// Import directly from '@elogbook/shared/types/database.server' in server-side code only.

export interface AIConfigServer {
  id: string;
  tenant_id: string;
  provider: 'openai' | 'anthropic' | 'azure' | 'openrouter' | 'custom';
  model: string;
  encrypted_api_key: string;
  endpoint_url: string | null;
  is_active: boolean;
}

export interface PaymentGatewayConfigServer {
  id: string;
  tenant_id: string;
  provider: 'stripe' | 'paddle' | 'lemonsqueezy' | 'custom';
  publishable_key: string;
  encrypted_secret_key: string;
  encrypted_webhook_secret: string;
  endpoint_url: string | null;
  is_active: boolean;
}