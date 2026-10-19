import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const routeFiles = [
  '../../app/api/[tenant]/export-pdf/route.ts',
  '../../app/api/[tenant]/reports/webads/route.ts',
  '../../app/api/[tenant]/billing/invoices/route.ts',
  '../../app/api/[tenant]/reports/gap-analysis/route.ts',
  '../../app/api/[tenant]/reports/status.csv/route.ts',
  '../../app/api/[tenant]/reports/specialty.csv/route.ts',
  '../../app/api/[tenant]/reports/evaluations.csv/route.ts',
  '../../app/api/[tenant]/reports/duty-hours.csv/route.ts',
  '../../app/api/[tenant]/audit/export/route.ts',
  '../../app/api/[tenant]/compliance/export/route.ts',
];

const delegatedAdminRouteFiles = [
  '../../app/api/[tenant]/admin/users/route.ts',
  '../../app/api/[tenant]/templates/route.ts',
  '../../app/api/[tenant]/templates/[id]/route.ts',
  '../../app/api/[tenant]/templates/[id]/duplicate/route.ts',
  '../../app/api/[tenant]/templates/import/route.ts',
];

// Entitlement routes. Their read handler still needs the AAL2 admin guard, but
// their write handlers are gone: `subscriptions` and `subscription_plans` are
// platform/provider-owned, and a tenant administrator who can write them can
// grant paid access with no payment. See billing-entitlement-authority.test.ts
// for the behavioural coverage.
const readOnlyEntitlementRouteFiles = [
  '../../app/api/[tenant]/admin/subscription/route.ts',
  '../../app/api/[tenant]/admin/plans/route.ts',
];

const removedEntitlementWriteRoutes = [
  '../../app/api/[tenant]/admin/subscription/cancel/route.ts',
];

describe('privileged web route guards', () => {
  it.each(routeFiles)('%s requires server-verified AAL2', (relativePath) => {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
    expect(source).toContain('getSecurityContext');
    expect(source).toContain("requiredAal: 'aal2'");
  });

  it.each(delegatedAdminRouteFiles)('%s delegates to an AAL2 admin guard', (relativePath) => {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
    expect(source).toContain('requireTenantAdmin');
  });

  it.each(readOnlyEntitlementRouteFiles)('%s keeps its read behind an AAL2 admin guard', (relativePath) => {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
    expect(source).toContain('requireTenantAdmin');
  });

  it.each(removedEntitlementWriteRoutes)('%s has no authenticated entitlement write', (relativePath) => {
    const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
      // Comments explain why the write is gone, and name the table. Assertions
      // have to be about code, or they pass for the wrong reason.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    // No Supabase client at all: the handler cannot reach the entitlement table.
    expect(source).not.toContain('createServerSupabase');
    expect(source).not.toContain('subscriptions');
  });
});
