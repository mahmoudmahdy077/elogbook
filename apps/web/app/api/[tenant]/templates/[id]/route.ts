import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { caseTemplateSchema } from '@elogbook/shared';
import { GLOBAL_TENANT_ID } from '@elogbook/shared';

const DIRECTOR_ROLES = ['director', 'institution_admin', 'admin'];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, tenants!inner(slug)')
    .eq('user_id', user.id)
    .single();

  if (!profile || (profile.tenants as unknown as { slug: string }).slug !== tenantSlug) {
    return NextResponse.json({ error: 'Invalid tenant' }, { status: 403 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .select('*')
    .eq('id', id)
    .or(`tenant_id.eq.${profile.tenant_id},tenant_id.eq.${GLOBAL_TENANT_ID}`)
    .is('deleted_at', null)
    .single();

  if (error || !template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  return NextResponse.json({ template });
}

export async function PUT(
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

  const { data: existing } = await supabase
    .from('case_templates')
    .select('id, tenant_id')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  if (existing.tenant_id === GLOBAL_TENANT_ID) {
    return NextResponse.json({ error: 'Cannot edit global templates' }, { status: 403 });
  }

  if (existing.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = caseTemplateSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { data: template, error } = await supabase
    .from('case_templates')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ template });
}

export async function DELETE(
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

  const { count } = await supabase
    .from('case_entries')
    .select('id', { count: 'exact', head: true })
    .eq('template_id', id);

  if (count && count > 0) {
    return NextResponse.json({
      error: `Cannot delete: ${count} case entries reference this template`,
      entry_count: count,
    }, { status: 409 });
  }

  // Soft delete with tenant check
  const { error } = await supabase
    .from('case_templates')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, message: 'Template deleted' });
}
