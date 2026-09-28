import { assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';

const privilegedFunctions = [
  'generate-pdf/index.ts',
  'webads-export/index.ts',
  'create-checkout/index.ts',
  'create-portal-session/index.ts',
  'list-invoices/index.ts',
  'ai-quality/index.ts',
  'ai-gap-analysis/index.ts',
  'ai-insights/index.ts',
] as const;

for (const relativePath of privilegedFunctions) {
  Deno.test(`${relativePath} uses the shared AAL2 principal guard`, async () => {
    const source = await Deno.readTextFile(new URL(`./${relativePath}`, import.meta.url));
    assert(source.includes('requirePrincipal'));
    assert(source.includes("aal: 'aal2'"));
    assert(!source.includes('getServerVerifiedAal'));
  });
}

Deno.test('privileged Edge handlers do not authorize from app metadata', async () => {
  for (const relativePath of privilegedFunctions) {
    const source = await Deno.readTextFile(new URL(`./${relativePath}`, import.meta.url));
    assert(!source.includes('app_metadata'));
  }
});

Deno.test('resident AI access is pinned to the resident profile', async () => {
  const source = await Deno.readTextFile(new URL('./ai-insights/index.ts', import.meta.url));
  assert(source.includes("principal.role === 'resident' && resident_id !== principal.profileId"));
});
