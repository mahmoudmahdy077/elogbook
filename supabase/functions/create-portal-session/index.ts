import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { ALLOWED_ORIGINS, requirePrincipal, corsHeaders } from "../_shared/auth.ts";
import {
  assertDatabaseResult,
  resolvePaymentConfig,
  type PaymentConfigClient,
} from "../_shared/payment-config.ts";
import { resolvePortalReturnUrl } from "./return-url.ts";

function configuredAppOrigin(): string {
  const candidates = [
    Deno.env.get("NEXT_PUBLIC_SITE_URL")?.trim(),
    ...ALLOWED_ORIGINS,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username && !url.password
      ) {
        return url.origin;
      }
    } catch {
      continue;
    }
  }
  return "";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export async function handlePortalSession(req: Request): Promise<Response> {
  const origin = req.headers.get("Origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers });

  const authResult = await requirePrincipal(req, {
    roles: ["institution_admin", "admin"],
    aal: "aal2",
  });
  if (authResult instanceof Response) return authResult;
  const { supabase, tenantId } = authResult;

  let body: { return_url?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, headers);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Invalid JSON body" }, 400, headers);
  }

  const appOrigin = configuredAppOrigin();
  const returnUrl = appOrigin
    ? resolvePortalReturnUrl(body.return_url, appOrigin, [appOrigin, ...ALLOWED_ORIGINS])
    : null;
  if (!returnUrl) return jsonResponse({ error: "Invalid billing portal return URL" }, 400, headers);

  // The tenant is the verified principal and the customer is read from that
  // tenant's own verified subscription row. Neither is taken from the request.
  const subscriptionResult = await supabase
    .from("subscriptions")
    .select("gateway_subscription_id, stripe_customer_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();
  assertDatabaseResult(subscriptionResult, "find active subscription");
  const subscription = record(subscriptionResult.data);
  const customerId = typeof subscription.stripe_customer_id === "string"
    ? subscription.stripe_customer_id
    : "";
  // A managed billing portal session is a change to a real provider
  // subscription. Without the gateway subscription binding there is nothing
  // verified to manage.
  const gatewaySubscriptionId = typeof subscription.gateway_subscription_id === "string"
    ? subscription.gateway_subscription_id
    : "";
  if (!customerId || !gatewaySubscriptionId) {
    return jsonResponse({ error: "No verified active subscription found" }, 404, headers);
  }

  const serviceUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceUrl || !serviceKey) return jsonResponse({ error: "Payment service not configured" }, 500, headers);
  const serviceSupabase = createClient(serviceUrl, serviceKey);
  let gwConfig;
  try {
    gwConfig = await resolvePaymentConfig(serviceSupabase as unknown as PaymentConfigClient, tenantId);
  } catch {
    return jsonResponse({ error: "Payment service not configured" }, 500, headers);
  }
  if (!gwConfig) return jsonResponse({ error: "Payment service not configured" }, 500, headers);

  const stripe = new Stripe(gwConfig.secret, {
    apiVersion: "2024-06-20",
    httpClient: Stripe.createFetchHttpClient(),
  });
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return jsonResponse({ url: session.url }, 200, headers);
  } catch {
    return jsonResponse({ error: "Failed to create portal session" }, 500, headers);
  }
}

if (import.meta.main) {
  serve(handlePortalSession);
}
