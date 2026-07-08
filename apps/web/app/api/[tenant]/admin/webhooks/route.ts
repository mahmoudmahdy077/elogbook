import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';

const ALLOWED_EVENTS = [
  'case.created',
  'case.updated',
  'case.submitted',
  'case.approved',
  'case.rejected',
  'case.deleted',
] as const;

// ---------------------------------------------------------------------------
// GET — list webhooks for the tenant
// ---------------------------------------------------------------------------
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as { slug: string };
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!['director', 'institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const adminClient = createServiceRoleClient();
  const { data: webhooks, error } = await adminClient
    .from('tenant_webhooks')
    .select('id, url, events, is_active, description, created_at, updated_at')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('webhooks list error:', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Fetch latest delivery status for each webhook
  const webhookIds = (webhooks ?? []).map((w) => w.id);
  const deliveryMap = new Map<string, { last_sent: string | null; last_status: number | null; last_succeeded: boolean }>();

  if (webhookIds.length > 0) {
    const { data: deliveries } = await adminClient
      .from('tenant_webhook_deliveries')
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
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;

  const { allowed, retryAfter } = await checkRateLimit(`webhooks:${tenantSlug}`);
  if (!allowed) return rateLimitResponse(retryAfter);

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as { slug: string };
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!['institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: { url?: string; events?: string[]; secret?: string; description?: string; is_active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // --- Validation ---
  const { url, events, secret, description, is_active } = body;

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 });
  }

  // Validate URL format
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'URL must use http or https protocol' }, { status: 400 });
    }
    // In production, only HTTPS allowed
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'HTTPS is required in production' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
  }

  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ error: 'At least one event type is required' }, { status: 400 });
  }

  const invalidEvents = events.filter((e) => !ALLOWED_EVENTS.includes(e as typeof ALLOWED_EVENTS[number]));
  if (invalidEvents.length > 0) {
    return NextResponse.json({
      error: `Invalid event types: ${invalidEvents.join(', ')}. Allowed: ${ALLOWED_EVENTS.join(', ')}`,
    }, { status: 400 });
  }

  if (!secret || typeof secret !== 'string' || secret.length < 8) {
    return NextResponse.json({ error: 'Secret key is required (min 8 characters)' }, { status: 400 });
  }

  // --- Rate limit: max 10 webhooks per tenant ---
  const { count, error: countError } = await supabase
    .from('tenant_webhooks')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', profile.tenant_id);

  if (countError) {
    console.error('webhooks count error:', countError.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if ((count ?? 0) >= 10) {
    return NextResponse.json({ error: 'Maximum of 10 webhooks per tenant' }, { status: 400 });
  }

  // --- Create ---
  const adminClient = createServiceRoleClient();
  const { data: newWebhook, error: insertError } = await adminClient
    .from('tenant_webhooks')
    .insert({
      tenant_id: profile.tenant_id,
      url,
      events,
      secret, // stored plaintext in dev; encrypted via DB trigger/migration in prod
      description: description ?? null,
      is_active: is_active ?? true,
    })
    .select('id, url, events, is_active, description, created_at')
    .single();

  if (insertError) {
    console.error('webhooks create error:', insertError.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ webhook: newWebhook }, { status: 201 });
}

// ---------------------------------------------------------------------------
// PUT — update an existing webhook
// ---------------------------------------------------------------------------
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as { slug: string };
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!['institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: { id?: string; url?: string; events?: string[]; secret?: string; description?: string; is_active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { id, url, events, secret, description, is_active } = body;

  if (!id) {
    return NextResponse.json({ error: 'Webhook ID is required' }, { status: 400 });
  }

  // Verify ownership
  const adminClient = createServiceRoleClient();
  const { data: existing } = await adminClient
    .from('tenant_webhooks')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
  }

  // --- Validation ---
  if (url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return NextResponse.json({ error: 'URL must use http or https protocol' }, { status: 400 });
      }
      if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        return NextResponse.json({ error: 'HTTPS is required in production' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }
  }

  if (events) {
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'At least one event type is required' }, { status: 400 });
    }
    const invalidEvents = events.filter((e) => !ALLOWED_EVENTS.includes(e as typeof ALLOWED_EVENTS[number]));
    if (invalidEvents.length > 0) {
      return NextResponse.json({
        error: `Invalid event types: ${invalidEvents.join(', ')}`,
      }, { status: 400 });
    }
  }

  const updatePayload: Record<string, unknown> = {};
  if (url !== undefined) updatePayload.url = url;
  if (events !== undefined) updatePayload.events = events;
  if (secret !== undefined) {
    if (secret.length < 8) {
      return NextResponse.json({ error: 'Secret key must be at least 8 characters' }, { status: 400 });
    }
    updatePayload.secret = secret;
  }
  if (description !== undefined) updatePayload.description = description;
  if (is_active !== undefined) updatePayload.is_active = is_active;

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error: updateError } = await adminClient
    .from('tenant_webhooks')
    .update(updatePayload)
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id);

  if (updateError) {
    console.error('webhooks update error:', updateError.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ---------------------------------------------------------------------------
// DELETE — delete a webhook
// ---------------------------------------------------------------------------
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const tenant = profile.tenants as { slug: string };
  if (tenant.slug !== tenantSlug) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  if (!['institution_admin', 'admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

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
    console.error('webhooks delete error:', deleteError.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
