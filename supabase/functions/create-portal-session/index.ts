import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { authenticate, corsHeaders, ALLOWED_ORIGINS } from '../_shared/auth.ts';

const AUTHORIZED_ROLES = ['director', 'institution_admin', 'admin'];

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId, role } = authResult;

  if (!AUTHORIZED_ROLES.includes(role)) {
    return new Response(
      JSON.stringify({ error: 'Insufficient permissions' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  let body: { return_url?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const returnUrl = body.return_url || (origin && ALLOWED_ORIGINS.includes(origin) ? origin : 'https://app.elogbook.dev');

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle();

  if (!subscription?.stripe_customer_id) {
    return new Response(
      JSON.stringify({ error: 'No active subscription found' }),
      { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    return new Response(
      JSON.stringify({ error: 'Payment service not configured' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: returnUrl,
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Portal session creation failed', { error: err instanceof Error ? err.message : String(err) });
    return new Response(
      JSON.stringify({ error: 'Failed to create portal session' }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }
});
