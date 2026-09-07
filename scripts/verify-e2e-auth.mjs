#!/usr/bin/env node
// T02 harness self-check: protected specs must use the authed fixture,
// public specs must not depend on auth, and no silent fake-auth may remain.
//
// Fails when:
//  - a spec navigates to a protected route (tenant slug, /dashboard, /api/*
//    except health/ready) without importing the authed `test` fixture
//  - fixtures.ts still derives the cookie ref from a `supabase.co` regex
//  - the legacy localStorage fallback is reachable without an explicit
//    E2E_REQUIRE_AUTH decision
//  - smoke health assertions contradict the liveness contract

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const E2E = join(ROOT, 'apps/web/e2e');
let failures = [];
const fail = (msg) => failures.push(msg);

// Public routes any bare-playwright spec may visit.
const PUBLIC_PREFIXES = ['/', '/login', '/signup', '/pricing', '/contact', '/api/health', '/api/ready', '/api-docs'];

for (const file of readdirSync(E2E).filter((f) => f.endsWith('.spec.ts'))) {
  const src = readFileSync(join(E2E, file), 'utf8');
  const usesPublicTest = /publicTest as test/.test(src);
  const usesAuthedFixture =
    (/from '\.\/fixtures'/.test(src) || /from '\.\.\/e2e\/fixtures'/.test(src)) &&
    !usesPublicTest;
  const usesBarePlaywright = /from '@playwright\/test'/.test(src);

  // Collect navigated paths: page.goto('...') and request.get/post('...').
  const navigations = [
    ...src.matchAll(/(?:goto|get|post|put|delete)\(\s*[`'"]([^`'"]+)[`'"]/g),
  ].map((m) => m[1]);

  const visitsProtected = navigations.some(
    (p) =>
      !PUBLIC_PREFIXES.some(
        (pub) => p === pub || (pub !== '/' && p.startsWith(pub + '/')) || (pub !== '/' && p.startsWith(pub)),
      ) && (p.includes('MOCK_TENANT_SLUG') || p.startsWith('/${') || /^\/(demo|dashboard|[a-z0-9-]+\/)/.test(p)),
  );
  // Template-literal navigations referencing the tenant slug are protected.
  const tenantSlugNav = /MOCK_TENANT_SLUG/.test(src) && /(goto|get|post)\(/.test(src);

  if ((visitsProtected || tenantSlugNav) && (usesBarePlaywright || usesPublicTest)) {
    fail(`${file}: visits protected routes without the authed fixtures test`);
  }
  if (usesAuthedFixture && usesPublicTest) {
    fail(`${file}: mixes authed fixture import with publicTest`);
  }
}

// Fixture hygiene.
const fixture = readFileSync(join(E2E, 'fixtures.ts'), 'utf8');
if (/supabase\\.co/i.test(fixture)) {
  fail('fixtures.ts: still contains the supabase.co-only cookie-ref regex');
}
if (!fixture.includes('e2e-cookie')) {
  fail('fixtures.ts: must derive the cookie name from lib/e2e-cookie.ts');
}
if (!fixture.includes('E2E_REQUIRE_AUTH')) {
  fail('fixtures.ts: must hard-fail protected specs when E2E_REQUIRE_AUTH=1');
}

// Smoke contract must match liveness (T03): no db/rateLimit/durationMs on /api/health.
const smoke = readFileSync(join(E2E, 'smoke.spec.ts'), 'utf8');
if (/durationMs/.test(smoke)) {
  fail('smoke.spec.ts: asserts durationMs on /api/health, which liveness no longer returns');
}

if (failures.length) {
  console.error('verify-e2e-auth FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('verify-e2e-auth passed: spec/fixture separation and liveness contract hold');
