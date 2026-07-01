import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { authenticate, corsHeaders, escapeHtml, ALLOWED_ORIGINS } from '../_shared/auth.ts';

const AUTHORIZED_ROLES = ['director', 'institution_admin', 'admin'];

const checkoutRateLimit = new Map<string, { count: number; windowStart: number }>();
const CHECKOUT_RATE_LIMIT_MAX = 5;
const CHECKOUT_RATE_LIMIT_WINDOW = 60_000;

function checkCheckoutRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = checkoutRateLimit.get(userId);
  if (!entry || now - entry.windowStart > CHECKOUT_RATE_LIMIT_WINDOW) {
    checkoutRateLimit.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= CHECKOUT_RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

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
      JSON.stringify({ error: 'Insufficient permissions: requires director, institution_admin, or admin role' }),
      { status: 403, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (!checkCheckoutRateLimit(tenantId)) {
    return new Response(
      JSON.stringify({ error: 'Too many checkout requests. Please wait before trying again.' }),
      { status: 429, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  let body: { plan_id?: string; gateway?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { plan_id, gateway = 'stripe' } = body;
  if (!plan_id) {
    return new Response(
      JSON.stringify({ error: 'plan_id is required' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { data: plan, error: planError } = await supabase
    .from('subscription_plans')
    .select('id, name, stripe_price_id')
    .eq('id', plan_id)
    .single();

  if (planError || !plan) {
    console.error('Plan lookup failed', { plan_id, error: planError?.message });
    return new Response(
      JSON.stringify({ error: 'Plan not found' }),
      { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  const { data: gwConfig, error: gwError } = await supabase
    .from('secret_payment_gateway_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .single();

  if (gwError || !gwConfig) {
    console.error('Gateway config lookup failed', { tenant_id: tenantId, error: gwError?.message });
    return new Response(
      JSON.stringify({ error: 'Gateway not configured' }),
      { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  if (gateway === 'stripe') {
    const priceId = (plan as any).stripe_price_id;
    if (!priceId) {
      console.error('Plan missing stripe_price_id', { plan_id });
      return new Response(
        JSON.stringify({ error: 'Plan has no Stripe price ID configured' }),
        { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }

    const stripe = new Stripe(gwConfig.secret_key, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin)
      ? origin
      : 'https://app.elogbook.dev';

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${allowedOrigin}/billing?success=true`,
        cancel_url: `${allowedOrigin}/billing?canceled=true`,
        metadata: { tenant_id: tenantId, plan_id },
      });

      return new Response(
        JSON.stringify({ sessionId: session.id }),
        { headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      console.error('Stripe checkout session creation failed', { error: err instanceof Error ? err.message : String(err) });
      return new Response(
        JSON.stringify({ error: 'Failed to create checkout session' }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: `Gateway ${escapeHtml(gateway)} not yet implemented` }),
    { status: 501, headers: { ...headers, 'Content-Type': 'application/json' } }
  );
});