import { assertEquals, assertRejects } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  isPaidCheckoutSession,
  isStripeEventNewer,
  processClaimedStripeEvent,
  processStripeEvent,
  retryDelaySeconds,
  type CheckoutSubscriptionInput,
  type PaymentInput,
  type StripeEventLike,
  type StripeEventStore,
  type SubscriptionRecord,
  type SubscriptionUpdateInput,
} from './event-processing.ts';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PLAN_ID = '00000000-0000-0000-0000-000000000002';

function event(type: string, created: number, object: Record<string, unknown>): StripeEventLike {
  return {
    id: `evt_${type.replaceAll('.', '_')}_${created}`,
    type,
    created,
    livemode: false,
    data: { object },
  };
}

class RecordingStore implements StripeEventStore {
  readonly updates: SubscriptionUpdateInput[] = [];
  readonly checkoutWrites: CheckoutSubscriptionInput[] = [];
  readonly payments: PaymentInput[] = [];
  readonly processed: string[] = [];
  readonly failed: Array<{ eventId: string; reason: string }> = [];
  failOn = '';
  subscription: {
    tenantId: string;
    status: string;
    gatewaySubscriptionId: string;
    eventCreated: number;
    objectVersion: number;
    planId?: string;
  } | null = null;

  async tenantExists(tenantId: string): Promise<boolean> {
    if (this.failOn === 'tenantExists') throw new Error('database_failure');
    return tenantId === TENANT_ID;
  }

  async planExists(planId: string): Promise<boolean> {
    if (this.failOn === 'planExists') throw new Error('database_failure');
    return planId === PLAN_ID;
  }

  async planIdForPrice(priceId: string): Promise<string | null> {
    if (this.failOn === 'planIdForPrice') throw new Error('database_failure');
    return priceId === 'price_new' ? PLAN_ID : null;
  }

  async findTenantSubscription(tenantId: string): Promise<SubscriptionRecord | null> {
    if (this.failOn === 'findTenantSubscription') throw new Error('database_failure');
    return this.subscription?.tenantId === tenantId ? this.subscription : null;
  }

  async findGatewaySubscription(gatewaySubscriptionId: string): Promise<SubscriptionRecord | null> {
    if (this.failOn === 'findGatewaySubscription') throw new Error('database_failure');
    return this.subscription?.gatewaySubscriptionId === gatewaySubscriptionId ? this.subscription : null;
  }

  async writeCheckoutSubscription(input: CheckoutSubscriptionInput): Promise<void> {
    if (this.failOn === 'writeCheckoutSubscription') throw new Error('database_failure');
    this.checkoutWrites.push(input);
  }

  async updateSubscription(input: SubscriptionUpdateInput): Promise<boolean> {
    if (this.failOn === 'updateSubscription') throw new Error('database_failure');
    this.updates.push(input);
    if (!this.subscription) return false;
    if (!isStripeEventNewer({ created: input.eventCreated, objectVersion: input.objectVersion }, {
      created: this.subscription.eventCreated,
      objectVersion: this.subscription.objectVersion,
    })) return false;
    if (!input.allowCanceled && this.subscription.status === 'canceled') return false;
    this.subscription.status = input.status;
    if (input.planId) this.subscription.planId = input.planId;
    return true;
  }

  async recordPayment(input: PaymentInput): Promise<void> {
    if (this.failOn === 'recordPayment') throw new Error('database_failure');
    this.payments.push(input);
  }

  async markProcessed(eventId: string): Promise<void> {
    if (this.failOn === 'markProcessed') throw new Error('database_failure');
    this.processed.push(eventId);
  }

  async markFailed(eventId: string, reason: string): Promise<void> {
    if (this.failOn === 'markFailed') throw new Error('database_failure');
    this.failed.push({ eventId, reason });
  }
}

Deno.test('retryDelaySeconds uses bounded exponential backoff', () => {
  assertEquals(retryDelaySeconds(1), 30);
  assertEquals(retryDelaySeconds(2), 60);
  assertEquals(retryDelaySeconds(3), 120);
  assertEquals(retryDelaySeconds(20), 3_600);
});

Deno.test('checkout entitlement requires paid or no-payment-required status', () => {
  assertEquals(isPaidCheckoutSession({ payment_status: 'paid' }), true);
  assertEquals(isPaidCheckoutSession({ payment_status: 'no_payment_required' }), true);
  assertEquals(isPaidCheckoutSession({ payment_status: 'unpaid' }), false);
  assertEquals(isPaidCheckoutSession({}), false);
});

Deno.test('provider ordering rejects old or equal events', () => {
  assertEquals(isStripeEventNewer({ created: 200, objectVersion: 1 }, { created: 100, objectVersion: 9 }), true);
  assertEquals(isStripeEventNewer({ created: 200, objectVersion: 1 }, { created: 200, objectVersion: 0 }), true);
  assertEquals(isStripeEventNewer({ created: 100, objectVersion: 9 }, { created: 200, objectVersion: 1 }), false);
  assertEquals(isStripeEventNewer({ created: 200, objectVersion: 1 }, { created: 200, objectVersion: 1 }), false);
});

