import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Imported statically: these modules pull in the real Supabase/Next graph, which
// is too slow to load inside a test body under the 10s per-test timeout.
// Collection-time cost is not bounded by testTimeout.
import { PUT as subscriptionPut } from '../../app/api/[tenant]/admin/subscription/route';
import { POST as cancelPost } from '../../app/api/[tenant]/admin/subscription/cancel/route';
import { POST as planPost, PUT as planPut, DELETE as planDelete } from '../../app/api/[tenant]/admin/plans/route';

// Billing entitlement authority is a structural property.
//
// `subscriptions` and `subscription_plans` are entitlement state. A tenant
// administrator who can write them can grant paid access for free: write a
// catalog row with arbitrary `features` (including `max_cases: 0`, which
// `check_case_quota` reads as "unlimited"), then point their own subscription at
// it. The routes below must therefore have no authenticated write path at all —
// only reads, or a refusal that points at the real activation flow.
//
// These assertions run on every web test pass so a later edit cannot quietly
// reintroduce a self-activation path.

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

function codeOf(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

const adminDir = '../../app/api/[tenant]/admin';
const subscriptionRoute = `${adminDir}/subscription/route.ts`;
const cancelRoute = `${adminDir}/subscription/cancel/route.ts`;
const plansRoute = `${adminDir}/plans/route.ts`;

const WRITE_METHODS = ['insert', 'update', 'upsert', 'delete'];

/**
 * Statements in these routes are `supabase.from('t')....;` chains. Split on the
 * statement terminator so a `.from()` and the write method that follows it are
 * seen together — a per-line filter would miss a chain that wraps across lines
 * and would pass a route that writes.
 */
function writeStatements(relativePath: string, table: string): string[] {
  return codeOf(relativePath)
    .split(';')
    .filter((statement) => statement.includes(`'${table}'`) || statement.includes(`"${table}"`))
    .filter((statement) => WRITE_METHODS.some((method) => new RegExp(`\\.${method}\\s*\\(`).test(statement)))
    .map((statement) => statement.trim());
}

describe('subscription entitlement route writes', () => {
  it('admin/subscription never writes the subscriptions table', () => {
    expect(writeStatements(subscriptionRoute, 'subscriptions')).toEqual([]);
  });

  it('admin/subscription never writes the subscription_changes table directly', () => {
    // Change history is server-side audit output for a command that no longer
    // exists in this route; a direct write would be a fabricated entitlement log.
    expect(writeStatements(subscriptionRoute, 'subscription_changes')).toEqual([]);
  });

  it('admin/subscription/cancel never writes the subscriptions table', () => {
    expect(writeStatements(cancelRoute, 'subscriptions')).toEqual([]);
  });
});

describe('plan catalog immutability route', () => {
  it('admin/plans never inserts, updates or deletes a plan row', () => {
    expect(writeStatements(plansRoute, 'subscription_plans')).toEqual([]);
    expect(writeStatements(plansRoute, 'custom_plan_features')).toEqual([]);
  });

  it('admin/plans does not accept client-supplied entitlements', () => {
    const code = codeOf(plansRoute);
    // The catalog row's entitlement fields may be READ (the read path orders by
    // price so the billing page can list plans), but no request-body schema may
    // declare them. A schema field is how price/features/max_residents become
    // client-supplied in the first place.
    expect(code).not.toMatch(/z\.object\(/);
    expect(code).not.toMatch(/z\.(?:number|record|boolean)\(\)/);
    expect(code).not.toMatch(/custom_plan_features'\s*\)\s*\.(?:insert|update|upsert|delete)/);
    // `features` and `max_residents` are entitlement, not presentation: the read
    // selects them wholesale and never derives them from the request.
    expect(code).not.toMatch(/features\s*[:=]\s*(?:body|guarded\.data|payload)/);
    expect(code).not.toMatch(/max_residents\s*[:=]\s*(?:body|guarded\.data|payload)/);
  });
});

describe('entitlement write handlers refuse rather than self-activate', () => {
  // These handlers are pure refusals: they take no request, open no database
  // client, and construct a static response. Asserting that directly keeps the
  // test hermetic — a module mock here would leak into unrelated suites that
  // run later in the same worker.
  it('the subscription PUT handler is not an activation path', async () => {
    const response = await subscriptionPut();
    expect([403, 405, 409, 501]).toContain(response.status);
    await expect(response.json()).resolves.toMatchObject({
      code: 'entitlement_requires_payment_event',
    });
  });

  it('the cancel handler is not an entitlement write path', async () => {
    const response = await cancelPost();
    expect([403, 405, 409, 501]).toContain(response.status);
    await expect(response.json()).resolves.toMatchObject({
      code: 'cancellation_requires_payment_event',
    });
  });

  it('the plan create/update/delete handlers are not catalog mutation paths', async () => {
    for (const response of [await planPost(), await planPut(), await planDelete()]) {
      expect([403, 405, 409, 501]).toContain(response.status);
      await expect(response.json()).resolves.toMatchObject({
        code: 'plan_catalog_is_platform_owned',
      });
    }
  });
});

describe('server-owned plan and tenant resolution in payment flows', () => {
  const functionDir = '../../../../supabase/functions';

  it('create-checkout resolves the plan from the server catalog, not the request body', () => {
    const code = read(`${functionDir}/create-checkout/index.ts`);
    // The body may name a plan; it may not name the tenant, the mode, or the price.
    expect(code).toContain("body.plan_id");
    expect(code).not.toMatch(/body\.tenant_id/);
    expect(code).not.toMatch(/body\.mode/);
    expect(code).not.toMatch(/body\.price/);
  });

  it('create-checkout binds the tenant from the verified principal', () => {
    const code = read(`${functionDir}/create-checkout/index.ts`);
    expect(code).toContain('const { supabase, tenantId } = authResult');
    expect(code).toContain('client_reference_id: tenantId');
  });

  it('create-checkout validates the plan against the tenant own type', () => {
    const code = read(`${functionDir}/create-checkout/index.ts`);
    expect(code).toContain('tenant_type');
  });

  it('create-portal-session never takes the tenant or customer from the request', () => {
    const code = read(`${functionDir}/create-portal-session/index.ts`);
    expect(code).not.toMatch(/body\.tenant_id/);
    expect(code).not.toMatch(/body\.customer/);
    expect(code).toContain('const { supabase, tenantId } = authResult');
  });

  it('create-portal-session requires a verified gateway subscription binding', () => {
    const code = read(`${functionDir}/create-portal-session/index.ts`);
    expect(code).toContain('gateway_subscription_id');
  });

  it('the webhook refuses to grant entitlement from a tenant-managed gateway', () => {
    const code = read(`${functionDir}/payment-webhook/index.ts`);
    expect(code).toContain('platformManaged');
  });

  it('only entitlement-granting event types are gated on platform gateway authority', () => {
    const code = read(`${functionDir}/payment-webhook/index.ts`);
    // Cancellation and dunning must keep working on a tenant-managed gateway:
    // they reduce access, they never grant it.
    expect(code).toMatch(/ENTITLEMENT_GRANTING_EVENT_TYPES/);
  });
});

describe('payment config surfaces gateway authority', () => {
  it('resolvePaymentConfig reports whether the gateway is platform managed', () => {
    const code = read('../../../../supabase/functions/_shared/payment-config.ts');
    expect(code).toContain('platformManaged');
  });

  it('the environment fallback is platform managed and a tenant row is not', () => {
    const code = read('../../../../supabase/functions/_shared/payment-config.ts');
    expect(code).toMatch(/id:\s*'environment'[\s\S]*?platformManaged:\s*true/);
    expect(code).toMatch(/readTenantConfig[\s\S]*?platformManaged:\s*false/);
  });
});
