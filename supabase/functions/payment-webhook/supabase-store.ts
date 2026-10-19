import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import {
  assertDatabaseResult,
  isStripeEventNewer,
  type CheckoutSubscriptionInput,
  type PaymentInput,
  type StripeEventLifecycle,
  type StripeEventStore,
  type SubscriptionRecord,
  type SubscriptionUpdateInput,
} from './event-processing.ts';

export type SupabaseClient = ReturnType<typeof createClient>;
type QueryResult = { data?: unknown; error?: { code?: string; message?: string } | null };

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function integerValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function subscriptionRecord(value: unknown): SubscriptionRecord | null {
  if (value === null || value === undefined) return null;
  const row = record(Array.isArray(value) ? value[0] : value);
  const tenantId = stringValue(row.tenant_id);
  const gatewaySubscriptionId = stringValue(row.gateway_subscription_id);
  if (!tenantId) return null;
  return {
    id: stringValue(row.id) || undefined,
    tenantId,
    status: stringValue(row.status),
    gatewaySubscriptionId,
    eventCreated: integerValue(row.stripe_event_created),
    objectVersion: integerValue(row.stripe_object_version),
    planId: stringValue(row.plan_id) || undefined,
  };
}

function queryResult(value: unknown, operation: string): QueryResult {
  assertDatabaseResult(value, operation);
  return value as QueryResult;
}

function isUniqueViolation(value: unknown): boolean {
  const error = record(value).error;
  const message = record(error).message;
  return record(error).code === '23505' || (typeof message === 'string' && message.includes('23505'));
}

export class SupabaseStripeEventStore implements StripeEventStore {
  constructor(private readonly client: SupabaseClient) {}

  async tenantExists(tenantId: string): Promise<boolean> {
    const result = await this.client
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle();
    return Boolean(queryResult(result, 'validate checkout tenant').data);
  }

  async planExists(planId: string): Promise<boolean> {
    const result = await this.client
      .from('subscription_plans')
      .select('id')
      .eq('id', planId)
      .maybeSingle();
    return Boolean(queryResult(result, 'validate checkout plan').data);
  }

  async planIdForPrice(priceId: string): Promise<string | null> {
    const result = await this.client
      .from('subscription_plans')
      .select('id')
      .eq('stripe_price_id', priceId)
      .maybeSingle();
    const data = queryResult(result, 'resolve subscription plan').data;
    return data ? stringValue(record(data).id) || null : null;
  }

