export interface StripeEventLike {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

export interface ProviderOrder {
  created: number;
  objectVersion: number;
}

export interface SubscriptionRecord {
  id?: string;
  tenantId: string;
  status: string;
  gatewaySubscriptionId: string;
  eventCreated: number;
  objectVersion: number;
  planId?: string;
}

export interface CheckoutSubscriptionInput {
  tenantId: string;
  planId: string;
  status: 'active';
  gatewaySubscriptionId: string;
  stripeCustomerId: string | null;
  eventId: string;
  eventCreated: number;
  objectVersion: number;
}

export interface SubscriptionUpdateInput {
  gatewaySubscriptionId: string;
  subscriptionRowId?: string;
  stripeCustomerId?: string | null;
  eventId: string;
  eventCreated: number;
  objectVersion: number;
  status: string;
  planId?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  allowCanceled: boolean;
}

export interface PaymentInput {
  tenantId: string;
  amount: number;
  currency: string;
  gatewayPaymentIntentId: string | null;
  stripeEventId: string;
}

export interface StripeEventStore {
  subscriptionRecord?: SubscriptionRecord;
  checkoutInput?: CheckoutSubscriptionInput;
  paymentInput?: PaymentInput;
  tenantExists(tenantId: string): Promise<boolean>;
  planExists(planId: string): Promise<boolean>;
  planIdForPrice(priceId: string): Promise<string | null>;
  findTenantSubscription(tenantId: string): Promise<SubscriptionRecord | null>;
  findGatewaySubscription(gatewaySubscriptionId: string): Promise<SubscriptionRecord | null>;
  writeCheckoutSubscription(input: CheckoutSubscriptionInput): Promise<void>;
  updateSubscription(input: SubscriptionUpdateInput): Promise<boolean>;
  recordPayment(input: PaymentInput): Promise<void>;
}

export interface StripeEventLifecycle {
  markProcessed(eventId: string): Promise<void>;
  markFailed(eventId: string, reason: string): Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function idValue(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return stringValue(record(value).id);
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = numberValue(value);
  return parsed === null || !Number.isInteger(parsed) || parsed < 0 ? 0 : parsed;
}

export function providerOrder(event: StripeEventLike): ProviderOrder {
  const object = record(event.data?.object);
  return {
    created: nonNegativeInteger(event.created),
    objectVersion: nonNegativeInteger(object.version ?? object.object_version),
  };
}

export function isStripeEventNewer(incoming: ProviderOrder, current: ProviderOrder): boolean {
  if (incoming.created !== current.created) return incoming.created > current.created;
  return incoming.objectVersion > current.objectVersion;
}

export function retryDelaySeconds(attempt: number): number {
  const normalized = Math.max(1, Math.floor(attempt));
  return Math.min(3_600, 30 * 2 ** Math.min(normalized - 1, 10));
}

export function retryableFailureReason(error: unknown): string {
  if (error instanceof Error) {
    if (error.name && error.name !== 'Error') {
      return `retryable_${error.name.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80)}`;
    }
    if (/^[a-z0-9_.-]{1,80}$/.test(error.message)) return `retryable_${error.message}`;
  }
  return 'processing_error';
}

export function assertDatabaseResult(result: unknown, operation: string): void {
  if (typeof result !== 'object' || result === null) {
    throw new Error(`${operation}: database result missing`);
  }
  const error = (result as { error?: { message?: string } | null }).error;
  if (error) throw new Error(`${operation}: ${error.message ?? 'database error'}`);
}

export function isPaidCheckoutSession(object: Record<string, unknown>): boolean {
  const status = stringValue(object.payment_status);
  return status === 'paid' || status === 'no_payment_required';
}

function isPaidInvoice(object: Record<string, unknown>): boolean {
  return object.paid === true || object.status === 'paid';
}

function metadataOf(object: Record<string, unknown>): Record<string, unknown> {
  return record(object.metadata);
}

function mapSubscriptionStatus(status: string): string {
  const statuses: Record<string, string> = {
    active: 'active',
    past_due: 'past_due',
    canceled: 'canceled',
    unpaid: 'unpaid',
    incomplete: 'incomplete',
    incomplete_expired: 'canceled',
    trialing: 'trialing',
    paused: 'paused',
  };
  return statuses[status] ?? status;
}

function periodTimestamp(value: unknown): string | null {
  const seconds = numberValue(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstPriceId(object: Record<string, unknown>): string | null {
  const items = record(object.items);
  const data = Array.isArray(items.data) ? items.data : [];
  const firstItem = record(data[0]);
  return idValue(firstItem.price);
}

function requireEventIdentity(event: StripeEventLike): ProviderOrder {
  if (!stringValue(event.id) || !stringValue(event.type) || !Number.isInteger(event.created) || event.created < 0) {
    throw new Error('invalid_provider_event');
  }
  return providerOrder(event);
}

function requireSubscriptionId(object: Record<string, unknown>): string {
  const id = idValue(object.subscription) ?? idValue(object.id);
  if (!id) throw new Error('missing_subscription');
  return id;
}

function assertTenantMatch(
  subscription: SubscriptionRecord | null,
  tenantId: string,
): SubscriptionRecord | null {
  if (subscription && subscription.tenantId !== tenantId) throw new Error('cross_tenant_event');
  return subscription;
}

export async function processStripeEvent(
  store: StripeEventStore,
  event: StripeEventLike,
  tenantId: string,
): Promise<void> {
  const order = requireEventIdentity(event);
  const object = record(event.data?.object);

  switch (event.type) {
    case 'checkout.session.completed': {
      const metadata = metadataOf(object);
      const eventTenantId = stringValue(metadata.tenant_id);
      const planId = stringValue(metadata.plan_id);
      if (!eventTenantId || eventTenantId !== tenantId || !planId) throw new Error('checkout_tenant_mismatch');
      if (!isPaidCheckoutSession(object)) return;
      const subscriptionId = idValue(object.subscription);
      if (!subscriptionId) return;
      if (!await store.tenantExists(tenantId)) throw new Error('unknown_checkout_tenant');
      if (!await store.planExists(planId)) throw new Error('unknown_checkout_plan');
      await store.writeCheckoutSubscription({
        tenantId,
        planId,
        status: 'active',
        gatewaySubscriptionId: subscriptionId,
        stripeCustomerId: idValue(object.customer),
        eventId: event.id,
        eventCreated: order.created,
        objectVersion: order.objectVersion,
      });
      return;
    }

    case 'customer.subscription.deleted': {
      const subscriptionId = requireSubscriptionId(object);
      const subscription = await store.findGatewaySubscription(subscriptionId);
      assertTenantMatch(subscription, tenantId);
      if (!subscription) return;
      await store.updateSubscription({
        gatewaySubscriptionId: subscriptionId,
        eventId: event.id,
        eventCreated: order.created,
        objectVersion: order.objectVersion,
        status: 'canceled',
        allowCanceled: true,
      });
      return;
    }

    case 'customer.subscription.updated': {
      const subscriptionId = requireSubscriptionId(object);
      const status = stringValue(object.status);
      if (!status) throw new Error('missing_subscription_status');
      const subscription = await store.findGatewaySubscription(subscriptionId);
      assertTenantMatch(subscription, tenantId);
      if (!subscription) return;
      const priceId = firstPriceId(object);
      const planId = priceId ? await store.planIdForPrice(priceId) : null;
      // The mapped status may be access-granting (active/trialing), and an
      // entitlement-bearing row has to stay bound to the gateway customer. The
      // event carries it; omit it when the event does not so the stored binding
      // is left alone rather than nulled.
      const customerId = idValue(object.customer);
      await store.updateSubscription({
        gatewaySubscriptionId: subscriptionId,
        eventId: event.id,
        eventCreated: order.created,
        objectVersion: order.objectVersion,
        status: mapSubscriptionStatus(status),
        ...(planId ? { planId } : {}),
        ...(customerId ? { stripeCustomerId: customerId } : {}),
        allowCanceled: false,
      });
      return;
    }

    case 'invoice.paid': {
      const subscriptionId = idValue(object.subscription);
      if (!subscriptionId || !isPaidInvoice(object)) return;
      const subscription = await store.findGatewaySubscription(subscriptionId);
      assertTenantMatch(subscription, tenantId);
      if (!subscription) return;
      const customerId = idValue(object.customer);
      await store.updateSubscription({
        gatewaySubscriptionId: subscriptionId,
        eventId: event.id,
        eventCreated: order.created,
        objectVersion: order.objectVersion,
        status: 'active',
        periodStart: periodTimestamp(object.period_start),
        periodEnd: periodTimestamp(object.period_end),
        ...(customerId ? { stripeCustomerId: customerId } : {}),
        allowCanceled: false,
      });
      const amount = numberValue(object.amount_paid) ?? 0;
      if (amount > 0) {
        await store.recordPayment({
          tenantId,
          amount,
          currency: stringValue(object.currency) ?? 'usd',
          gatewayPaymentIntentId: idValue(object.payment_intent),
          stripeEventId: event.id,
        });
      }
      return;
    }

    case 'invoice.payment_failed': {
      const subscriptionId = idValue(object.subscription);
      if (!subscriptionId) return;
      const subscription = await store.findGatewaySubscription(subscriptionId);
      assertTenantMatch(subscription, tenantId);
      if (!subscription) return;
      await store.updateSubscription({
        gatewaySubscriptionId: subscriptionId,
        eventId: event.id,
        eventCreated: order.created,
        objectVersion: order.objectVersion,
        status: 'past_due',
        allowCanceled: false,
      });
      return;
    }

    case 'customer.subscription.trial_will_end':
      return;
  }
}

export async function processClaimedStripeEvent(
  store: StripeEventStore,
  lifecycle: StripeEventLifecycle,
  event: StripeEventLike,
  tenantId: string,
  _claimToken: string,
): Promise<void> {
  try {
    await processStripeEvent(store, event, tenantId);
    await lifecycle.markProcessed(event.id);
  } catch (error) {
    try {
      await lifecycle.markFailed(event.id, retryableFailureReason(error));
    } catch {
      throw error;
    }
    throw error;
  }
}
