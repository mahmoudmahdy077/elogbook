import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  entitlementGrantingEvent,
  grantRequiresPlatformGateway,
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
