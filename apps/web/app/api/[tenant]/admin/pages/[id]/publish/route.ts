import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { validatePageContent } from '@/lib/site-content';

export const runtime = 'nodejs';

const TENANT_ROLES = ['director', 'institution_admin', 'admin'];

/** Tenant publish mirrors the platform flow, hard-scoped to one tenant. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> },
) {
  const { tenant: tenantSlug, id: pageId } = await params;
  const supabase = await createServerSupabase();
  const auth = await requireTenantAdmin(supabase, tenantSlug, TENANT_ROLES);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { revision_id?: string; expected_current_revision_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.revision_id) {
    return NextResponse.json({ error: 'revision_id is required' }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();
  const { data: page } = await adminClient
    .from('site_pages')
    .select('id, published_revision_id')
    .eq('id', pageId)
    .eq('scope', 'tenant')
    .eq('tenant_id', auth.profile.tenant_id)
    .single();
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

  const currentPointer = (page as { published_revision_id?: string | null }).published_revision_id ?? null;
  if (
    body.expected_current_revision_id !== undefined &&
    body.expected_current_revision_id !== currentPointer
  ) {
    return NextResponse.json(
      { error: 'Page was published since you loaded it; reload and retry' },
      { status: 409 },
    );
  }

  const { data: revision } = await adminClient
    .from('site_page_revisions')
    .select('id, content, status')
    .eq('id', body.revision_id)
    .eq('page_id', pageId)
    .single();
  const rev = revision as { id: string; content: unknown; status: string } | null;
  if (!rev) return NextResponse.json({ error: 'Revision not found' }, { status: 404 });

  const validation = validatePageContent(rev.content);
  if (!validation.ok) {
    return NextResponse.json({ error: `Revision no longer validates: ${validation.errors.join('; ')}` }, { status: 400 });
  }

  if (currentPointer) {
    await adminClient.from('site_page_revisions').update({ status: 'archived' }).eq('id', currentPointer);
  }
  await adminClient.from('site_page_revisions').update({ status: 'published' }).eq('id', rev.id);
  const { error: pointerError } = await adminClient
    .from('site_pages')
    .update({ published_revision_id: rev.id })
    .eq('id', pageId);
  if (pointerError) {
    return NextResponse.json({ error: pointerError.message }, { status: 500 });
  }

  await adminClient.from('audit_logs').insert({
    tenant_id: auth.profile.tenant_id,
    user_id: auth.user.id,
    action: 'tenant_page_publish',
    resource_type: 'site_pages',
    resource_id: pageId,
    changes: { revision_id: rev.id },
  });

  return NextResponse.json({ success: true, published_revision_id: rev.id });
}
