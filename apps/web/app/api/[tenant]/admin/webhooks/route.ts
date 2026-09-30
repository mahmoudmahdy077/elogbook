import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { isSafeOutboundUrl } from '@elogbook/shared/security/outbound-url';
import { configuredOutboundHosts } from '@/lib/outbound-request';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const ALLOWED_EVENTS = [
  'case.created',
  'case.updated',
  'case.submitted',
  'case.approved',
  'case.rejected',
  'case.deleted',
] as const;

const createWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.enum(ALLOWED_EVENTS)).min(1).max(ALLOWED_EVENTS.length),
  secret: z.string().min(8).max(512),
  description: z.string().max(500).optional(),
  is_active: z.boolean().optional(),
}).strict();

const updateWebhookSchema = z.object({
  id: z.string().min(1).max(128),
  url: z.string().url().max(2048).optional(),
  events: z.array(z.enum(ALLOWED_EVENTS)).min(1).max(ALLOWED_EVENTS.length).optional(),
  secret: z.string().min(8).max(512).optional(),
  description: z.string().max(500).optional(),
  is_active: z.boolean().optional(),
}).strict();

function isApprovedWebhookUrl(url: string): boolean {
  return isSafeOutboundUrl(url, {
    allowedHosts: configuredOutboundHosts(),
    allowHttp: process.env.NODE_ENV !== 'production',
  });
}

// ---------------------------------------------------------------------------
// GET — list webhooks for the tenant
// ---------------------------------------------------------------------------
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug, ['director', 'institution_admin', 'admin']);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const { profile } = _auth;

  // Plan gate: webhooks is Enterprise-only
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('subscription_plans!inner(features)')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .maybeSingle();
  const features = (sub as { subscription_plans?: { features?: Record<string, unknown> } | null })?.subscription_plans?.features ?? null;
  if (!features?.webhooks) {
    return NextResponse.json({ error: 'Not available on your plan' }, { status: 503 });
  }

  const adminClient = createServiceRoleClient();
  const { data: webhooks, error } = await adminClient
    .from('tenant_webhooks')
    .select('id, url, events, is_active, description, created_at, updated_at')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error('Failed to list webhooks', error, { tenantId: profile.tenant_id });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Fetch latest delivery status for each webhook
  const webhookIds = (webhooks ?? []).map((w) => w.id);
  const deliveryMap = new Map<string, { last_sent: string | null; last_status: number | null; last_succeeded: boolean }>();

  if (webhookIds.length > 0) {
    const { data: deliveries } = await adminClient
      .from('tenant_webhook_deliveries') // tenant-scope-exempt: delivery is child of tenant_webhooks filtered by webhook_id tenant_id already — owner=human expiry=2026-12-31
      .select('webhook_id, attempted_at, status_code, succeeded')
      .in('webhook_id', webhookIds)
      .order('attempted_at', { ascending: false })
      .limit(webhookIds.length);

    for (const d of deliveries ?? []) {
      if (!deliveryMap.has(d.webhook_id)) {
        deliveryMap.set(d.webhook_id, {
          last_sent: d.attempted_at,
          last_status: d.status_code,
          last_succeeded: d.succeeded,
        });
      }
    }
  }

  const result = (webhooks ?? []).map((w) => ({
    ...w,
    last_sent: deliveryMap.get(w.id)?.last_sent ?? null,
    last_status: deliveryMap.get(w.id)?.last_status ?? null,
    last_succeeded: deliveryMap.get(w.id)?.last_succeeded ?? null,
  }));

  return NextResponse.json({ webhooks: result });
}

