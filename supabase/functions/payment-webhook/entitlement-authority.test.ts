import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  entitlementGrantingEvent,
  grantRequiresPlatformGateway,
  verifiedTenantRouting,
  readTenantIdFromEvent,
} from './index.ts';

const BASE = {
  id: 'evt_1',
  type: 'checkout.session.completed',
  created: 100,
  livemode: false,
  data: {
    object: {
      metadata: {
        tenant_id: '00000000-0000-0000-0000-000000000001',
        plan_id: '00000000-0000-0000-0000-000000003332',
      },
      payment_status: 'paid',
      subscription: 'sub_1',
      customer: 'cus_1',
    },
  },
};

Deno.test('a platform-managed gateway may grant entitlement', () => {
  assertEquals(
    grantRequiresPlatformGateway(BASE, { platformManaged: true }),
    false,
  );
});

Deno.test('a tenant-managed gateway cannot grant entitlement', () => {
  assertEquals(
    grantRequiresPlatformGateway(BASE, { platformManaged: false }),
    true,
  );
});

Deno.test('checkout completion is an entitlement-granting event', () => {
  assertEquals(entitlementGrantingEvent(BASE), true);
  assertEquals(
    entitlementGrantingEvent({ ...BASE, type: 'invoice.paid' }),
    true,
    'a paid invoice reactivates a subscription, so it grants entitlement',
  );
  assertEquals(
    entitlementGrantingEvent({ ...BASE, type: 'customer.subscription.updated' }),
    true,
    'a subscription update can move a row back to active, so it grants entitlement',
  );
});

Deno.test('cancellation and dunning keep working on a tenant-managed gateway', () => {
  // These only ever REDUCE access. Gating them on platform authority would
  // leave a tenant unable to cancel or be dunned, which is a denial of service
  // in the other direction.
  for (const type of [
    'customer.subscription.deleted',
    'invoice.payment_failed',
    'customer.subscription.trial_will_end',
  ]) {
    assertEquals(entitlementGrantingEvent({ ...BASE, type }), false, `${type} must not require platform authority`);
    assertEquals(
      grantRequiresPlatformGateway({ ...BASE, type }, { platformManaged: false }),
      false,
      `${type} must not be blocked on a tenant-managed gateway`,
    );
  }
});

Deno.test('an unknown event type does not grant entitlement', () => {
  assertEquals(
    entitlementGrantingEvent({ ...BASE, type: 'invoice.created' }),
    false,
  );
});

// ---------------------------------------------------------------------------
// Tenant routing
//
// The webhook has to pick a signing secret before it can verify a signature, so
// it reads the tenant from the UNVERIFIED body. Everything that matters must
// then re-derive the tenant from the VERIFIED event, because the pre-verification
// read is attacker-controlled: anybody who can reach the endpoint can put any
// tenant id in the metadata of a payload that will then be signed with that
// tenant's secret.
//
// The hazard is specific: signature verification proves the payload came from
// the account whose secret matched. It does NOT prove the metadata is
// trustworthy -- the account holder set the metadata themselves. So a tenant
// that controls its own Stripe account can sign `metadata.tenant_id = <victim>`
// and, if that value were used for the entitlement write, grant itself access on
// another tenant's subscription.
// ---------------------------------------------------------------------------

const VICTIM = '00000000-0000-0000-0000-00000000dead';

Deno.test('a signed event cannot re-point its own tenant', () => {
  // Signed by the attacker's own account; metadata names someone else. The
  // verified routing tenant must be the one the secret belongs to, so the
  // mismatch is refused rather than followed.
  const result = verifiedTenantRouting({
    verifiedEventTenantId: '00000000-0000-0000-0000-000000000001',
    signatureConfigTenantId: VICTIM,
  });
  assertEquals(result, { ok: false, reason: 'tenant_mismatch' });
});

Deno.test('routing accepts only the tenant whose secret verified the event', () => {
  const result = verifiedTenantRouting({
    verifiedEventTenantId: VICTIM,
    signatureConfigTenantId: VICTIM,
  });
  assertEquals(result, { ok: true, tenantId: VICTIM });
});

Deno.test('a verified event with no tenant is routed by its signing secret', () => {
  // Subscription lifecycle events carry no tenant metadata. The signature is
  // then the only authority for which tenant the event belongs to, which is
  // exactly what the secret identifies.
  const result = verifiedTenantRouting({
    verifiedEventTenantId: null,
    signatureConfigTenantId: VICTIM,
  });
  assertEquals(result, { ok: true, tenantId: VICTIM });
});

Deno.test('a verified event naming a different tenant is never used for entitlement', () => {
  // Defence in depth at the call site: even if a mismatch slipped through, the
  // entitlement-granting types are refused on a tenant-managed gateway, and the
  // mismatch itself is a refusal.
  assertEquals(
    verifiedTenantRouting({ verifiedEventTenantId: VICTIM, signatureConfigTenantId: '00000000-0000-0000-0000-000000000002' }),
    { ok: false, reason: 'tenant_mismatch' },
  );
});

Deno.test('the pre-verification tenant read accepts only a bare uuid', () => {
  const uuid = '00000000-0000-0000-0000-000000000001';
  assertEquals(
    readTenantIdFromEvent(JSON.stringify({ data: { object: { metadata: { tenant_id: uuid } } } })),
    uuid,
  );
  // A value that is not a uuid is not a tenant lookup key, so it is ignored
  // rather than passed to the config resolver.
  for (const bad of ['', 'not-a-uuid', '1;DROP TABLE', "00000000-0000-0000-0000-000000000001' OR 1=1--"]) {
    assertEquals(
      readTenantIdFromEvent(JSON.stringify({ data: { object: { metadata: { tenant_id: bad } } } })),
      null,
      `must reject ${JSON.stringify(bad)}`,
    );
  }
  assertEquals(readTenantIdFromEvent('not json'), null);
});
