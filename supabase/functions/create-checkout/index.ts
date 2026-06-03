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

  const { tenant_id, plan_id, gateway } = await req.json();

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: plan, error: planError } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('id', plan_id)
    .single();

  if (planError || !plan) {
    return new Response(JSON.stringify({ error: 'Plan not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: gwConfig, error: gwError } = await supabase
    .from('payment_gateway_config')
    .select('*')
    .eq('tenant_id', tenant_id)
    .single();

  if (gwError || !gwConfig) {
    return new Response(JSON.stringify({ error: 'Gateway not configured' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (gateway === 'stripe') {
    const stripe = new Stripe(gwConfig.encrypted_secret_key, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const priceId = (plan as any).stripe_price_id;
    if (!priceId) {
      return new Response(JSON.stringify({ error: 'Plan has no Stripe price ID configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${req.headers.get('origin')}/billing?success=true`,
      cancel_url: `${req.headers.get('origin')}/billing?canceled=true`,
      metadata: { tenant_id, plan_id },
    });

    return new Response(JSON.stringify({ sessionId: session.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: `Gateway ${gateway} not yet implemented` }), {
    status: 501,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
