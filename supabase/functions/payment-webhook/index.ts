import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.text();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: gatewayConfigs } = await supabase
    .from('payment_gateway_config')
    .select('*')
    .eq('provider', 'stripe')
    .eq('is_active', true);

  if (!gatewayConfigs || gatewayConfigs.length === 0) {
    return new Response(JSON.stringify({ error: 'No active Stripe gateway configs found' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  for (const gwConfig of gatewayConfigs) {
    try {
      const stripe = new Stripe(gwConfig.encrypted_secret_key, {
        apiVersion: '2024-06-20',
        httpClient: Stripe.createFetchHttpClient(),
      });

      const event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        gwConfig.encrypted_webhook_secret
      );

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const { tenant_id, plan_id } = session.metadata ?? {};

          if (!tenant_id || !plan_id) break;

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

      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch {
      continue;
    }
  }

  return new Response(JSON.stringify({ error: 'Webhook signature verification failed' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