  async findTenantSubscription(tenantId: string): Promise<SubscriptionRecord | null> {
    const result = await this.client
      .from('subscriptions')
      .select('id, tenant_id, status, gateway_subscription_id, plan_id, stripe_event_created, stripe_object_version')
      .eq('tenant_id', tenantId)
      .order('stripe_event_created', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return subscriptionRecord(queryResult(result, 'find checkout subscription').data);
  }

  async findGatewaySubscription(gatewaySubscriptionId: string): Promise<SubscriptionRecord | null> {
    const result = await this.client
      .from('subscriptions')
      .select('id, tenant_id, status, gateway_subscription_id, plan_id, stripe_event_created, stripe_object_version')
      .eq('gateway_subscription_id', gatewaySubscriptionId)
      .order('stripe_event_created', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return subscriptionRecord(queryResult(result, 'find subscription').data);
  }

  async writeCheckoutSubscription(input: CheckoutSubscriptionInput): Promise<void> {
    const existing = await this.findTenantSubscription(input.tenantId);
    if (existing) {
      if (existing.gatewaySubscriptionId === input.gatewaySubscriptionId && existing.status === 'canceled') return;
      if (!isStripeEventNewer(
        { created: input.eventCreated, objectVersion: input.objectVersion },
        { created: existing.eventCreated, objectVersion: existing.objectVersion },
      )) return;
      await this.updateSubscription({
        gatewaySubscriptionId: input.gatewaySubscriptionId,
        ...(existing.id ? { subscriptionRowId: existing.id } : {}),
        stripeCustomerId: input.stripeCustomerId,
        eventId: input.eventId,
        eventCreated: input.eventCreated,
        objectVersion: input.objectVersion,
        status: input.status,
        planId: input.planId,
        allowCanceled: true,
      });
      return;
    }

    const result = await this.client
      .from('subscriptions')
      .insert({
        tenant_id: input.tenantId,
        plan_id: input.planId,
        status: input.status,
        gateway_subscription_id: input.gatewaySubscriptionId,
        stripe_customer_id: input.stripeCustomerId,
        stripe_event_created: input.eventCreated,
        stripe_object_version: input.objectVersion,
        last_stripe_event_id: input.eventId,
      })
      .select('id')
      .maybeSingle();
    try {
      queryResult(result, 'write checkout subscription');
    } catch (error) {
      if (isUniqueViolation(result)) {
        const concurrent = await this.findTenantSubscription(input.tenantId);
        if (!concurrent) throw error;
        if (isStripeEventNewer(
          { created: input.eventCreated, objectVersion: input.objectVersion },
          { created: concurrent.eventCreated, objectVersion: concurrent.objectVersion },
        )) {
          await this.updateSubscription({
            gatewaySubscriptionId: input.gatewaySubscriptionId,
            ...(concurrent.id ? { subscriptionRowId: concurrent.id } : {}),
            stripeCustomerId: input.stripeCustomerId,
            eventId: input.eventId,
            eventCreated: input.eventCreated,
            objectVersion: input.objectVersion,
            status: input.status,
            planId: input.planId,
            allowCanceled: concurrent.status !== 'canceled',
          });
        }
        return;
      }
      throw error;
    }
  }

  async updateSubscription(input: SubscriptionUpdateInput): Promise<boolean> {
    if (!input.gatewaySubscriptionId) throw new Error('missing gateway subscription');
    const ordering = `stripe_event_created.lt.${input.eventCreated},and(stripe_event_created.eq.${input.eventCreated},stripe_object_version.lt.${input.objectVersion})`;
    const values: Record<string, unknown> = {
      status: input.status,
      stripe_event_created: input.eventCreated,
      stripe_object_version: input.objectVersion,
      last_stripe_event_id: input.eventId,
    };
    values.gateway_subscription_id = input.gatewaySubscriptionId;
    if (input.stripeCustomerId !== undefined) values.stripe_customer_id = input.stripeCustomerId;
    if (input.planId) values.plan_id = input.planId;
    if (input.periodStart) values.current_period_start = input.periodStart;
    if (input.periodEnd) values.current_period_end = input.periodEnd;

    let query = this.client
      .from('subscriptions')
      .update(values)
      .eq(input.subscriptionRowId ? 'id' : 'gateway_subscription_id', input.subscriptionRowId ?? input.gatewaySubscriptionId)
      .or(ordering);
    if (!input.allowCanceled) query = query.neq('status', 'canceled');
    const result = await query.select('id').maybeSingle();
    return queryResult(result, 'update subscription').data !== null;
  }

  async recordPayment(input: PaymentInput): Promise<void> {
    const result = await this.client
      .from('payments')
      .insert({
        tenant_id: input.tenantId,
        amount: input.amount,
        currency: input.currency,
        gateway_payment_intent_id: input.gatewayPaymentIntentId,
        stripe_event_id: input.stripeEventId,
        status: 'completed',
      });
    try {
      queryResult(result, 'write paid invoice payment');
    } catch (error) {
      if (isUniqueViolation(result)) return;
      throw error;
    }
  }
}

export class SupabaseStripeEventLifecycle implements StripeEventLifecycle {
  constructor(private readonly client: SupabaseClient, private readonly claimToken: string) {}

  async markProcessed(eventId: string): Promise<void> {
    const result = await this.client.rpc('mark_stripe_event_processed', {
      p_event_id: eventId,
      p_claim_token: this.claimToken,
    });
    const data = queryResult(result, 'mark stripe event processed').data;
    if (data !== true && (record(data).success !== true)) {
      throw new Error('mark stripe event processed: claim was not completed');
    }
  }

  async markFailed(eventId: string, reason: string): Promise<void> {
    const result = await this.client.rpc('mark_stripe_event_failed', {
      p_event_id: eventId,
      p_claim_token: this.claimToken,
      p_reason: reason.slice(0, 1_000),
    });
    const data = queryResult(result, 'mark stripe event failed').data;
    if (data !== true && (record(data).success !== true)) {
      throw new Error('mark stripe event failed: claim was not released');
    }
  }
}
