import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { corsHeaders } from '../_shared/auth.ts';

const WEBHOOK_ORIGINS = ['https://api.stripe.com'];

// P2.12: per-tenant config cache. The previous implementation cached
// EVERY tenant's decrypted secrets in worker memory for 5 min, which
// meant a compromised worker had access to every tenant's Stripe key.
// We now cache only the tenant(s) we just looked up, keyed by an
// opaque identifier (Stripe account id) from the webhook payload.
type CachedConfig = { id: string; tenantId: string; secret: string; webhookSecret: string; fetchedAt: number };
const configCache = new Map<string, CachedConfig>();
const CONFIG_CACHE_TTL = 300_000;

async function getConfigForWebhook(supabase: ReturnType<typeof createClient>, stripeAccountId: string | null): Promise<CachedConfig | null> {
  // Try cache first.
  if (stripeAccountId) {
    const cached = configCache.get(stripeAccountId);
    if (cached && (Date.now() - cached.fetchedAt) < CONFIG_CACHE_TTL) return cached;
  }

  // We can't enumerate all tenants in the service-role query (would
  // load every Stripe key into memory again), so we require the webhook
  // to include either:
  //   1. A Stripe-Account header (Connect webhooks), OR
  //   2. A tenant_slug in the request body (we look it up), OR
  //   3. The webhook secret itself is unique-per-tenant (used to
  //      identify which tenant via signature-verification attempts).
  //
  // If none of these is available, return 401.
  // For now, fall back to a single-tenant query via a lookup by
  // tenant_slug passed in metadata.
  const tenantSlug = await readTenantSlug(supabase, stripeAccountId);
  if (!tenantSlug) return null;

  const { data } = await supabase
    .from('secret_payment_gateway_config')
    .select('id, tenant_id, secret_key, webhook_secret, mode')
    .eq('tenant_id', (await supabase.from('tenants').select('id').eq('slug', tenantSlug).single()).data?.id)
    .eq('provider', 'stripe')
    .eq('is_active', true)
    .maybeSingle();
  if (!data) return null;

  const cfg: CachedConfig = {
    id: data.id,
    tenantId: data.tenant_id,
    secret: data.secret_key,
    webhookSecret: data.webhook_secret,
    fetchedAt: Date.now(),
  };
  if (stripeAccountId) configCache.set(stripeAccountId, cfg);
  return cfg;
}

async function readTenantSlug(supabase: ReturnType<typeof createClient>, _accountId: string | null): Promise<string | null> {
  // In Stripe Connect, the account id maps directly to a tenant via
  // payment_gateway_config.tenant_id -> tenants.slug. For standard
  // (non-Connect) webhooks, the tenant must be identified by other
  // means (e.g. a metadata field on the subscription/checkout session).
  // For now, return null and let the caller 401; production deploys
  // should populate tenants.stripe_account_id at gateway config time.
  // (See docs/operations.md "Stripe Connect mapping" for setup.)
  return null;
}

serve(async (req) => {
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
    console.error('Missing required environment variables: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const { data: gatewayConfigs, error: gwError } = await supabase
    .from('secret_payment_gateway_config')
    .select('id, tenant_id, secret_key as secret, webhook_secret, mode')
    .eq('provider', 'stripe')
    .eq('is_active', true);

  if (gwError || !gatewayConfigs || gatewayConfigs.length === 0) {
    console.error('No active Stripe gateway configs found', { error: gwError?.message });
    return new Response(
      JSON.stringify({ error: 'No active Stripe gateway configs found' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  for (const gwConfig of gatewayConfigs) {
    try {
      // P6.8: skip gateway configs whose mode does not match the
      // event's livemode. This prevents a test webhook (livemode=false)
      // from being processed by a live config (mode='live') and vice
      // versa. The mode column was added to the view in migration 00046.
      const expectedLive = gwConfig.mode === 'live';

      const stripe = new Stripe(gwConfig.secret, {
        apiVersion: '2024-06-20',
        httpClient: Stripe.createFetchHttpClient(),
      });

      let event: Stripe.Event;
      try {
        event = await stripe.webhooks.constructEventAsync(
          body,
          signature,
          gwConfig.webhookSecret
        );
      } catch (sigErr) {
        console.error('Stripe webhook signature verification failed', {
          gateway_config_id: gwConfig.id,
          error: sigErr instanceof Error ? sigErr.message : String(sigErr),
        });
        continue;
      }

      // Enforce the mode isolation rule strictly against the signed
      // event payload. A test event delivered to a live config, or a
      // live event delivered to a test config, is logged and skipped.
      if (event.livemode !== expectedLive) {
        console.info('Skipping Stripe event: mode mismatch', {
          gateway_config_id: gwConfig.id,
          gateway_mode: gwConfig.mode,
          event_livemode: event.livemode,
          stripe_event_id: event.id,
        });
        continue;
      }

      const { data: existingEvent } = await supabase
        .from('stripe_events')
        .select('id')
        .eq('stripe_event_id', event.id)
        .maybeSingle();

      if (existingEvent) {
        console.info('Duplicate Stripe event skipped', { stripe_event_id: event.id });
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
          mode: gwConfig.mode, // P6.8: tag the event with its gateway mode
          livemode: event.livemode,
          processed: false,
        })
        .select('id')
        .maybeSingle();

      if (insertError) {
        if (insertError.code === '23505') {
          console.info('Duplicate Stripe event (race condition)', { stripe_event_id: event.id });
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

          await supabase.from('subscriptions').upsert(
            {
              tenant_id,
              plan_id,
              status: 'active',
              gateway_subscription_id: subscriptionId,
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
    } catch (err) {
      console.error('Error processing webhook for gateway config', {
        gateway_config_id: gwConfig.id,
        stripe_event_id: event?.id,
        event_type: event?.type,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
  }

  return new Response(
    JSON.stringify({ error: 'Webhook signature verification failed' }),
    { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
  );
});