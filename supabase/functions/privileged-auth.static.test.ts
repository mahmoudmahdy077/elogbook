// Deliberately dependency-free: this is a static source check, so it must run
// with `--frozen` and no remote import rather than pulling a module that the
// lockfile does not cover.
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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

const AAL2_REQUIRED = /aal:\s*['"]aal2['"]/;

for (const relativePath of privilegedFunctions) {
  Deno.test(`${relativePath} uses the shared AAL2 principal guard`, async () => {
    const source = await Deno.readTextFile(new URL(`./${relativePath}`, import.meta.url));
    assert(source.includes('requirePrincipal'), `${relativePath} must call requirePrincipal`);
    assert(AAL2_REQUIRED.test(source), `${relativePath} must require aal2`);
    assert(
      !source.includes('getServerVerifiedAal'),
      `${relativePath} must not use getServerVerifiedAal`,
    );
  });
}

Deno.test('privileged Edge handlers do not authorize from app metadata', async () => {
  for (const relativePath of privilegedFunctions) {
    const source = await Deno.readTextFile(new URL(`./${relativePath}`, import.meta.url));
    assert(
      !source.includes('app_metadata'),
      `${relativePath} must not authorize from app metadata`,
    );
  }
});

Deno.test('resident AI access is pinned to the resident profile', async () => {
  const source = await Deno.readTextFile(new URL('./ai-insights/index.ts', import.meta.url));
  assert(
    source.includes("principal.role === 'resident' && resident_id !== principal.profileId"),
    'ai-insights must pin resident access to the resident profile',
  );
});
