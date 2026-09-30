import { assert, assertEquals, assertNotEquals, assertRejects } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  AI_CACHE_POLICY_VERSION,
  MissingStreamReaderError,
  StreamSafetyAbortError,
  callAiProvider,
  checkSafety,
  computeQueryHash,
  consumeOpenAiStream,
  createIdempotentRelease,
  deidentifyAiText,
  isActiveResidentTarget,
   runWithQuotaRelease,
   sanitizeCachedResponse,
   sanitizeQuery,
 } from './index.ts';

import { resolveAuthoritativePrincipal, type PrincipalLookupClient } from '../_shared/auth.ts';
import { AI_NORMALIZED_FIELD_ALLOWLIST, validateAiModelOutput } from '../_shared/ai-guard.ts';
import { AI_NORMALIZED_FIELD_NAMES } from '../../../packages/shared/src/schemas/ai-contract.ts';

Deno.test('sanitizeQuery strips control characters and truncates', () => {
  assertEquals(sanitizeQuery('  hello\x00 world  '), 'hello world');
  assertEquals(sanitizeQuery('x'.repeat(2000)).length, 1000);
});

Deno.test('checkSafety flags diagnosis/prescription/prognosis patterns', () => {
  const flags = checkSafety('The patient is diagnosed with diabetes and we recommend medication');
  assertEquals(flags.includes('blocked_diagnosis'), true);
});

Deno.test('authoritative principal uses profile id rather than auth user id', async () => {
  const calls: string[] = [];
  const client: PrincipalLookupClient = {
    rpc: (name) => {
      calls.push(name);
      return Promise.resolve({
        data: [{
          user_id: 'auth-user-1',
          profile_id: 'profile-1',
          tenant_id: 'tenant-1',
          role: 'resident',
          profile_status: 'active',
          tenant_status: 'active',
          aal: 'aal2',
        }],
        error: null,
      });
    },
  };

  const principal = await resolveAuthoritativePrincipal(client, 'auth-user-1');
  assertEquals(principal?.profileId, 'profile-1');
  assertEquals(principal?.userId, 'auth-user-1');
  assertEquals(calls, ['get_authoritative_principal_with_aal']);
});

Deno.test('authoritative principal rejects a row for another auth user', async () => {
  const client: PrincipalLookupClient = {
    rpc: () => Promise.resolve({
      data: [{
        user_id: 'auth-user-2',
        profile_id: 'profile-2',
        tenant_id: 'tenant-1',
        role: 'resident',
        profile_status: 'active',
        tenant_status: 'active',
        aal: 'aal2',
      }],
      error: null,
    }),
  };

  assertEquals(await resolveAuthoritativePrincipal(client, 'auth-user-1'), null);
});

Deno.test('resident target validation rejects a cross-tenant or inactive profile', () => {
  const resident = {
    id: 'resident-1',
    tenant_id: 'tenant-1',
    role: 'resident',
    status: 'active',
    deleted_at: null,
  };
  assertEquals(isActiveResidentTarget(resident, 'tenant-1', 'resident-1'), true);
  assertEquals(isActiveResidentTarget({ ...resident, tenant_id: 'tenant-2' }, 'tenant-1', 'resident-1'), false);
  assertEquals(isActiveResidentTarget({ ...resident, status: 'suspended' }, 'tenant-1', 'resident-1'), false);
  assertEquals(isActiveResidentTarget({ ...resident, deleted_at: '2026-01-01' }, 'tenant-1', 'resident-1'), false);
});

Deno.test('cache keys isolate residents, providers, models, tenants, and policy versions', async () => {
   const base = {
     query: 'auto-analysis',
     structuredInput: { status: 'approved' },
     model: 'model-a',
     tenantId: 'tenant-1',
     residentId: 'resident-1',
     profileId: 'profile-1',
     provider: 'openai',
     policyVersion: AI_CACHE_POLICY_VERSION,
   };

  const key = await computeQueryHash(base);
  assertNotEquals(key, await computeQueryHash({ ...base, residentId: 'resident-2', profileId: 'resident-2' }));
  assertNotEquals(key, await computeQueryHash({ ...base, profileId: 'profile-2' }));
  assertNotEquals(key, await computeQueryHash({ ...base, provider: 'anthropic' }));
  assertNotEquals(key, await computeQueryHash({ ...base, model: 'model-b' }));
  assertNotEquals(key, await computeQueryHash({ ...base, tenantId: 'tenant-2' }));
  assertNotEquals(key, await computeQueryHash({ ...base, policyVersion: 'policy-v2' }));
  await assertRejects(() => computeQueryHash({ ...base, query: 'free-text clinical narrative' }));
});

Deno.test('deidentifyAiText rejects identifying text before provider or logging', () => {
  assertEquals(deidentifyAiText('Please review the trends'), 'Please review the trends');
  assertEquals(deidentifyAiText('Contact jane.doe@example.com'), null);
  assertEquals(deidentifyAiText('Jane Doe'), null);
  assertEquals(deidentifyAiText('MRN: 123456789'), null);
});

Deno.test('idempotent quota release invokes the underlying release once after an error', async () => {
  let calls = 0;
  const release = createIdempotentRelease(() => {
    calls += 1;
    return Promise.reject(new Error('release transport failed'));
  });

  await release();
  await release();
  await Promise.all([release(), release()]);
  assertEquals(calls, 1);
});

