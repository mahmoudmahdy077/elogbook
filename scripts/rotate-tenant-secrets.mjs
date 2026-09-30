import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROTATION_FAILED = 'tenant-secret-rotation-failed';

function validateInput(client, tenantId, batchSize) {
  if (!client || typeof client.from !== 'function' || typeof client.rpc !== 'function') {
    throw new TypeError(ROTATION_FAILED);
  }
  if (typeof tenantId !== 'string' || !UUID_PATTERN.test(tenantId)) {
    throw new TypeError(ROTATION_FAILED);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new RangeError(ROTATION_FAILED);
  }
}

function rotationItems(rows) {
  return rows.map((row) => {
    if (
      !row
      || typeof row.id !== 'string'
      || typeof row.tenant_id !== 'string'
      || typeof row.secret !== 'string'
      || row.secret.length === 0
    ) {
      throw new TypeError(ROTATION_FAILED);
    }
    return {
      webhook_id: row.id,
      tenant_id: row.tenant_id,
      secret: row.secret,
    };
  });
}

export async function rotateTenantWebhookSecrets({
  client,
  tenantId,
  batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
  validateInput(client, tenantId, batchSize);

  let scanned = 0;
  let rotated = 0;
  let batches = 0;

  while (true) {
    const response = await client
      .from('tenant_webhooks')
      .select('id, tenant_id, secret, secret_enc')
      .eq('tenant_id', tenantId)
      .is('secret_enc', null)
      .neq('secret', 'encrypted')
      .neq('secret', '[ENCRYPTED]')
      .limit(batchSize);

    if (response?.error || !Array.isArray(response?.data)) {
      throw new Error(ROTATION_FAILED);
    }
    if (response.data.length === 0) break;

    const p_items = rotationItems(response.data);
    const result = await client.rpc('rotate_tenant_webhook_secrets', { p_items });
    const count = result?.data?.count;

    if (
      result?.error
      || result?.data?.status !== 'rotated'
      || !Number.isInteger(count)
      || count !== p_items.length
    ) {
      throw new Error(ROTATION_FAILED);
    }

    scanned += p_items.length;
    rotated += count;
    batches += 1;
  }

  return {
    status: rotated > 0 ? 'rotated' : 'no-op',
    scanned,
    rotated,
    batches,
  };
}

export async function runCli(
  args,
  {
    createClient,
    env = process.env,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  try {
    const [tenantId, ...extra] = args;
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (
      extra.length > 0
      || typeof tenantId !== 'string'
      || !UUID_PATTERN.test(tenantId)
      || typeof url !== 'string'
      || url.length === 0
      || typeof serviceRoleKey !== 'string'
      || serviceRoleKey.length === 0
      || typeof createClient !== 'function'
    ) {
      throw new TypeError(ROTATION_FAILED);
    }

    const client = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    const result = await rotateTenantWebhookSecrets({ client, tenantId });
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    stderr.write(`${JSON.stringify({ status: 'failed' })}\n`);
    return 1;
  }
}

export { MAX_BATCH_SIZE, ROTATION_FAILED };

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    process.exitCode = await runCli(process.argv.slice(2), { createClient });
  } catch {
    process.stderr.write(`${JSON.stringify({ status: 'failed' })}\n`);
    process.exitCode = 1;
  }
}
