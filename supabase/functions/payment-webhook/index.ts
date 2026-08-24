import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { corsHeaders } from '../_shared/auth.ts';

const WEBHOOK_ORIGINS = ['https://api.stripe.com'];

type CachedConfig = { id: string; tenantId: string; secret: string; webhookSecret: string; mode: string; fetchedAt: number };
const configCache = new Map<string, CachedConfig>();
const CONFIG_CACHE_TTL = 300_000;

function readTenantIdFromEvent(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    const metadata = parsed?.data?.object?.metadata;
    return (metadata?.tenant_id as string | null) ?? null;
  } catch {
    return null;
  }
}

export async function resolveTenantConfig(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<CachedConfig | null> {
  const cached = configCache.get(tenantId);
  if (cached && (Date.now() - cached.fetchedAt) < CONFIG_CACHE_TTL) return cached;

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return null;

  // Service-role client bypasses the role-gated secret view (Task 1.1) and
  // reads the base table; decrypt_with_version is service_role-executable.
  const { data, error } = await supabase
    .from('payment_gateway_config')
    .select('id, tenant_id, secret_key_enc, webhook_secret_enc, mode, key_version')
    .eq('tenant_id', tenant.id)
    .eq('provider', 'stripe')
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data) return null;

  const { data: dec, error: decError } = await supabase.rpc('decrypt_with_version', {
    p_encrypted: data.secret_key_enc,
    p_version: data.key_version,
  });
  if (decError || !dec) return null;

  const { data: decWs, error: decWsError } = await supabase.rpc('decrypt_with_version', {
    p_encrypted: data.webhook_secret_enc,
    p_version: data.key_version,
  });
  if (decWsError) return null;

  const cfg: CachedConfig = {
    id: data.id,
    tenantId: data.tenant_id,
    secret: dec as string,
    webhookSecret: (decWs ?? '') as string,
    mode: data.mode,
    fetchedAt: Date.now(),
  };
  configCache.set(tenantId, cfg);
  return cfg;
}

