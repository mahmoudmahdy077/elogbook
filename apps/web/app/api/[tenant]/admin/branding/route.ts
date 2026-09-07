import { createServerSupabase } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { NextResponse } from 'next/server';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { validateThemePublish, PLATFORM_THEME_CEILINGS } from '@/lib/theme-policy';
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

  let body: {
    logo_url?: string | null;
    primary_color?: string | null;
    footer_text?: string | null;
    institution_name?: string | null;
    density?: string | null;
    revert_revision_id?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { logo_url, primary_color, footer_text, institution_name, density, revert_revision_id } = body ?? {};

  // T22: unknown keys fail closed here (the merge below only copies known
  // keys, which would otherwise drop typos silently).
  const knownKeys = new Set([
    'logo_url',
    'primary_color',
    'footer_text',
    'institution_name',
    'density',
    'revert_revision_id',
  ]);
  const unknownKeys = Object.keys(body ?? {}).filter((k) => !knownKeys.has(k));
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      { error: `disallowed theme key(s): ${unknownKeys.join(', ')}` },
      { status: 400 },
    );
  }

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

  // T22 revert: republish a prior revision's config as a new version.
  let revertConfig: Record<string, unknown> | null = null;
  if (revert_revision_id !== null && revert_revision_id !== undefined && revert_revision_id !== '') {
    const { data: revision } = await adminClient
      .from('tenant_theme_revisions')
      .select('config')
      .eq('id', revert_revision_id)
      .eq('tenant_id', profile.tenant_id)
      .single();
    const config = (revision as { config?: Record<string, unknown> } | null)?.config;
    if (!config) {
      return NextResponse.json({ error: 'Theme revision not found' }, { status: 404 });
    }
    revertConfig = config;
  }

  // Merge with existing branding
  const { data: existing } = await adminClient.from('tenants').select('custom_branding').eq('id', profile.tenant_id).single();
  const current = ((existing as { custom_branding?: Record<string, unknown> } | null)?.custom_branding ?? {}) as Record<string, unknown>;

  const incoming: Record<string, unknown> =
    revertConfig ?? { logo_url, primary_color, footer_text, institution_name, density };
  const next: Record<string, unknown> = { ...current };
  // Only set non-empty values; null/empty removes key
  for (const [k, v] of Object.entries(incoming)) {
    const trimmed = typeof v === 'string' ? v.trim() : v;
    if (trimmed === null || trimmed === undefined || trimmed === '') {
      if (k in next) delete next[k];
    } else {
      next[k] = trimmed;
    }
  }

  // T22: platform ceilings + contrast floor gate every publication.
  const policy = validateThemePublish(next, PLATFORM_THEME_CEILINGS);
  if (!policy.ok) {
    return NextResponse.json({ error: policy.errors.join('; ') }, { status: 400 });
  }

  const { error } = await adminClient.from('tenants').update({ custom_branding: next }).eq('id', profile.tenant_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Archive the published version for revert (best-effort sequence).
  const { data: latest } = await adminClient
    .from('tenant_theme_revisions')
    .select('version')
    .eq('tenant_id', profile.tenant_id)
    .order('version', { ascending: false })
    .limit(1);
  const latestVersion = (Array.isArray(latest) ? latest[0]?.version : null) as number | null;
  const { data: archived, error: archiveError } = await adminClient
    .from('tenant_theme_revisions')
    .insert({
      tenant_id: profile.tenant_id,
      version: (typeof latestVersion === 'number' ? latestVersion : 0) + 1,
      config: next,
      status: 'published',
      created_by: user.id,
    })
    .select('id, version')
    .single();

  await adminClient.from('audit_logs').insert({
    tenant_id: profile.tenant_id,
    user_id: user.id,
    action: revertConfig ? 'branding_revert' : 'branding_update',
    resource_type: 'tenant',
    resource_id: profile.tenant_id,
    changes: next,
  });

  return NextResponse.json({
    success: true,
    branding: next,
    version: (archived as { version?: number } | null)?.version ?? null,
    warnings: [...policy.warnings, ...(archiveError ? ['revision archive failed'] : [])],
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> },
) {
  return POST(request, { params });
}
