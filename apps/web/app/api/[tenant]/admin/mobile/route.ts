/**
 * Tenant admin control plane for the Expo app.
 *
 *   GET  — current mobile config + registered device count
 *   POST — { action: 'save', config }        publish module/version/notice controls
 *          { action: 'broadcast', title, body, role? } send a push to devices
 *
 * The app reads the same row directly through RLS, so a save is live on the
 * next boot/foreground without an app-store release. Values are presentation
 * controls only; authorization remains in RLS and the command RPCs.
 */

import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';
import {
  MOBILE_FEATURE_KEYS,
  isMobileFeatureKey,
  type MobileAnnouncement,
  type MobileFeatureKey,
} from '@elogbook/shared';

const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_TITLE = 120;
const MAX_PUSH_BODY = 500;
const MAX_ANNOUNCEMENT_BODY = 1000;
const PUSH_BATCH = 100;
const MAX_TOKENS = 2000;

const ROLES = ['resident', 'supervisor', 'director', 'institution_admin', 'admin'] as const;
type AudienceRole = (typeof ROLES)[number] | 'all';

interface SavePayload {
  enabled_features?: unknown;
  maintenance_mode?: unknown;
  maintenance_message?: unknown;
  min_app_version?: unknown;
  latest_app_version?: unknown;
  force_update?: unknown;
  update_url?: unknown;
  announcement?: unknown;
}

function stringOrNull(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function versionOrNull(value: unknown): { ok: boolean; value: string | null } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !VERSION_RE.test(value.trim())) return { ok: false, value: null };
  return { ok: true, value: value.trim() };
}

function parseFeatures(value: unknown): { ok: boolean; value: Partial<Record<MobileFeatureKey, boolean>> } {
  if (value === null || value === undefined) return { ok: true, value: {} };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, value: {} };
  const record = value as Record<string, unknown>;
  const out: Partial<Record<MobileFeatureKey, boolean>> = {};
  for (const [key, flag] of Object.entries(record)) {
    if (!isMobileFeatureKey(key)) return { ok: false, value: {} };
    if (typeof flag !== 'boolean') return { ok: false, value: {} };
    out[key] = flag;
  }
  // Reject missing known keys only if we ever make the map exhaustive; a
  // sparse map intentionally means "everything not listed stays enabled".
  return { ok: true, value: out };
}

function parseAnnouncement(
  value: unknown,
  existingId: string | null,
): { ok: boolean; value: MobileAnnouncement | null; error?: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, value: null, error: 'announcement must be an object or null' };
  }
  const record = value as Record<string, unknown>;
  const title = stringOrNull(record.title, MAX_TITLE);
  const body = stringOrNull(record.body, MAX_ANNOUNCEMENT_BODY);
  if (!title || !body) {
    return { ok: false, value: null, error: 'announcement title and body are required' };
  }
  const severity =
    record.severity === 'warning' || record.severity === 'critical' ? record.severity : 'info';
  let expiresAt: string | null = null;
  if (record.expires_at !== null && record.expires_at !== undefined && record.expires_at !== '') {
    if (typeof record.expires_at !== 'string') {
      return { ok: false, value: null, error: 'announcement expiry must be an ISO date' };
    }
    const parsed = Date.parse(record.expires_at);
    if (!Number.isFinite(parsed)) {
      return { ok: false, value: null, error: 'announcement expiry must be an ISO date' };
    }
    expiresAt = new Date(parsed).toISOString();
  }
  return {
    ok: true,
    value: {
      id: existingId ?? crypto.randomUUID(),
      title,
      body,
      severity,
      expires_at: expiresAt,
    },
  };
}

