import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { validatePageContent } from '@/lib/site-content';

export const runtime = 'nodejs';

/** Page detail with revision history (drafts visible to operators only). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return NextResponse.json({ error: platform.error }, { status: platform.status });
  }

  const adminClient = createServiceRoleClient();
  const { data: page } = await adminClient
    .from('site_pages')
    .select('id, scope, slug, locale, published_revision_id, created_at, updated_at')
    .eq('id', id)
    .eq('scope', 'platform')
    .single();
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

  const { data: revisions } = await adminClient
    .from('site_page_revisions')
    .select('id, status, created_at')
    .eq('page_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({ page, revisions: revisions ?? [] });
}

/** Save a new draft revision (validated; publishing is separate). */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return NextResponse.json({ error: platform.error }, { status: platform.status });
  }

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
  const { data: page } = await adminClient
    .from('site_pages')
    .select('id')
    .eq('id', id)
    .eq('scope', 'platform')
    .single();
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

  const { data: revision, error } = await adminClient
    .from('site_page_revisions')
    .insert({ page_id: id, content: body.content, status: 'draft', author_id: platform.user.id })
    .select('id')
    .single();
  if (error || !revision) {
    return NextResponse.json({ error: error?.message ?? 'Draft failed' }, { status: 500 });
  }

  return NextResponse.json({ revision }, { status: 201 });
}
