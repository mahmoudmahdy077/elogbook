import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { caseTemplateUpdateSchema } from '@elogbook/shared';
import { GLOBAL_TENANT_ID } from '@elogbook/shared';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { logger } from '@/lib/logger';

const DIRECTOR_ROLES = ['director', 'institution_admin', 'admin'];
const templateUpdateSchema = caseTemplateUpdateSchema;

async function safeCreateSupabase() {
  try {
    return await createServerSupabase();
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await safeCreateSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

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
  const guarded = await guardRequest(request, templateUpdateSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 32 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug, id } = await params;
  const supabase = await safeCreateSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const auth = await requireTenantAdmin(supabase, tenantSlug, DIRECTOR_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const profile = auth.profile;

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

  const parsed = { data: guarded.data, success: true as const };

  const { data: template, error } = await supabase
    .from('case_templates')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    logger.error('Failed to update template', error, { tenantSlug, templateId: id });
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
  }

  return NextResponse.json({ template });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  const guarded = await guardRequest(request, undefined, {
    trustedOrigins: defaultTrustedOrigins(request),
    requireBody: false,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug, id } = await params;
  const supabase = await safeCreateSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const auth = await requireTenantAdmin(supabase, tenantSlug, DIRECTOR_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const profile = auth.profile;

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

  if (error) {
    logger.error('Failed to delete template', error, { tenantSlug, templateId: id });
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
  }

  return NextResponse.json({ success: true, message: 'Template deleted' });
}
