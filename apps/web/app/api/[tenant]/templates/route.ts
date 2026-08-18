import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { caseTemplateSchema } from '@elogbook/shared';
import { GLOBAL_TENANT_ID } from '@elogbook/shared';

const DIRECTOR_ROLES = ['director', 'institution_admin', 'admin'];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string }> }
) {
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
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

  const { data: templates, error } = await supabase
    .from('case_templates')
    .select('*')
    .or(`tenant_id.eq.${profile.tenant_id},tenant_id.eq.${GLOBAL_TENANT_ID}`)
    .is('deleted_at', null)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

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
  const { tenant: tenantSlug } = await params;
  const supabase = await createServerSupabase();
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

  if (!DIRECTOR_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = caseTemplateSchema.safeParse(body);
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
