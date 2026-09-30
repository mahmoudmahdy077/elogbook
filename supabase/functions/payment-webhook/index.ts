import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { corsHeaders } from '../_shared/auth.ts';
import { logError } from '../_shared/logging.ts';
import {
  assertDatabaseResult,
  clearPaymentConfigCache,
  PLATFORM_TENANT_ID,
  resolvePaymentConfig,
  type BillingConfig,
  type PaymentConfigClient,
} from '../_shared/payment-config.ts';
import {
  processClaimedStripeEvent,
  providerOrder,
  type StripeEventLike,
} from './event-processing.ts';
import {
  SupabaseStripeEventLifecycle,
  SupabaseStripeEventStore,
  type SupabaseClient,
} from './supabase-store.ts';

const WEBHOOK_ORIGINS = ['https://api.stripe.com'];
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

/**
 * Event types that can move a subscription INTO an access-granting state.
 *
 * `customer.subscription.deleted`, `invoice.payment_failed` and
 * `customer.subscription.trial_will_end` are deliberately absent: they only ever
 * reduce access. Gating those on platform authority would leave a tenant unable
 * to cancel or be dunned, which is a denial of service in the other direction.
 */
export const ENTITLEMENT_GRANTING_EVENT_TYPES: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'invoice.paid',
]);

type GatewayAuthority = { platformManaged: boolean };

export function entitlementGrantingEvent(event: { type: string }): boolean {
  return ENTITLEMENT_GRANTING_EVENT_TYPES.has(event.type);
}

/**
 * A tenant provisions its own Stripe account and therefore its own webhook
 * signing secret. A signature verified against that secret proves the event
 * came from the tenant's own Stripe account -- not that the platform was paid.
 * So entitlement-granting events on a tenant-managed gateway are refused rather
 * than reconciled. Cancellation and dunning on the same gateway still process.
 */
export function grantRequiresPlatformGateway(
  event: { type: string },
  gateway: GatewayAuthority,
): boolean {
  return entitlementGrantingEvent(event) && !gateway.platformManaged;
}

type CachedConfig = BillingConfig;
type DatabaseError = { message?: string; code?: string } | null;
type DatabaseResult = { data?: unknown; error?: DatabaseError };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<DatabaseResult> };

export function clearPaymentWebhookConfigCache(): void {
  clearPaymentConfigCache();
}

export function assertDbResult(result: unknown, operation: string): void {
  assertDatabaseResult(result, operation);
}

export async function readBoundedBody(
  request: Request,
  maxBytes = MAX_WEBHOOK_BODY_BYTES,
): Promise<{ ok: true; body: string } | { ok: false; status: 413 }> {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) return { ok: false, status: 413 };
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) return { ok: false, status: 413 };
  }
  if (!request.body) return { ok: true, body: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      return { ok: false, status: 413 };
    }
    return { ok: false, status: 413 };
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body: new TextDecoder().decode(merged) };
}

/**
 * Read `metadata.tenant_id` from a request body that has NOT been verified.
 *
 * This value is attacker-controlled: it is read before signature verification
 * exists, purely to decide which signing secret to try. It selects a config
 * lookup and nothing else. It is constrained to a bare UUID so it cannot be an
 * injection payload against the config resolver, and callers must not use it
 * for an entitlement decision -- see `verifiedTenantRouting`.
 */
export function readTenantIdFromEvent(body: string): string | null {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  try {
    const parsed = JSON.parse(body) as { data?: { object?: { metadata?: { tenant_id?: unknown } } } };
    const tenantId = parsed.data?.object?.metadata?.tenant_id;
    return typeof tenantId === 'string' && UUID_PATTERN.test(tenantId) ? tenantId : null;
  } catch {
    return null;
  }
}

export type VerifiedTenantRouting =
  | { ok: true; tenantId: string }
  | { ok: false; reason: 'tenant_mismatch' };

/**
 * Decide which tenant a VERIFIED event belongs to.
 *
 * Signature verification proves the payload was signed by the account whose
 * secret matched. It does not make the payload's metadata trustworthy: whoever
 * controls the Stripe account chose those metadata values, so a tenant
 * provisioning its own gateway can sign a payload naming a different tenant.
 *
 * So the tenant that an entitlement write uses must satisfy both: it is the
 * tenant whose secret verified the signature, AND if the event itself names a
 * tenant, that name is the same one. Anything else is refused. Where the event
 * carries no tenant metadata (the subscription lifecycle types), the signing
 * secret is the only authority there is, and that is the tenant used.
 */