async function loadConfig(tenantId: string) {
  const admin = createServiceRoleClient();
  const { data } = await admin
    .from('mobile_app_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

async function countDevices(tenantId: string): Promise<number> {
  const admin = createServiceRoleClient();
  const { count } = await admin
    .from('push_tokens')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('active', true);
  return count ?? 0;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const auth = await requireTenantAdmin(supabase, tenantSlug, [
    'director',
    'institution_admin',
    'admin',
  ]);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const [config, devices] = await Promise.all([
    loadConfig(auth.profile.tenant_id),
    countDevices(auth.profile.tenant_id),
  ]);

  return NextResponse.json({
    config: config ?? null,
    features: MOBILE_FEATURE_KEYS,
    devices,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  if (parseInt(request.headers.get('content-length') ?? '0', 10) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Body too large' }, { status: 413 });
  }

  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user: preUser },
  } = await supabase.auth.getUser();
  if (!preUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { allowed, retryAfter } = await checkRateLimit(`mobile-admin:${preUser.id}`, 30);
  if (!allowed) return rateLimitResponse(retryAfter);

  const auth = await requireTenantAdmin(supabase, tenantSlug, [
    'director',
    'institution_admin',
    'admin',
  ]);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.action === 'broadcast') {
    return broadcast(auth.profile.tenant_id, auth.user.id, body);
  }
  if (body.action !== 'save') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const input = (body.config ?? {}) as SavePayload;
  const features = parseFeatures(input.enabled_features);
  if (!features.ok) {
    return NextResponse.json({ error: 'enabled_features contains an unknown module' }, { status: 400 });
  }

  const minVersion = versionOrNull(input.min_app_version);
  if (!minVersion.ok) {
    return NextResponse.json({ error: 'min_app_version must be x.y.z' }, { status: 400 });
  }
  const latestVersion = versionOrNull(input.latest_app_version);
  if (!latestVersion.ok) {
    return NextResponse.json({ error: 'latest_app_version must be x.y.z' }, { status: 400 });
  }

  const updateUrl = stringOrNull(input.update_url, 500);
  if (updateUrl && !/^https:\/\//i.test(updateUrl)) {
    return NextResponse.json({ error: 'update_url must be https://' }, { status: 400 });
  }

  const maintenanceMessage = stringOrNull(input.maintenance_message, 500);
  const existing = await loadConfig(auth.profile.tenant_id);
  const existingAnnouncement =
    existing && typeof existing.announcement === 'object'
      ? (existing.announcement as Record<string, unknown>)
      : null;
  const sameAnnouncement =
    existingAnnouncement &&
    typeof input.announcement === 'object' &&
    input.announcement !== null &&
    (input.announcement as Record<string, unknown>).title === existingAnnouncement.title &&
    (input.announcement as Record<string, unknown>).body === existingAnnouncement.body;

  const announcement = parseAnnouncement(
    input.announcement,
    sameAnnouncement && typeof existingAnnouncement?.id === 'string'
      ? existingAnnouncement.id
      : null,
  );
  if (!announcement.ok) {
    return NextResponse.json({ error: announcement.error ?? 'Invalid announcement' }, { status: 400 });
  }

  const forceUpdate = input.force_update === true;
  if (forceUpdate && !minVersion.value) {
    return NextResponse.json(
      { error: 'A forced update needs min_app_version' },
      { status: 400 },
    );
  }

  const record = {
    tenant_id: auth.profile.tenant_id,
    enabled_features: features.value,
    maintenance_mode: input.maintenance_mode === true,
    maintenance_message: maintenanceMessage,
    min_app_version: minVersion.value,
    latest_app_version: latestVersion.value,
    force_update: forceUpdate,
    update_url: updateUrl,
    announcement: announcement.value,
    updated_by: auth.user.id,
  };

  const admin = createServiceRoleClient();
  const { data: saved, error } = await admin
    .from('mobile_app_config')
    .upsert(record, { onConflict: 'tenant_id' })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: auditError } = await admin.from('audit_logs').insert({
    tenant_id: auth.profile.tenant_id,
    user_id: auth.user.id,
    action: 'mobile_app_config_update',
    resource_type: 'tenant',
    resource_id: auth.profile.tenant_id,
    changes: {
      enabled_features: features.value,
      maintenance_mode: record.maintenance_mode,
      min_app_version: record.min_app_version,
      force_update: record.force_update,
      announcement_id: announcement.value?.id ?? null,
    },
  });
  if (auditError) {
    console.error('[mobile-admin] audit insert failed:', auditError.message);
  }

  return NextResponse.json({ success: true, config: saved });
}

async function broadcast(
  tenantId: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const title = stringOrNull(body.title, MAX_TITLE);
  const message = stringOrNull(body.body, MAX_PUSH_BODY);
  if (!title || !message) {
    return NextResponse.json({ error: 'Push title and body are required' }, { status: 400 });
  }

  const requestedRole = body.role;
  const audience: AudienceRole =
    typeof requestedRole === 'string' && (ROLES as ReadonlyArray<string>).includes(requestedRole)
      ? (requestedRole as AudienceRole)
      : 'all';

  const admin = createServiceRoleClient();

  let userIds: string[] | null = null;
  if (audience !== 'all') {
    const { data: profiles, error: profileError } = await admin
      .from('profiles')
      .select('user_id')
      .eq('tenant_id', tenantId)
      .eq('role', audience)
      .limit(MAX_TOKENS);
    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
    userIds = (profiles ?? []).map((p: { user_id: string }) => p.user_id).filter(Boolean);
    if (userIds.length === 0) {
      return NextResponse.json({ success: true, devices: 0, sent: 0, failed: 0 });
    }
  }

  let tokenQuery = admin
    .from('push_tokens')
    .select('token')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .limit(MAX_TOKENS);
  if (userIds) tokenQuery = tokenQuery.in('user_id', userIds);

  const { data: tokens, error } = await tokenQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const recipients = (tokens ?? [])
    .map((t: { token?: string }) => t.token)
    .filter((t): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'));

  if (recipients.length === 0) {
    return NextResponse.json({ success: true, devices: 0, sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;
  const invalid: string[] = [];

  for (let i = 0; i < recipients.length; i += PUSH_BATCH) {
    const chunk = recipients.slice(i, i + PUSH_BATCH);
    const messages = chunk.map((to) => ({
      to,
      sound: 'default',
      title,
      body: message,
      data: { type: 'announcement' },
      priority: 'high',
    }));
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!response.ok) {
        failed += chunk.length;
        continue;
      }
      const result = (await response.json()) as {
        data?: Array<{ status?: string; to?: string; details?: { error?: string } }>;
      };
      for (const receipt of result.data ?? []) {
        if (receipt.status === 'error') {
          failed += 1;
          if (receipt.details?.error === 'DeviceNotRegistered' && receipt.to) {
            invalid.push(receipt.to);
          }
        } else {
          sent += 1;
        }
      }
    } catch {
      failed += chunk.length;
    }
  }

  if (invalid.length) {
    const { error: deactivateError } = await admin
      .from('push_tokens')
      .update({ active: false })
      .in('token', invalid);
    if (deactivateError) {
      console.error('[mobile-admin] push token deactivate failed:', deactivateError.message);
    }
  }

  const { error: auditError } = await admin.from('audit_logs').insert({
    tenant_id: tenantId,
    user_id: userId,
    action: 'mobile_push_broadcast',
    resource_type: 'tenant',
    resource_id: tenantId,
    changes: { title, audience, devices: recipients.length, sent, failed },
  });
  if (auditError) {
    console.error('[mobile-admin] broadcast audit insert failed:', auditError.message);
  }

  return NextResponse.json({
    success: true,
    devices: recipients.length,
    sent,
    failed,
  });
}