export async function handleWebhook(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin && WEBHOOK_ORIGINS.includes(origin) ? origin : null);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response(
      JSON.stringify({ error: 'Missing stripe-signature header' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const body = await req.text();

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  async function markEventFailed(eventId: string, reason: string): Promise<void> {
    try {
      await supabase.rpc('mark_stripe_event_failed', {
        p_event_id: eventId,
        p_reason: reason,
      });
    } catch (logErr) {
      console.error('Failed to record stripe event failure', logErr);
    }
  }

  // Tenant resolution: create-checkout sets metadata.tenant_id on the
  // checkout session. All subscription events carry the checkout session's
  // metadata via their subscription metadata. Prefer the event's own
  // metadata; fall back to the subscription's metadata.
  let tenantIdFromEvent = readTenantIdFromEvent(body);
  if (!tenantIdFromEvent) {
    try {
      const parsed = JSON.parse(body);
      tenantIdFromEvent = (parsed?.data?.object?.metadata?.tenant_id as string | null) ?? null;
    } catch {
      tenantIdFromEvent = null;
    }
  }

  let gwConfig: CachedConfig | null = null;
  if (tenantIdFromEvent) {
    gwConfig = await resolveTenantConfig(supabase, tenantIdFromEvent);
  }

  if (!gwConfig) {
    // Platform-default gateway config for the global tenant.
    gwConfig = await resolveTenantConfig(supabase, '00000000-0000-0000-0000-000000000000');
  }

  if (!gwConfig) {
    return new Response(
      JSON.stringify({ error: 'Could not identify tenant from webhook' }),
      { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const stripe = new Stripe(gwConfig.secret, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, gwConfig.webhookSecret);
  } catch (sigErr) {
    console.error('Stripe webhook signature verification failed', {
      error: sigErr instanceof Error ? sigErr.message : String(sigErr),
    });
    return new Response(
      JSON.stringify({ error: 'Signature verification failed' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const expectedLive = gwConfig.mode === 'live';
  if (event.livemode !== expectedLive) {
    return new Response(
      JSON.stringify({ error: 'Mode mismatch' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { data: existingEvent } = await supabase
    .from('stripe_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle();

  if (existingEvent) {
    return new Response(
      JSON.stringify({ received: true, duplicate: true }),
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { error: insertError } = await supabase
    .from('stripe_events')
    .insert({
      stripe_event_id: event.id,
      event_type: event.type,
      mode: gwConfig.mode,
      livemode: event.livemode,
      processed: false,
    })
    .select('id')
    .maybeSingle();

  if (insertError) {
    if (insertError.code === '23505') {
      return new Response(
        JSON.stringify({ received: true, duplicate: true }),
        { headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }
    throw insertError;
  }

  try {
    switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const { tenant_id, plan_id } = session.metadata ?? {};

      if (!tenant_id || !plan_id) {
        console.error('Checkout session missing metadata', { event_id: event.id, session_id: session.id });
        break;
      }

      const { data: validTenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('id', tenant_id)
        .maybeSingle();

      if (!validTenant) {
        console.error('Invalid tenant_id in checkout session', { tenant_id, session_id: session.id });
        break;
      }

      const { data: validPlan } = await supabase
        .from('subscription_plans')
        .select('id')
        .eq('id', plan_id)
        .maybeSingle();

      if (!validPlan) {
        console.error('Invalid plan_id in checkout session', { plan_id, session_id: session.id });
        break;
      }

      const subscriptionId = session.subscription as string;
      const customerId = session.customer as string | null;

      // 00055 dropped UNIQUE(tenant_id); only a partial unique index on
      // (tenant_id) WHERE status IN (active, trialing, past_due) remains.
      // Upsert manually: update any existing row for this tenant, else insert.
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('tenant_id', tenant_id)
        .maybeSingle();

      if (existingSub) {
        await supabase
          .from('subscriptions')
          .update({
            plan_id,
            status: 'active',
            gateway_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
          })
          .eq('id', existingSub.id);
      } else {
        await supabase.from('subscriptions').insert({
          tenant_id,
          plan_id,
          status: 'active',
          gateway_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
        });
      }

      break;
    }

    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object;
      const subId = stripeSub.id as string;

      const { data: existing } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('gateway_subscription_id', subId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('subscriptions')
          .update({ status: 'canceled' })
          .eq('gateway_subscription_id', subId);
      }

      break;
    }

    case 'customer.subscription.updated': {
      const updatedSub = event.data.object;
      const updatedSubId = updatedSub.id as string;
      const updatedStatus = updatedSub.status as string;

      const statusMap: Record<string, string> = {
        active: 'active',
        past_due: 'past_due',
        canceled: 'canceled',
        unpaid: 'unpaid',
        incomplete: 'incomplete',
        incomplete_expired: 'canceled',
        trialing: 'trialing',
        paused: 'paused',
      };

      const mappedStatus = statusMap[updatedStatus] || updatedStatus;

      // Map price to plan_id via stripe_price_id
      const priceId = updatedSub.items?.data?.[0]?.price?.id;
      let newPlanId: string | undefined;
      if (priceId) {
        const { data: plan } = await supabase
          .from('subscription_plans')
          .select('id')
          .eq('stripe_price_id', priceId)
          .maybeSingle();
        newPlanId = plan?.id;
      }

      await supabase
        .from('subscriptions')
        .update({
          status: mappedStatus,
          ...(newPlanId ? { plan_id: newPlanId } : {}),
        })
        .eq('gateway_subscription_id', updatedSubId);

      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      const stripeSubId = invoice.subscription as string;

      if (!stripeSubId) break;

      const periodStart = invoice.period_start
        ? new Date((invoice.period_start as number) * 1000).toISOString()
        : null;

      const periodEnd = invoice.period_end
        ? new Date((invoice.period_end as number) * 1000).toISOString()
        : null;

      if (periodStart && periodEnd) {
        await supabase
          .from('subscriptions')
          .update({
            current_period_start: periodStart,
            current_period_end: periodEnd,
            status: 'active',
          })
          .eq('gateway_subscription_id', stripeSubId);
      }

      // Populate payments table
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('tenant_id')
        .eq('gateway_subscription_id', stripeSubId)
        .maybeSingle();

      if (sub && invoice.amount_paid && invoice.amount_paid > 0) {
        await supabase.from('payments').insert({
          tenant_id: sub.tenant_id,
          amount: invoice.amount_paid,
          currency: invoice.currency || 'usd',
          gateway_payment_intent_id: invoice.payment_intent,
          status: 'completed',
        });
      }

      break;
    }

    case 'invoice.payment_failed': {
      const failedInvoice = event.data.object;
      const failedSubId = failedInvoice.subscription as string;
      if (failedSubId) {
        await supabase
          .from('subscriptions')
          .update({ status: 'past_due' })
          .eq('gateway_subscription_id', failedSubId);
      }
      break;
    }

    case 'customer.subscription.trial_will_end': {
      // Log notification — no action needed for v1
      console.info('Trial will end soon', { subscription_id: event.data.object.id });
      break;
    }
  }

  await supabase
    .from('stripe_events')
    .update({ processed: true })
    .eq('stripe_event_id', event.id);
  } catch (processErr) {
    await markEventFailed(event.id, processErr instanceof Error ? processErr.message : String(processErr));
    throw processErr;
  }

  return new Response(
    JSON.stringify({ received: true }),
    { headers: { ...headers, 'Content-Type': 'application/json' } }
  );
}

if (import.meta.main) {
  serve(async (req) => handleWebhook(req));
}
