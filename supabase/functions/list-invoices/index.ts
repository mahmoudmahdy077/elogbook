import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno';

// Stripe client is created lazily inside the handler: constructing it at module
// top level with an empty key hung the isolate on cold start (the function
// timed out even for requests that should fail validation before any Stripe
// call). A missing key now fails fast with 503 instead.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

async function handler(req: Request) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    return new Response(
      JSON.stringify({ error: 'Billing is not configured for this deployment' }),
      { status: 503 },
    );
  }
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
  });

  const url = new URL(req.url);
  const customerId = url.searchParams.get('customer_id');
  if (!customerId) {
    return new Response(JSON.stringify({ error: 'customer_id required' }), { status: 400 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('gateway_subscription_id, stripe_customer_id')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .single();

  if (!subscription?.gateway_subscription_id) {
    return new Response(JSON.stringify({ invoices: [] }), { status: 200 });
  }

  // Ownership: the requested customer must be the caller's own Stripe customer.
  if (subscription.stripe_customer_id !== customerId) {
    return new Response(
      JSON.stringify({ error: 'customer_id does not belong to your subscription' }),
      { status: 403 },
    );
  }

  try {
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 20,
    });

    return new Response(JSON.stringify({ invoices: invoices.data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}
serve(handler);
