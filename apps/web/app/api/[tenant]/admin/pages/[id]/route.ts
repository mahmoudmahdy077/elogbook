import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { validatePageContent } from '@/lib/site-content';

export const runtime = 'nodejs';

const TENANT_ROLES = ['director', 'institution_admin', 'admin'];

async function scopedPage(adminClient: ReturnType<typeof createServiceRoleClient>, tenantId: string, id: string) {
  const { data } = await adminClient
    .from('site_pages')
    .select('id, slug, locale, published_revision_id')
    .eq('id', id)
    .eq('scope', 'tenant')
    .eq('tenant_id', tenantId)
    .single();
  return data as { id: string; slug: string; locale: string; published_revision_id: string | null } | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> },
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const auth = await requireTenantAdmin(supabase, tenantSlug, TENANT_ROLES);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const page = await scopedPage(createServiceRoleClient(), auth.profile.tenant_id, id);
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

  const adminClient = createServiceRoleClient();
  const { data: revisions } = await adminClient
    .from('site_page_revisions')
    .select('id, status, created_at')
    .eq('page_id', id)
    .order('created_at', { ascending: false })
    .limit(50);
  return NextResponse.json({ page, revisions: revisions ?? [] });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> },
) {
  const { tenant: tenantSlug, id } = await params;
  const supabase = await createServerSupabase();
  const auth = await requireTenantAdmin(supabase, tenantSlug, TENANT_ROLES);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { content?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validation = validatePageContent(body.content);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.errors.join('; ') }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();
  const page = await scopedPage(adminClient, auth.profile.tenant_id, id);
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

  const { data: revision, error } = await adminClient
    .from('site_page_revisions')
    .insert({ page_id: id, content: body.content, status: 'draft', author_id: auth.user.id })
    .select('id')
    .single();
  if (error || !revision) {
    return NextResponse.json({ error: error?.message ?? 'Draft failed' }, { status: 500 });
  }
  return NextResponse.json({ revision }, { status: 201 });
}
