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

  const serviceSupabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  async function readGatewayConfig(targetTenantId: string) {
    const { data: cfg, error } = await serviceSupabase
      .from('payment_gateway_config')
      .select('id, tenant_id, secret_key_enc, publishable_key, mode, webhook_secret_enc, key_version')
      .eq('tenant_id', targetTenantId)
      .eq('provider', 'stripe')
      .eq('is_active', true)
      .maybeSingle();
    if (error || !cfg) return null;
    const { data: secretKey, error: decError } = await serviceSupabase.rpc('decrypt_with_version', {
      p_encrypted: cfg.secret_key_enc,
      p_version: cfg.key_version,
    });
    if (decError || !secretKey) return null;
    return {
      id: cfg.id,
      tenant_id: cfg.tenant_id,
      secret_key: secretKey as string,
      publishable_key: cfg.publishable_key,
      mode: cfg.mode,
      webhook_secret: '',
    };
  }

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
    if (!body || typeof body !== 'object') {
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

  // Config reads use the service client: the secret views are role-gated to
  // tenant admins (Task 1.1) and the global tenant's platform-default config
  // must remain readable for director+ callers.
  let gwConfig = await readGatewayConfig(tenantId);

  // Fallback to platform-default gateway
  if (!gwConfig) {
    gwConfig = await readGatewayConfig('00000000-0000-0000-0000-000000000000');
  }

  // Final fallback: STRIPE_SECRET_KEY from env (for platform-level billing)
  if (!gwConfig) {
    const envKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (envKey) {
      gwConfig = { id: 'env', tenant_id: '00000000-0000-0000-0000-000000000000', secret_key: envKey, publishable_key: '', mode: 'live', webhook_secret: '' };
    }
  }

  if (!gwConfig) {
    console.error('Gateway config lookup failed', { tenant_id: tenantId });
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