import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { corsHeaders } from '../_shared/auth.ts';

const WEBHOOK_ORIGINS = ['https://api.stripe.com'];

type CachedConfig = { id: string; tenantId: string; secret: string; webhookSecret: string; mode: string; fetchedAt: number };
const configCache = new Map<string, CachedConfig>();
const CONFIG_CACHE_TTL = 300_000;

async function getConfigForWebhook(supabase: ReturnType<typeof createClient>, stripeAccountId: string | null): Promise<CachedConfig | null> {
  if (stripeAccountId) {
    const cached = configCache.get(stripeAccountId);
    if (cached && (Date.now() - cached.fetchedAt) < CONFIG_CACHE_TTL) return cached;
  }

  const tenantSlug = await readTenantSlug(supabase, stripeAccountId);
  if (!tenantSlug) return null;

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .maybeSingle();
  if (!tenant) return null;

  const { data } = await supabase
    .from('secret_payment_gateway_config')
    .select('id, tenant_id, secret_key, webhook_secret, mode')
    .eq('tenant_id', tenant.id)
    .eq('provider', 'stripe')
    .eq('is_active', true)
    .maybeSingle();
  if (!data) return null;

  const cfg: CachedConfig = {
    id: data.id,
    tenantId: data.tenant_id,
    secret: data.secret_key,
    webhookSecret: data.webhook_secret,
    mode: data.mode,
    fetchedAt: Date.now(),
  };
  if (stripeAccountId) configCache.set(stripeAccountId, cfg);
  return cfg;
}

async function readTenantSlug(supabase: ReturnType<typeof createClient>, stripeAccountId: string | null): Promise<string | null> {
  if (!stripeAccountId) return null;
  const { data } = await supabase
    .from('tenants')
    .select('slug')
    .eq('stripe_account_id', stripeAccountId)
    .maybeSingle();
  return data?.slug ?? null;
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

  const stripeAccountId = req.headers.get('Stripe-Account');
  let gwConfig: CachedConfig | null = await getConfigForWebhook(supabase, stripeAccountId);

  if (!gwConfig && !stripeAccountId) {
    try {
      const parsed = JSON.parse(body);
      const slug = parsed?.data?.object?.metadata?.tenant_slug;
      if (slug) {
        const { data: tenant } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle();
        if (tenant) {
          const { data: config } = await supabase
            .from('secret_payment_gateway_config')
            .select('id, tenant_id, secret_key as secret, webhook_secret, mode')
            .eq('tenant_id', tenant.id)
            .eq('provider', 'stripe')
            .eq('is_active', true)
            .maybeSingle();
          if (config) {
            gwConfig = {
              id: config.id,
              tenantId: config.tenant_id,
              secret: config.secret,
              webhookSecret: config.webhook_secret,
              mode: config.mode,
              fetchedAt: Date.now(),
            };
          }
        }
      }
    } catch {
      // not JSON, ignore
    }
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

      await supabase.from('subscriptions').upsert(
        {
          tenant_id,
          plan_id,
          status: 'active',
          gateway_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
        },
        { onConflict: 'tenant_id' }
      );

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
          status: 'succeeded',
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

  return new Response(
    JSON.stringify({ received: true }),
    { headers: { ...headers, 'Content-Type': 'application/json' } }
  );
}

if (import.meta.main) {
  serve(async (req) => handleWebhook(req));
}
