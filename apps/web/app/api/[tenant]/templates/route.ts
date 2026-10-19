import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { caseTemplateSchema } from '@elogbook/shared';
import { GLOBAL_TENANT_ID } from '@elogbook/shared';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { logger } from '@/lib/logger';

const DIRECTOR_ROLES = ['director', 'institution_admin', 'admin'];

async function safeCreateSupabase() {
  try {
    return await createServerSupabase();
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: tenantSlug } = await params;
  const supabase = await safeCreateSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as unknown as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  const rl = await checkRateLimit(`templates:${tenantSlug}`, 120);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const { data: templates, error } = await supabase
    .from('case_templates')
    .select('*')
    .or(`tenant_id.eq.${profile.tenant_id},tenant_id.eq.${GLOBAL_TENANT_ID}`)
    .is('deleted_at', null)
    .order('name');

  if (error) {
    logger.error('Failed to fetch templates', error, { tenantSlug });
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }

  const { data: usageCounts } = await supabase
    .rpc('get_template_usage_counts', {
      p_tenant_id: profile.tenant_id,
      p_resident_id: profile.id,
    });

  const usageMap = new Map(
    ((usageCounts as unknown as { template_id: string; personal_count: number; tenant_count: number }[]) ?? []).map(u => [u.template_id, u])
  );

  const enriched = (templates ?? []).map(t => ({
    ...t,
    is_global: t.tenant_id === GLOBAL_TENANT_ID,
    usage_count: usageMap.get(t.id)?.tenant_count ?? 0,
    personal_count: usageMap.get(t.id)?.personal_count ?? 0,
  }));

  return NextResponse.json({ templates: enriched });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const guarded = await guardRequest(request, caseTemplateSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 32 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug } = await params;
  const supabase = await safeCreateSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const auth = await requireTenantAdmin(supabase, tenantSlug, DIRECTOR_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const profile = auth.profile;

  const rl = await checkRateLimit(`templates-mut:${tenantSlug}`, 30);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const parsed = { data: guarded.data, success: true as const };

  const { data: existing } = await supabase
    .from('case_templates')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .eq('name', parsed.data.name)
    .eq('specialty', parsed.data.specialty)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'A template with this name and specialty already exists' }, { status: 409 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .insert({
      tenant_id: profile.tenant_id,
      name: parsed.data.name,
      specialty: parsed.data.specialty,
      fields: parsed.data.fields,
      required_fields: parsed.data.required_fields ?? [],
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create template', error, { tenantSlug, name: parsed.data.name });
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }

  return NextResponse.json({ template }, { status: 201 });
}
