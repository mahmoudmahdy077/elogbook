import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { requirePrincipal, corsHeaders, ALLOWED_ORIGINS } from '../_shared/auth.ts';
import {
  assertDatabaseResult,
  resolvePaymentConfig,
  type PaymentConfigClient,
} from '../_shared/payment-config.ts';

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

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export async function handleCheckout(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  const authResult = await requirePrincipal(req, {
    roles: ['director', 'institution_admin', 'admin'],
    aal: 'aal2',
  });
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId } = authResult;

  if (!checkCheckoutRateLimit(tenantId)) {
    return jsonResponse({ error: 'Too many checkout requests. Please wait before trying again.' }, 429, headers);
  }

  let body: { plan_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, headers);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, headers);
  }

  // The body may name a plan. It may not name the tenant, the mode, the price or
  // any feature flag: the tenant is the verified principal, and the price is the
  // server catalog's. Accepting a client tenant here would let a caller buy a
  // plan for someone else's tenant.
  const planId = typeof body.plan_id === 'string' ? body.plan_id : '';
  if (!planId || planId.length > 128) return jsonResponse({ error: 'plan_id is required' }, 400, headers);

  const planResult = await supabase
    .from('subscription_plans')
    .select('id, stripe_price_id, tenant_type')
    .eq('id', planId)
    .maybeSingle();
  assertDatabaseResult(planResult, 'find subscription plan');
  const plan = record(planResult.data);
  if (!plan.id) return jsonResponse({ error: 'Plan not found' }, 404, headers);

  // The plan must be sellable to this tenant's own type. Resolved server-side
  // from the tenant row, not from anything the caller sent.
  const tenantResult = await supabase
    .from('tenants')
    .select('id, tenant_type')
    .eq('id', tenantId)
    .maybeSingle();
  assertDatabaseResult(tenantResult, 'resolve tenant');
  const tenant = record(tenantResult.data);
  if (!tenant.id) return jsonResponse({ error: 'Tenant not found' }, 404, headers);
  if (plan.tenant_type !== tenant.tenant_type) {
    return jsonResponse({ error: 'Plan is not available for this tenant type' }, 400, headers);
  }

  const serviceUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceUrl || !serviceKey) return jsonResponse({ error: 'Payment service not configured' }, 500, headers);
  const serviceSupabase = createClient(serviceUrl, serviceKey);
  let gwConfig;
  try {
    gwConfig = await resolvePaymentConfig(serviceSupabase as unknown as PaymentConfigClient, tenantId);
  } catch {
    return jsonResponse({ error: 'Payment service not configured' }, 500, headers);
  }
  if (!gwConfig) return jsonResponse({ error: 'Gateway not configured' }, 400, headers);

  const priceId = typeof plan.stripe_price_id === 'string' ? plan.stripe_price_id : '';
  if (!priceId) return jsonResponse({ error: 'Plan has no Stripe price ID configured' }, 400, headers);

  const stripe = new Stripe(gwConfig.secret, {
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
      client_reference_id: tenantId,
      metadata: { tenant_id: tenantId, plan_id: planId, mode: gwConfig.mode },
      subscription_data: { metadata: { tenant_id: tenantId, plan_id: planId, mode: gwConfig.mode } },
    });
    return jsonResponse({ sessionId: session.id }, 200, headers);
  } catch {
    return jsonResponse({ error: 'Failed to create checkout session' }, 500, headers);
  }
}

if (import.meta.main) {
  serve(handleCheckout);
}