for (const provider of ['openai', 'openrouter', 'anthropic', 'azure', 'custom']) {
  Deno.test(`${provider} non-2xx releases a consumed reservation exactly once`, async () => {
    let releases = 0;
    const release = createIdempotentRelease(() => {
      releases += 1;
      return Promise.resolve();
    });

    await assertRejects(() => runWithQuotaRelease(release, () => callAiProvider(
      {
        provider,
        model: provider === 'anthropic' ? 'claude-3' : 'gpt-4',
        apiKey: 'test-key',
        endpointUrl: provider === 'custom' ? 'https://provider.example.test/chat' : provider === 'azure' ? 'https://deployment.openai.azure.com' : null,
      },
      'system',
      'user',
      {
        fetchImpl: () => Promise.resolve(new Response('provider failure', { status: 503 })),
        validateEndpoint: () => Promise.resolve(true),
      },
    )));
    assertEquals(releases, 1);
  });
}

Deno.test('unsupported provider releases a consumed reservation exactly once', async () => {
  let releases = 0;
  const release = createIdempotentRelease(() => {
    releases += 1;
    return Promise.resolve();
  });

  await assertRejects(() => runWithQuotaRelease(release, () => callAiProvider(
    { provider: 'unsupported', model: 'model', apiKey: 'test-key', endpointUrl: null },
    'system',
    'user',
    {
      fetchImpl: () => {
        assert(false, 'unsupported provider must not fetch');
        return Promise.resolve(new Response('', { status: 500 }));
      },
    },
  )));
  assertEquals(releases, 1);
});

Deno.test('missing stream reader releases a consumed reservation exactly once', async () => {
  let releases = 0;
  const release = createIdempotentRelease(() => {
    releases += 1;
    return Promise.resolve();
  });

  await assertRejects(
    () => runWithQuotaRelease(release, () => consumeOpenAiStream(new Response(null, { status: 200 }), () => undefined)),
    MissingStreamReaderError,
  );
  assertEquals(releases, 1);
});

Deno.test('stream safety abort releases a consumed reservation exactly once', async () => {
  let releases = 0;
  const release = createIdempotentRelease(() => {
    releases += 1;
    return Promise.resolve();
  });
  const body = 'data: {"choices":[{"delta":{"content":"The patient is diagnosed with diabetes"}}]}\n\n';
  const response = new Response(body, { status: 200 });

  await assertRejects(
    () => runWithQuotaRelease(release, () => consumeOpenAiStream(response, () => undefined)),
    StreamSafetyAbortError,
  );
  assertEquals(releases, 1);
});

Deno.test('AI cache and log writes do not persist raw query or response fields', () => {
  const source = Deno.readTextFileSync(new URL('./index.ts', import.meta.url));
  assertEquals(source.includes('response_text: response'), false);
  assertEquals(source.includes('response_text: safeResponse'), true);
  assertEquals(source.includes("query: '[HASHED]'"), true);
  assertEquals(source.includes("response: '[REDACTED]'"), true);
  assertEquals(source.includes('releaseAiQuota(serviceSupabase, reservationId)'), true);
});

Deno.test('model output DLP rejects an echoed identifier before persistence', () => {
  const result = validateAiModelOutput('MRN-AB-1234');
  assertEquals(result.ok, false);
  assertEquals(sanitizeCachedResponse('MRN-AB-1234'), null);
  assertEquals(sanitizeCachedResponse('A safe educational summary.'), 'A safe educational summary.');
});

Deno.test('stream parser never emits a token before a split identifier is rejected', async () => {
  const response = new Response([
    'data: {"choices":[{"delta":{"content":"MR"}}]}',
    'data: {"choices":[{"delta":{"content":"N: 123-45-6789"}}]}',
    'data: [DONE]',
  ].join('\n\n'), { status: 200 });
  const emitted: string[] = [];
  await assertRejects(
    () => consumeOpenAiStream(response, (token) => emitted.push(token)),
    StreamSafetyAbortError,
  );
  assertEquals(emitted, []);
});

Deno.test('the SQL PHI boundary uses the same normalized keys as TypeScript', () => {
  const migration = Deno.readTextFileSync(new URL('../../migrations/20260925000004_phi_boundary_reassert.sql', import.meta.url));
  assertEquals([...AI_NORMALIZED_FIELD_ALLOWLIST], [...AI_NORMALIZED_FIELD_NAMES]);
  assertEquals(migration.includes("'agegroup'"), true);
  assertEquals(migration.includes("'anesthesiatype'"), true);
  assertEquals(migration.includes("'age_group'"), false);
  for (const marker of ['[A-Z0-9._%+-]+@', 'MRN', '\\d{3}[- ]', 'STREET', '\\+?\\d', 'name']) {
    assertEquals(migration.toLowerCase().includes(marker.toLowerCase()), true);
  }
  for (const field of AI_NORMALIZED_FIELD_ALLOWLIST) {
    assertEquals(migration.includes(`'${field}'`), true);
  }
});

Deno.test('AI insights source rejects streaming before provider, cache, or log work', () => {
  const source = Deno.readTextFileSync(new URL('./index.ts', import.meta.url));
  const streamGuard = source.indexOf('if (rawStream === true)');
  const providerCall = source.lastIndexOf('await callAiProvider(');
  assert(streamGuard >= 0);
  assert(providerCall > streamGuard);
  assert(source.includes("status: 400") || source.includes("status: 501"));
  assertEquals(source.includes('text/event-stream'), false);
  assertEquals(source.includes('const queryForCache'), false);
  assertEquals(source.includes('is_deidentified: true'), false);
  assertEquals(source.includes('response_text: safeResponse'), true);
});
