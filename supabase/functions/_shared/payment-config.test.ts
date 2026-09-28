import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  clearPaymentConfigCache,
  PLATFORM_TENANT_ID,
  resolvePaymentConfig,
} from './payment-config.ts';

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000011';

type DbResult = { data?: unknown; error?: { message?: string; code?: string } | null };

function configClient(configs: Record<string, { mode: string; secret: string; webhookSecret: string }>) {
  return {
    from(table: string) {
      let selectedTenant = '';
      const query = {
        maybeSingle: async (): Promise<DbResult> => {
          if (table === 'tenants') {
            return { data: { id: selectedTenant }, error: null };
          }
          const config = configs[selectedTenant];
          if (!config) return { data: null, error: null };
          return {
            data: {
              id: 'config-1',
              tenant_id: selectedTenant,
              secret_key_enc: `${selectedTenant}:secret`,
              webhook_secret_enc: `${selectedTenant}:webhook`,
              mode: config.mode,
              key_version: 1,
            },
            error: null,
          };
        },
        eq(column: string, value: string) {
          if (column === 'tenant_id' || column === 'id') selectedTenant = value;
          return query;
        },
      };
      return { select: () => query };
    },
    rpc(name: string, args: Record<string, unknown>): Promise<DbResult> {
      if (name !== 'decrypt_with_version') return Promise.resolve({ data: null, error: null });
      const encrypted = String(args.p_encrypted);
      const tenant = encrypted.split(':')[0];
      const config = configs[tenant];
      if (!config) return Promise.resolve({ data: null, error: { message: 'missing config' } });
      return Promise.resolve({ data: encrypted.endsWith(':webhook') ? config.webhookSecret : config.secret, error: null });
    },
  };
}

Deno.test('payment config resolves the tenant mode and secrets', async () => {
  clearPaymentConfigCache();
  const config = await resolvePaymentConfig(configClient({
    [TEST_TENANT_ID]: { mode: 'test', secret: 'sk_test_tenant', webhookSecret: 'whsec_test_tenant' },
  }), TEST_TENANT_ID);
  assertEquals(config?.mode, 'test');
  assertEquals(config?.secret, 'sk_test_tenant');
  assertEquals(config?.webhookSecret, 'whsec_test_tenant');
});

Deno.test('a non-platform tenant cannot fall through to a live environment key', async () => {
  clearPaymentConfigCache();
  const previousKey = Deno.env.get('STRIPE_SECRET_KEY');
  try {
    Deno.env.set('STRIPE_SECRET_KEY', 'sk_live_global');
    const config = await resolvePaymentConfig(configClient({}), TEST_TENANT_ID);
    assertEquals(config, null);
  } finally {
    if (previousKey === undefined) Deno.env.delete('STRIPE_SECRET_KEY');
    else Deno.env.set('STRIPE_SECRET_KEY', previousKey);
  }
});

Deno.test('the platform tenant may use an explicitly test-mode environment key', async () => {
  clearPaymentConfigCache();
  const previousKey = Deno.env.get('STRIPE_SECRET_KEY');
  const previousWebhook = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  try {
    Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_global');
    Deno.env.set('STRIPE_WEBHOOK_SECRET', 'whsec_test_global');
    const config = await resolvePaymentConfig(configClient({}), PLATFORM_TENANT_ID);
    assertEquals(config?.mode, 'test');
    assertEquals(config?.secret, 'sk_test_global');
  } finally {
    if (previousKey === undefined) Deno.env.delete('STRIPE_SECRET_KEY');
    else Deno.env.set('STRIPE_SECRET_KEY', previousKey);
    if (previousWebhook === undefined) Deno.env.delete('STRIPE_WEBHOOK_SECRET');
    else Deno.env.set('STRIPE_WEBHOOK_SECRET', previousWebhook);
  }
});

Deno.test('a tenant configuration cannot claim test mode with a live secret key', async () => {
  clearPaymentConfigCache();
  const config = await resolvePaymentConfig(configClient({
    [TEST_TENANT_ID]: { mode: 'test', secret: 'sk_live_tenant', webhookSecret: 'whsec_test_tenant' },
  }), TEST_TENANT_ID);
  assertEquals(config, null);
});
