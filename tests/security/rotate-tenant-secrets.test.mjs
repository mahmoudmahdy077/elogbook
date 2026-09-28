import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const utilityPath = resolve(root, 'scripts', 'rotate-tenant-secrets.mjs');
const tenantId = '00000000-0000-4000-8000-000000000019';
const secretValues = [
  ['rotation', 'canary', 'value', '19a'].join('-'),
  ['rotation', 'canary', 'value', '19b'].join('-'),
  ['rotation', 'canary', 'value', '19c'].join('-'),
];

async function loadUtility() {
  assert.ok(existsSync(utilityPath), 'tenant secret rotation utility must exist');
  return import(pathToFileURL(utilityPath).href);
}

function createClient(rows, batchSize = 2) {
  const rpcCalls = [];
  const selectCalls = [];
  let queryIndex = 0;
  const client = {
    from(table) {
      assert.equal(table, 'tenant_webhooks');
      const response = rows.slice(queryIndex * batchSize, (queryIndex + 1) * batchSize);
      queryIndex += 1;
      const query = {
        select(columns) {
          selectCalls.push(columns);
          return query;
        },
        eq(column, value) {
          assert.equal(column, 'tenant_id');
          assert.equal(value, tenantId);
          return query;
        },
        is(column, value) {
          assert.equal(column, 'secret_enc');
          assert.equal(value, null);
          return query;
        },
        neq(column, value) {
          assert.equal(column, 'secret');
          assert.ok(value === 'encrypted' || value === '[ENCRYPTED]');
          return query;
        },
        limit(value) {
          assert.equal(value, batchSize);
          return Promise.resolve({ data: response, error: null });
        },
      };
      return query;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return {
        data: { status: 'rotated', count: args.p_items.length },
        error: null,
      };
    },
  };
  return { client, rpcCalls, selectCalls };
}

function captureLogs() {
  const entries = [];
  const original = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    original[level] = console[level];
    console[level] = (...args) => entries.push([level, ...args]);
  }
  return {
    entries,
    restore() {
      for (const [level, method] of Object.entries(original)) console[level] = method;
    },
  };
}

test('rotates tenant webhook secrets in bounded batches without logging values', async () => {
  const { rotateTenantWebhookSecrets } = await loadUtility();
  const rows = secretValues.map((secret, index) => ({
    id: `00000000-0000-0000-0000-0000000000${29 + index}`,
    tenant_id: tenantId,
    secret,
    secret_enc: null,
  }));
  const { client, rpcCalls, selectCalls } = createClient(rows);
  const logs = captureLogs();

  try {
    const result = await rotateTenantWebhookSecrets({ client, tenantId, batchSize: 2 });

    assert.deepEqual(result, { status: 'rotated', scanned: 3, rotated: 3, batches: 2 });
    assert.deepEqual(selectCalls, [
      'id, tenant_id, secret, secret_enc',
      'id, tenant_id, secret, secret_enc',
      'id, tenant_id, secret, secret_enc',
    ]);
    assert.equal(rpcCalls.length, 2);
    assert.ok(rpcCalls.every(({ name }) => name === 'rotate_tenant_webhook_secrets'));
    assert.ok(rpcCalls.flatMap(({ args }) => args.p_items).some(({ secret }) => secretValues.includes(secret)));
    const output = JSON.stringify({ result, logs: logs.entries });
    assert.ok(secretValues.every((secret) => !output.includes(secret)));
  } finally {
    logs.restore();
  }
});

test('CLI creates an admin client and emits only rotation status and counts', async () => {
  const { runCli } = await loadUtility();
  const rows = secretValues.map((secret, index) => ({
    id: `00000000-0000-4000-8000-0000000000${29 + index}`,
    tenant_id: tenantId,
    secret,
    secret_enc: null,
  }));
  const { client } = createClient(rows, 100);
  const serviceRoleCanary = ['service', 'role', 'canary', '19'].join('-');
  const output = [];
  const errors = [];
  const createClientCalls = [];

  const exitCode = await runCli([tenantId], {
    createClient(url, key, options) {
      createClientCalls.push({ url, key, options });
      return client;
    },
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.test',
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleCanary,
    },
    stdout: { write(value) { output.push(value); } },
    stderr: { write(value) { errors.push(value); } },
  });

  assert.equal(exitCode, 0);
  assert.equal(createClientCalls.length, 1);
  assert.equal(createClientCalls[0].key, serviceRoleCanary);
  assert.deepEqual(JSON.parse(output.join('')), {
    status: 'rotated',
    scanned: 3,
    rotated: 3,
    batches: 1,
  });
  assert.deepEqual(errors, []);
  const emitted = [...output, ...errors].join('');
  assert.ok(secretValues.every((secret) => !emitted.includes(secret)));
  assert.ok(!emitted.includes(serviceRoleCanary));
});