export function verifiedTenantRouting(args: {
  verifiedEventTenantId: string | null;
  signatureConfigTenantId: string;
}): VerifiedTenantRouting {
  if (args.verifiedEventTenantId === null) {
    return { ok: true, tenantId: args.signatureConfigTenantId };
  }
  if (args.verifiedEventTenantId !== args.signatureConfigTenantId) {
    return { ok: false, reason: 'tenant_mismatch' };
  }
  return { ok: true, tenantId: args.signatureConfigTenantId };
}

export interface StripeEventClaimInput {
  eventId: string;
  eventType: string;
  mode: string;
  livemode: boolean;
  tenantId: string;
  eventCreated?: number;
  objectVersion?: number;
}

export interface StripeEventClaim {
  claimed: boolean;
  status: string;
  claimToken: string | null;
  duplicate: boolean;
}

function rpcSucceeded(data: unknown): boolean {
  if (data === true) return true;
  return typeof data === 'object' && data !== null && (data as { success?: unknown }).success === true;
}

export async function claimStripeEvent(
  client: RpcClient,
  input: StripeEventClaimInput,
): Promise<StripeEventClaim> {
  const result = await client.rpc('claim_stripe_event', {
    p_event_id: input.eventId,
    p_event_type: input.eventType,
    p_mode: input.mode,
    p_livemode: input.livemode,
    p_tenant_id: input.tenantId,
    p_payload: {
      event_created: input.eventCreated ?? 0,
      object_version: input.objectVersion ?? 0,
    },
  });
  assertDbResult(result, 'claim stripe event');
  const data = result.data as { claimed?: unknown; status?: unknown; claim_token?: unknown } | null;
  const status = typeof data?.status === 'string' ? data.status : 'unknown';
  const claimToken = typeof data?.claim_token === 'string' ? data.claim_token : null;
  return {
    claimed: data?.claimed === true && claimToken !== null,
    status,
    claimToken,
    duplicate: status === 'processed',
  };
}

export async function markStripeEventProcessed(
  client: RpcClient,
  eventId: string,
  claimToken: string,
): Promise<void> {
  const result = await client.rpc('mark_stripe_event_processed', {
    p_event_id: eventId,
    p_claim_token: claimToken,
  });
  assertDbResult(result, 'mark stripe event processed');
  if (!rpcSucceeded(result.data)) throw new Error('mark stripe event processed: claim was not completed');
}

export async function markStripeEventFailed(
  client: RpcClient,
  eventId: string,
  claimToken: string,
  reason: string,
): Promise<void> {
  const result = await client.rpc('mark_stripe_event_failed', {
    p_event_id: eventId,
    p_claim_token: claimToken,
    p_reason: reason.slice(0, 1_000),
  });
  assertDbResult(result, 'mark stripe event failed');
  if (!rpcSucceeded(result.data)) throw new Error('mark stripe event failed: claim was not released');
}