Deno.test('a trialing update carries the customer binding it needs to stay active', async () => {
  // `trialing` grants access, so the subscription row is entitlement-bearing and
  // must be bound to a gateway subscription AND customer. Without the customer
  // the write would fail the binding constraint and the tenant would lose a
  // subscription it is legitimately entitled to.
  const store = new RecordingStore();
  store.subscription = {
    tenantId: TENANT_ID,
    status: 'incomplete',
    gatewaySubscriptionId: 'sub_1',
    eventCreated: 100,
    objectVersion: 1,
  };
  await processStripeEvent(store, event('customer.subscription.updated', 200, {
    id: 'sub_1',
    status: 'trialing',
    customer: 'cus_1',
    items: { data: [{ price: { id: 'price_new' } }] },
  }), TENANT_ID);
  assertEquals(store.updates[0].status, 'trialing');
  assertEquals(store.updates[0].stripeCustomerId, 'cus_1');
});

Deno.test('a paid invoice carries the customer binding it needs to stay active', async () => {
  const store = new RecordingStore();
  store.subscription = {
    tenantId: TENANT_ID,
    status: 'past_due',
    gatewaySubscriptionId: 'sub_1',
    eventCreated: 100,
    objectVersion: 1,
  };
  await processStripeEvent(store, event('invoice.paid', 200, {
    subscription: 'sub_1',
    customer: 'cus_1',
    paid: true,
    status: 'paid',
    amount_paid: 1000,
    currency: 'usd',
  }), TENANT_ID);
  assertEquals(store.updates[0].status, 'active');
  assertEquals(store.updates[0].stripeCustomerId, 'cus_1');
});

Deno.test('an event with no customer field leaves the existing binding untouched', async () => {
  const store = new RecordingStore();
  store.subscription = {
    tenantId: TENANT_ID,
    status: 'incomplete',
    gatewaySubscriptionId: 'sub_1',
    eventCreated: 100,
    objectVersion: 1,
  };
  await processStripeEvent(store, event('customer.subscription.updated', 200, {
    id: 'sub_1',
    status: 'trialing',
    items: { data: [{ price: { id: 'price_new' } }] },
  }), TENANT_ID);
  assertEquals(store.updates[0].stripeCustomerId, undefined);
});

Deno.test('unpaid checkout completion does not grant entitlement', async () => {
  const store = new RecordingStore();
  await processStripeEvent(store, event('checkout.session.completed', 100, {
    metadata: { tenant_id: TENANT_ID, plan_id: PLAN_ID },
    payment_status: 'unpaid',
    subscription: 'sub_1',
  }), TENANT_ID);
  assertEquals(store.checkoutWrites, []);
});

Deno.test('paid checkout completion writes ordered subscription state', async () => {
  const store = new RecordingStore();
  await processStripeEvent(store, event('checkout.session.completed', 100, {
    metadata: { tenant_id: TENANT_ID, plan_id: PLAN_ID },
    payment_status: 'paid',
    subscription: 'sub_1',
    customer: 'cus_1',
  }), TENANT_ID);
  assertEquals(store.checkoutWrites.length, 1);
  assertEquals(store.checkoutWrites[0].status, 'active');
  assertEquals(store.checkoutWrites[0].eventCreated, 100);
});

Deno.test('old subscription update cannot overwrite newer plan or status', async () => {
  const store = new RecordingStore();
  store.subscription = {
    tenantId: TENANT_ID,
    status: 'active',
    gatewaySubscriptionId: 'sub_1',
    eventCreated: 200,
    objectVersion: 2,
    planId: 'plan_new',
  };
  await processStripeEvent(store, event('customer.subscription.updated', 100, {
    id: 'sub_1',
    status: 'canceled',
    items: { data: [{ price: { id: 'price_old' } }] },
  }), TENANT_ID);
  assertEquals(store.subscription.status, 'active');
  assertEquals(store.subscription.planId, 'plan_new');
});

Deno.test('delayed invoice paid cannot reactivate a canceled subscription', async () => {
  const store = new RecordingStore();
  store.subscription = {
    tenantId: TENANT_ID,
    status: 'canceled',
    gatewaySubscriptionId: 'sub_1',
    eventCreated: 200,
    objectVersion: 2,
  };
  await processStripeEvent(store, event('invoice.paid', 100, {
    subscription: 'sub_1',
    paid: true,
    status: 'paid',
    amount_paid: 1000,
    currency: 'usd',
    period_start: 100,
    period_end: 200,
  }), TENANT_ID);
  assertEquals(store.subscription.status, 'canceled');
  assertEquals(store.updates[0].allowCanceled, false);
});

Deno.test('failed required write marks the event failed and never processed', async () => {
  const store = new RecordingStore();
  store.subscription = {
    tenantId: TENANT_ID,
    status: 'active',
    gatewaySubscriptionId: 'sub_1',
    eventCreated: 50,
    objectVersion: 0,
  };
  store.failOn = 'updateSubscription';
  const incoming = event('customer.subscription.deleted', 100, { id: 'sub_1' });
  await assertRejects(
    () => processClaimedStripeEvent(store, store, incoming, TENANT_ID, 'claim-1'),
    Error,
    'database_failure',
  );
  assertEquals(store.processed, []);
  assertEquals(store.failed.length, 1);
  assertEquals(store.failed[0].eventId, incoming.id);
  assertEquals(store.failed[0].reason, 'retryable_database_failure');
});

Deno.test('failed completion write also releases the event for retry', async () => {
  const store = new RecordingStore();
  store.failOn = 'markProcessed';
  const incoming = event('customer.subscription.trial_will_end', 100, {});
  await assertRejects(
    () => processClaimedStripeEvent(store, store, incoming, TENANT_ID, 'claim-1'),
    Error,
    'database_failure',
  );
  assertEquals(store.processed, []);
  assertEquals(store.failed.length, 1);
});
