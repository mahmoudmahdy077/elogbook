import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { requirePrincipal, corsHeaders } from '../_shared/auth.ts';
import {
  assertDatabaseResult,
  resolvePaymentConfig,
  type PaymentConfigClient,
} from '../_shared/payment-config.ts';

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

async function handler(req: Request): Promise<Response> {
  const headers = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, headers);

  const authResult = await requirePrincipal(req, {
    roles: ['institution_admin', 'admin'],
    aal: 'aal2',
  });
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId } = authResult;

  const url = new URL(req.url);
  const customerId = url.searchParams.get('customer_id');
  if (!customerId || customerId.length > 256) return jsonResponse({ error: 'customer_id required' }, 400, headers);

  const subscriptionResult = await supabase
    .from('subscriptions')
    .select('gateway_subscription_id, stripe_customer_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .maybeSingle();
  assertDatabaseResult(subscriptionResult, 'find active subscription');
  const subscription = subscriptionResult.data as {
    gateway_subscription_id?: string | null;
    stripe_customer_id?: string | null;
  } | null;
  if (!subscription?.gateway_subscription_id) return jsonResponse({ invoices: [] }, 200, headers);
  if (subscription.stripe_customer_id !== customerId) return jsonResponse({ error: 'Forbidden' }, 403, headers);

  const serviceUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceUrl || !serviceKey) return jsonResponse({ error: 'Billing is not configured for this deployment' }, 503, headers);
  const serviceSupabase = createClient(serviceUrl, serviceKey);
  let gwConfig;
  try {
    gwConfig = await resolvePaymentConfig(serviceSupabase as unknown as PaymentConfigClient, tenantId);
  } catch {
    return jsonResponse({ error: 'Billing is not configured for this deployment' }, 503, headers);
  }
  if (!gwConfig) return jsonResponse({ error: 'Billing is not configured for this deployment' }, 503, headers);

  const stripe = new Stripe(gwConfig.secret, { apiVersion: '2024-06-20' });
  try {
    const invoices = await stripe.invoices.list({ customer: customerId, limit: 20 });
    return jsonResponse({ invoices: invoices.data }, 200, headers);
  } catch {
    return jsonResponse({ error: 'Unable to load invoices' }, 500, headers);
  }
}

serve(handler);