export async function resolveTenantConfig(
  supabase: PaymentConfigClient,
  tenantId: string,
  options: { failOnError?: boolean } = {},
): Promise<CachedConfig | null> {
  try {
    return await resolvePaymentConfig(supabase as unknown as PaymentConfigClient, tenantId, {
      allowEnvironmentFallback: tenantId === PLATFORM_TENANT_ID,
    });
  } catch (error) {
    if (options.failOnError) throw error;
    return null;
  }
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export async function handleWebhook(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin');
  const headers = corsHeaders(origin && WEBHOOK_ORIGINS.includes(origin) ? origin : null);

  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return jsonResponse({ error: 'Missing stripe-signature header' }, 400, headers);

  const bodyResult = await readBoundedBody(req);
  if (!bodyResult.ok) return jsonResponse({ error: 'Webhook body is too large' }, 413, headers);
  const body = bodyResult.body;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500, headers);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  const tenantIdFromEvent = readTenantIdFromEvent(body);
  const configTenantId = tenantIdFromEvent ?? PLATFORM_TENANT_ID;
  let gwConfig: CachedConfig | null;
  try {
    gwConfig = await resolveTenantConfig(supabase as unknown as PaymentConfigClient, configTenantId, { failOnError: true });
  } catch {
    return jsonResponse({ error: 'Could not identify tenant from webhook' }, 401, headers);
  }
  if (!gwConfig) return jsonResponse({ error: 'Could not identify tenant from webhook' }, 401, headers);
  if (!gwConfig.webhookSecret) return jsonResponse({ error: 'Webhook is not configured' }, 401, headers);

  const stripe = new Stripe(gwConfig.secret, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, gwConfig.webhookSecret);
  } catch (signatureError) {
    logError('payment.signature_verification_failed', signatureError, { operation: 'signature_verification' });
    return jsonResponse({ error: 'Signature verification failed' }, 400, headers);
  }

  const expectedLive = gwConfig.mode === 'live';
  if (event.livemode !== expectedLive) return jsonResponse({ error: 'Mode mismatch' }, 400, headers);
  if (!event.id || !event.type || !Number.isInteger(event.created) || event.created < 0) {
    return jsonResponse({ error: 'Invalid Stripe event' }, 400, headers);
  }

  // From here on the event is authenticated: the signature matched
  // gwConfig.webhookSecret. The tenant used for the claim and the entitlement
  // write is re-derived from the VERIFIED payload and must agree with the config
  // that verified it. The pre-verification read above chose a secret to try; it
  // is not authority.
  const routing = verifiedTenantRouting({
    verifiedEventTenantId: readTenantIdFromEvent(body),
    signatureConfigTenantId: gwConfig.tenantId,
  });
  if (!routing.ok) {
    logError('payment.tenant_routing_mismatch', new Error('verified event tenant does not match its signing config'), {
      operation: 'tenant_routing',
      eventId: event.id,
      eventType: event.type,
    });
    return jsonResponse({ error: 'Webhook event does not belong to this account' }, 403, headers);
  }
  const tenantId = routing.tenantId;

  if (grantRequiresPlatformGateway(event as unknown as { type: string }, gwConfig)) {
    // Signature verification already passed, so this is a well-formed event on
    // the tenant's own account -- it just is not evidence of platform payment.
    logError('payment.entitlement_grant_refused', new Error('tenant-managed gateway cannot grant entitlement'), {
      operation: 'entitlement_authority',
      eventId: event.id,
      eventType: event.type,
    });
    return jsonResponse({ error: 'Event is not entitled to grant access on this gateway' }, 403, headers);
  }

  const ordering = providerOrder(event as unknown as StripeEventLike);
  let claim: StripeEventClaim;
  try {
    claim = await claimStripeEvent(supabase as unknown as RpcClient, {
      eventId: event.id,
      eventType: event.type,
      mode: gwConfig.mode,
      livemode: event.livemode,
      tenantId,
      eventCreated: ordering.created,
      objectVersion: ordering.objectVersion,
    });
  } catch (error) {
    logError('payment.webhook_claim_failed', error, { operation: 'claim_event', eventId: event.id });
    return jsonResponse({ error: 'Webhook event could not be claimed' }, 500, headers);
  }

  if (!claim.claimed) {
    if (claim.duplicate) return jsonResponse({ received: true, duplicate: true }, 200, headers);
    if (claim.status === 'processing') return jsonResponse({ received: true, in_progress: true }, 202, headers);
    return jsonResponse({ error: 'Webhook event is waiting for retry' }, 503, headers);
  }
  const claimToken = claim.claimToken;
  if (!claimToken) return jsonResponse({ error: 'Webhook claim token missing' }, 500, headers);

  const store = new SupabaseStripeEventStore(supabase as unknown as SupabaseClient);
  const lifecycle = new SupabaseStripeEventLifecycle(supabase as unknown as SupabaseClient, claimToken);
  try {
    await processClaimedStripeEvent(
      store,
      lifecycle,
      event as unknown as StripeEventLike,
      tenantId,
      claimToken,
    );
  } catch (error) {
    logError('payment.webhook_processing_failed', error, { operation: 'process_event', eventId: event.id });
    return jsonResponse({ error: 'Webhook processing failed' }, 500, headers);
  }

  return jsonResponse({ received: true }, 200, headers);
}

if (import.meta.main) {
  serve(handleWebhook);
}
