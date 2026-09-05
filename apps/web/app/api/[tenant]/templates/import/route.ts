import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { caseTemplateSchema } from '@elogbook/shared';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit-redis';

const DIRECTOR_ROLES = ['director', 'institution_admin', 'admin'];

async function safeCreateSupabase() {
  try {
    return await createServerSupabase();
  } catch {
    return null;
  }
}

export async function POST(
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
    .select('id, tenant_id, role, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as unknown as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  const rl = await checkRateLimit(`tpl-import:${tenantSlug}`, 10);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  if (!DIRECTOR_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Handle both formats: direct template object and export wrapper
  let templateData: Record<string, unknown>;
  if (body.template && typeof body.template === 'object') {
    // Export wrapper format: { elogbook_template_version, exported_at, template }
    templateData = body.template as Record<string, unknown>;
  } else if (body.template_data && typeof body.template_data === 'object') {
    // Client wrapper format: { template_data: { template: {...} } }
    const td = body.template_data as Record<string, unknown>;
    templateData = (td.template as Record<string, unknown>) || body.template_data as Record<string, unknown>;
  } else {
    // Direct template object
    templateData = body;
  }

  const parsed = caseTemplateSchema.safeParse(templateData);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ template }, { status: 201 });
}
