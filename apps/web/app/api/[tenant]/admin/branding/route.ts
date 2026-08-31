import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateOrigin, defaultTrustedOrigins } from '@/lib/csrf';

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
  const auth = await requireTenantAdmin(supabase, tenantSlug, ['director', 'institution_admin', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from('tenants')
    .select('id, slug, custom_branding')
    .eq('id', auth.profile.tenant_id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ branding: (data as { custom_branding?: Record<string, unknown> })?.custom_branding ?? {} });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > 8 * 1024) return NextResponse.json({ error: 'Body too large' }, { status: 413 });

  const csrfError = validateOrigin(request, defaultTrustedOrigins(request));
  if (csrfError) return csrfError;

  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();

  const { data: { user: preUser } } = await supabase.auth.getUser();
  if (!preUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { allowed, retryAfter } = await checkRateLimit(`branding:${preUser.id}`, 20);
  if (!allowed) return rateLimitResponse(retryAfter);

  const auth = await requireTenantAdmin(supabase, tenantSlug, ['director', 'institution_admin', 'admin']);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const profile = auth.profile;
  const user = auth.user;

  let body: { logo_url?: string | null; primary_color?: string | null; footer_text?: string | null; institution_name?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { logo_url, primary_color, footer_text, institution_name } = body ?? {};

  if (logo_url !== null && logo_url !== undefined && String(logo_url).trim() !== '') {
    const v = String(logo_url).trim();
    if (!isValidHttpUrl(v) || v.length > 500) return NextResponse.json({ error: 'logo_url must be a valid http(s) URL (≤500 chars)' }, { status: 400 });
    if (!v.startsWith('https://') && !v.startsWith('http://')) return NextResponse.json({ error: 'logo_url must be https://' }, { status: 400 });
  }
  if (primary_color !== null && primary_color !== undefined && String(primary_color).trim() !== '') {
    const v = String(primary_color).trim();
    if (!HEX_RE.test(v)) return NextResponse.json({ error: 'primary_color must be hex like #007AFF' }, { status: 400 });
  }
  if (footer_text !== null && footer_text !== undefined && String(footer_text).length > 120) {
    return NextResponse.json({ error: 'footer_text too long (max 120)' }, { status: 400 });
  }
  if (institution_name !== null && institution_name !== undefined && String(institution_name).length > 80) {
    return NextResponse.json({ error: 'institution_name too long (max 80)' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();
  // Merge with existing branding
  const { data: existing } = await adminClient.from('tenants').select('custom_branding').eq('id', profile.tenant_id).single();
  const current = ((existing as { custom_branding?: Record<string, unknown> } | null)?.custom_branding ?? {}) as Record<string, unknown>;

  const next: Record<string, unknown> = { ...current };
  // Only set non-empty values; null/empty removes key
  for (const [k, v] of Object.entries({ logo_url, primary_color, footer_text, institution_name })) {
    const trimmed = typeof v === 'string' ? v.trim() : v;
    if (trimmed === null || trimmed === undefined || trimmed === '') {
      if (k in next) delete next[k];
    } else {
      next[k] = trimmed;
    }
  }

  const { error } = await adminClient.from('tenants').update({ custom_branding: next }).eq('id', profile.tenant_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await adminClient.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: 'branding_update',
    resource_type: 'tenant',
    resource_id: profile.tenant_id,
    changes: next,
  });

  return NextResponse.json({ success: true, branding: next });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  return POST(request, { params });
}
