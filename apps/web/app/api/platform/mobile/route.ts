/**
 * Platform-wide mobile controls.
 *
 * A platform operator can put every tenant's app into maintenance or require
 * a minimum build during a security incident. Per-tenant settings still apply;
 * the app merges the two (global maintenance wins, higher version wins).
 */

import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import type { MobileAnnouncement } from '@elogbook/shared';

const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const MAX_BODY_BYTES = 16 * 1024;

function stringOrNull(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function versionOrNull(value: unknown): { ok: boolean; value: string | null } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !VERSION_RE.test(value.trim())) return { ok: false, value: null };
  return { ok: true, value: value.trim() };
}

function parseAnnouncement(
  value: unknown,
): { ok: boolean; value: MobileAnnouncement | null; error?: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, value: null, error: 'announcement must be an object or null' };
  }
  const record = value as Record<string, unknown>;
  const title = stringOrNull(record.title, 120);
  const body = stringOrNull(record.body, 1000);
  if (!title || !body) return { ok: false, value: null, error: 'notification title and body are required' };
  const severity =
    record.severity === 'warning' || record.severity === 'critical' ? record.severity : 'info';
  let expiresAt: string | null = null;
  if (typeof record.expires_at === 'string' && record.expires_at) {
    const parsed = Date.parse(record.expires_at);
    if (!Number.isFinite(parsed)) {
      return { ok: false, value: null, error: 'announcement expiry must be an ISO date' };
    }
    expiresAt = new Date(parsed).toISOString();
  }
  return {
    ok: true,
    value: {
      id: typeof record.id === 'string' && record.id ? record.id : crypto.randomUUID(),
      title,
      body,
      severity,
      expires_at: expiresAt,
    },
  };
}

export async function GET() {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return NextResponse.json({ error: platform.error }, { status: platform.status });
  }
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('platform_mobile_config')
    .select('*')
    .eq('id', true)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data ?? null });
}

export async function POST(request: Request) {
  if (parseInt(request.headers.get('content-length') ?? '0', 10) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Body too large' }, { status: 413 });
  }
  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const supabase = await createServerSupabase();
  const platform = await requirePlatformAdmin(supabase);
  if (!platform.ok) {
    return NextResponse.json({ error: platform.error }, { status: platform.status });
  }

  const { allowed, retryAfter } = await checkRateLimit(`platform-mobile:${platform.user.id}`, 20);
  if (!allowed) return rateLimitResponse(retryAfter);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const minVersion = versionOrNull(body.min_app_version);
  if (!minVersion.ok) {
    return NextResponse.json({ error: 'min_app_version must be x.y.z' }, { status: 400 });
  }
  const updateUrl = stringOrNull(body.update_url, 500);
  if (updateUrl && !/^https:\/\//i.test(updateUrl)) {
    return NextResponse.json({ error: 'update_url must be https://' }, { status: 400 });
  }
  const forceUpdate = body.force_update === true;
  if (forceUpdate && !minVersion.value) {
    return NextResponse.json({ error: 'A forced update needs min_app_version' }, { status: 400 });
  }

  const announcement = parseAnnouncement(body.announcement);
  if (!announcement.ok) {
    return NextResponse.json({ error: announcement.error }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: saved, error } = await admin
    .from('platform_mobile_config')
    .update({
      maintenance_mode: body.maintenance_mode === true,
      maintenance_message: stringOrNull(body.maintenance_message, 500),
      min_app_version: minVersion.value,
      force_update: forceUpdate,
      update_url: updateUrl,
      announcement: announcement.value,
      updated_by: platform.user.id,
    })
    .eq('id', true)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, config: saved });
}
