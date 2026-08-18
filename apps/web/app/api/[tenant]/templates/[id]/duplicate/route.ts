import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { GLOBAL_TENANT_ID } from '@elogbook/shared';

const DIRECTOR_ROLES = ['director', 'institution_admin', 'admin'];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;
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

  const { data: source } = await supabase
    .from('case_templates')
    .select('*')
    .eq('id', id)
    .or(`tenant_id.eq.${profile.tenant_id},tenant_id.eq.${GLOBAL_TENANT_ID}`)
    .is('deleted_at', null)
    .single();

  if (!source) {
    return NextResponse.json({ error: 'Source template not found' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const newName = (body.name as string) || `${source.name} (Copy)`;

  const { data: existing } = await supabase
    .from('case_templates')
    .select('id')
    .eq('tenant_id', profile.tenant_id)
    .eq('name', newName)
    .eq('specialty', source.specialty)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'A template with this name already exists' }, { status: 409 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .insert({
      tenant_id: profile.tenant_id,
      name: newName,
      specialty: source.specialty,
      fields: source.fields,
      required_fields: source.required_fields,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ template }, { status: 201 });
}
