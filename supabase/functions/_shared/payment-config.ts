export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const CONFIG_CACHE_TTL = 300_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DatabaseError = { message?: string; code?: string } | null;
type DatabaseResult = { data?: unknown; error?: DatabaseError };
type MaybeSingleQuery = { maybeSingle: () => PromiseLike<DatabaseResult> };
type FilterQuery = { eq: (column: string, value: unknown) => FilterQuery & MaybeSingleQuery };
type SelectQuery = { eq: (column: string, value: unknown) => FilterQuery & MaybeSingleQuery };
type PaymentConfigQuery = { select: (columns: string) => SelectQuery };

export interface PaymentConfigClient {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<DatabaseResult>;
}

function configQuery(client: PaymentConfigClient, table: string): PaymentConfigQuery {
  return client.from(table) as PaymentConfigQuery;
}

export interface BillingConfig {
  id: string;
  tenantId: string;
  secret: string;
  webhookSecret: string;
  mode: 'test' | 'live';
  publishableKey: string;
  /**
   * True only for a gateway the platform itself provisioned (the platform
   * environment key). A tenant-managed gateway row is `false`: the tenant chose
   * the Stripe account, so a `checkout.session.completed` arriving on it is not
   * evidence that the platform was paid. Entitlement-granting events are gated
   * on this; cancellation and dunning are not.
   */
  platformManaged: boolean;
  fetchedAt: number;
}

const configCache = new Map<string, BillingConfig>();

export function clearPaymentConfigCache(): void {
  configCache.clear();
}

export function assertDatabaseResult(result: unknown, operation: string): void {
  if (typeof result !== 'object' || result === null) {
    throw new Error(`${operation}: database result missing`);
  }
  const error = (result as { error?: DatabaseError }).error;
  if (error) {
    throw new Error(`${operation}: ${error.message ?? 'database error'}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validTenantId(tenantId: string): boolean {
  return UUID_PATTERN.test(tenantId);
}

function compatibleSecretMode(secret: string, mode: 'test' | 'live'): boolean {
  if (secret.startsWith('sk_test_')) return mode === 'test';
  if (secret.startsWith('sk_live_')) return mode === 'live';
  return true;
}

function secretMode(secret: string): 'test' | 'live' | null {
  if (secret.startsWith('sk_test_')) return 'test';
  if (secret.startsWith('sk_live_')) return 'live';
  return null;
}

async function readTenantConfig(client: PaymentConfigClient, tenantId: string): Promise<BillingConfig | null> {
  const tenantResult = await configQuery(client, 'tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();
  assertDatabaseResult(tenantResult, 'resolve tenant');
  if (!tenantResult.data) return null;

  const configResult = await configQuery(client, 'payment_gateway_config')
    .select('id, tenant_id, secret_key_enc, webhook_secret_enc, mode, key_version, publishable_key')
    .eq('tenant_id', tenantId)
    .eq('provider', 'stripe')
    .eq('is_active', true)
    .maybeSingle();
  assertDatabaseResult(configResult, 'resolve payment configuration');
  if (!configResult.data) return null;

  const config = asRecord(configResult.data);
  const mode = config.mode === 'live' ? 'live' : config.mode === 'test' ? 'test' : null;
  if (!mode || typeof config.secret_key_enc !== 'string' || typeof config.key_version !== 'number') return null;

  const secretResult = await client.rpc('decrypt_with_version', {
    p_encrypted: config.secret_key_enc,
    p_version: config.key_version,
  });
  assertDatabaseResult(secretResult, 'decrypt payment secret');
  if (typeof secretResult.data !== 'string' || !secretResult.data) return null;
  if (!compatibleSecretMode(secretResult.data, mode)) return null;

  let webhookSecret = '';
  if (typeof config.webhook_secret_enc === 'string' && config.webhook_secret_enc) {
    const webhookResult = await client.rpc('decrypt_with_version', {
      p_encrypted: config.webhook_secret_enc,
      p_version: config.key_version,
    });
    assertDatabaseResult(webhookResult, 'decrypt webhook secret');
    if (typeof webhookResult.data === 'string') webhookSecret = webhookResult.data;
  }

  return {
    id: typeof config.id === 'string' ? config.id : 'config',
    tenantId,
    secret: secretResult.data,
    webhookSecret,
    mode,
    publishableKey: typeof config.publishable_key === 'string' ? config.publishable_key : '',
    platformManaged: false,
    fetchedAt: Date.now(),
  };
}

function readEnvironmentConfig(tenantId: string): BillingConfig | null {
  const secret = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  if (!secret) return null;
  const configuredMode = Deno.env.get('STRIPE_MODE')?.trim();
  const inferredMode = secretMode(secret);
  const mode = configuredMode === 'live' || configuredMode === 'test'
    ? configuredMode
    : inferredMode;
  if (!mode || (inferredMode && inferredMode !== mode)) return null;
  return {
    id: 'environment',
    tenantId,
    secret,
    webhookSecret: Deno.env.get('STRIPE_WEBHOOK_SECRET')?.trim() ?? '',
    mode,
    publishableKey: '',
    platformManaged: true,
    fetchedAt: Date.now(),
  };
}

export async function resolvePaymentConfig(
  client: PaymentConfigClient,
  tenantId: string,
  options: { allowEnvironmentFallback?: boolean } = {},
): Promise<BillingConfig | null> {
  if (!validTenantId(tenantId)) return null;
  const cached = configCache.get(tenantId);
  if (cached && Date.now() - cached.fetchedAt < CONFIG_CACHE_TTL) return cached;

  const tenantConfig = await readTenantConfig(client, tenantId);
  if (tenantConfig) {
    configCache.set(tenantId, tenantConfig);
    return tenantConfig;
  }
  if (tenantId !== PLATFORM_TENANT_ID || options.allowEnvironmentFallback === false) return null;
  const environmentConfig = readEnvironmentConfig(tenantId);
  if (!environmentConfig) return null;
  configCache.set(tenantId, environmentConfig);
  return environmentConfig;
}
