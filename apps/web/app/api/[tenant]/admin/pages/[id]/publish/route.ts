import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requireTenantAdmin } from '@/lib/supabase/require-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { validatePageContent } from '@/lib/site-content';
import { defaultTrustedOrigins } from '@/lib/csrf';
import { guardRequest } from '@/lib/http/request-guard';
import { z } from 'zod';

const publishSchema = z.object({
  revision_id: z.string().min(1).max(128),
  expected_current_revision_id: z.string().max(128).nullable().optional(),
}).strict();

export const runtime = 'nodejs';

const TENANT_ROLES = ['director', 'institution_admin', 'admin'];

/** Tenant publish mirrors the platform flow, hard-scoped to one tenant. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenant: string; id: string }> },
) {
  const guarded = await guardRequest(request, publishSchema, {
    trustedOrigins: defaultTrustedOrigins(request),
    maxBodyBytes: 8 * 1024,
  });
  if (!guarded.ok) return guarded.response;

  const { tenant: tenantSlug, id: pageId } = await params;
  const supabase = await createServerSupabase();
  const auth = await requireTenantAdmin(supabase, tenantSlug, TENANT_ROLES);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = guarded.data;

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

  // M8 atomic CAS (same contract as platform publish; tenant scope enforced
  // by the scoped page lookup above + deny-by-default RLS).
  const expectationSet = body.expected_current_revision_id !== undefined;
  const { error: rpcError } = await adminClient.rpc('publish_site_page', {
    p_page_id: pageId,
    p_revision_id: rev.id,
    p_expected_pointer: body.expected_current_revision_id ?? null,
    p_expectation_set: expectationSet,
    p_actor: auth.user.id,
    p_tenant_id: auth.profile.tenant_id,
  });
  if (rpcError) {
    const msg = rpcError.message ?? '';
    if (/pointer_conflict/i.test(msg) || (rpcError as { code?: string }).code === 'P0003') {
      return NextResponse.json(
        { error: 'Page was published since you loaded it; reload and retry' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg || 'Publish failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true, published_revision_id: rev.id });
}
