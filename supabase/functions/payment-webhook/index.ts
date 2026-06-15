import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { corsHeaders } from '../_shared/auth.ts';

const WEBHOOK_ORIGINS = ['https://api.stripe.com'];

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

  const { data: gatewayConfigs } = await supabase
    .from('payment_gateway_config')
    .select('*')
    .eq('provider', 'stripe')
    .eq('is_active', true);

  if (!gatewayConfigs || gatewayConfigs.length === 0) {
    console.error('No active Stripe gateway configs found');
    return new Response(
      JSON.stringify({ error: 'No active Stripe gateway configs found' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  for (const gwConfig of gatewayConfigs) {
    try {
      const stripe = new Stripe(gwConfig.encrypted_secret_key, {
        apiVersion: '2024-06-20',
        httpClient: Stripe.createFetchHttpClient(),
      });

      let event: Stripe.Event;
      try {
        event = await stripe.webhooks.constructEventAsync(
          body,
          signature,
          gwConfig.encrypted_webhook_secret
        );
      } catch (sigErr) {
        console.error('Stripe webhook signature verification failed', {
          gateway_config_id: gwConfig.id,
          error: sigErr instanceof Error ? sigErr.message : String(sigErr),
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

      await supabase.from('stripe_events').insert({
        stripe_event_id: event.id,
        event_type: event.type,
        processed: false,
      });

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const { tenant_id, plan_id } = session.metadata ?? {};

          if (!tenant_id || !plan_id) {
            console.error('Checkout session missing metadata', { event_id: event.id, session_id: session.id });
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