// ---------------------------------------------------------------------------
// POST — create a new webhook
// ---------------------------------------------------------------------------
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const guarded = await guardRequest(request, createWebhookSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 64 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;

  const { allowed, retryAfter } = await checkRateLimit(`webhooks:${tenantSlug}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;
  const user = _auth.user;

  const { url, events, secret, description, is_active } = guarded.data;

  if (!isApprovedWebhookUrl(url)) {
    return NextResponse.json({ error: 'Webhook URL is not approved' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();
  const { count, error: countError } = await adminClient
    .from('tenant_webhooks')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', profile.tenant_id);

  if (countError) {
    logger.error('Failed to count webhooks', countError, { tenantId: profile.tenant_id });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if ((count ?? 0) >= 10) {
    return NextResponse.json({ error: 'Maximum of 10 webhooks per tenant' }, { status: 400 });
  }

  const { data: storedWebhook, error: insertError } = await supabase.rpc('store_tenant_webhook', {
    p_url: url,
    p_events: events,
    p_secret: secret,
    p_description: description ?? null,
    p_is_active: is_active ?? true,
    p_webhook_id: null,
  });

  if (insertError || !storedWebhook?.success) {
    logger.error('Failed to create webhook', insertError, { tenantId: profile.tenant_id, url });
    return NextResponse.json({ error: storedWebhook?.error ?? 'Internal server error' }, { status: insertError ? 500 : 400 });
  }

  await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'webhook_create', resource_type: 'tenant_webhooks', resource_id: storedWebhook.id, changes: {} });

  return NextResponse.json({
    webhook: {
      id: storedWebhook.id,
      url,
      events,
      is_active: is_active ?? true,
      description: description ?? null,
    },
  }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PUT — update an existing webhook
// ---------------------------------------------------------------------------
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const guarded = await guardRequest(request, updateWebhookSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 64 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const profile = _auth.profile;
  const user = _auth.user;

  const { id, url, events, secret, description, is_active } = guarded.data;

  const adminClient = createServiceRoleClient();
  const { data: existing, error: existingError } = await adminClient
    .from('tenant_webhooks')
    .select('id, url, events, description, is_active')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (existingError || !existing) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
  }
  if (url !== undefined && !isApprovedWebhookUrl(url)) {
    return NextResponse.json({ error: 'Webhook URL is not approved' }, { status: 400 });
  }
  if (secret !== undefined && secret.length < 8) {
    return NextResponse.json({ error: 'Secret key must be at least 8 characters' }, { status: 400 });
  }
  if (
    url === undefined
    && events === undefined
    && secret === undefined
    && description === undefined
    && is_active === undefined
  ) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data: storedWebhook, error: updateError } = await supabase.rpc('store_tenant_webhook', {
    p_url: url ?? existing.url,
    p_events: events ?? existing.events,
    p_secret: secret ?? null,
    p_description: description === undefined ? existing.description : description,
    p_is_active: is_active ?? existing.is_active,
    p_webhook_id: id,
  });

  if (updateError || !storedWebhook?.success) {
    logger.error('Failed to update webhook', updateError, { tenantId: profile.tenant_id, webhookId: id });
    return NextResponse.json({ error: storedWebhook?.error ?? 'Internal server error' }, { status: updateError ? 500 : 400 });
  }

  await adminClient.from('audit_logs').insert({ tenant_id: profile.tenant_id, user_id: user.id, action: 'webhook_update', resource_type: 'tenant_webhooks', resource_id: id!, changes: {} });

  return NextResponse.json({ success: true });
}

// ---------------------------------------------------------------------------
// DELETE — delete a webhook
// ---------------------------------------------------------------------------
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const guarded = await guardRequest(request, undefined, {
    trustedOrigins: defaultTrustedOrigins(request),
    requireBody: false,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const _auth = await requireTenantAdmin(supabase, tenantSlug);
  if (!_auth.ok) {
    return NextResponse.json({ error: _auth.error }, { status: _auth.status });
  }
  const { profile } = _auth;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();

  // Verify ownership
  const { data: existing } = await adminClient
    .from('tenant_webhooks')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
  }

  const { error: deleteError } = await adminClient
    .from('tenant_webhooks')
    .delete()
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id);

  if (deleteError) {
    logger.error('Failed to delete webhook', deleteError, { tenantId: profile.tenant_id, webhookId: id });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
