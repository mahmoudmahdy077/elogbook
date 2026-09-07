import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { requirePlatformAdmin } from '@/lib/supabase/require-platform-admin';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { validatePageContent } from '@/lib/site-content';

export const runtime = 'nodejs';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * Platform editorial pages (T24). Global pages only; tenant delegation
 * ships with the T25 editor. All mutations audited; drafts never served.
 */
export async function GET() {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return NextResponse.json({ error: platform.error }, { status: platform.status });
  }

  const adminClient = createServiceRoleClient();
  const { data, error } = await adminClient
    .from('site_pages')
    .select('id, slug, locale, published_revision_id, created_at, updated_at')
    .eq('scope', 'platform')
    .order('slug', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pages: data ?? [] });
}

export async function POST(request: Request) {
  const platform = await requirePlatformAdmin(await createServerSupabase());
  if (!platform.ok) {
    return NextResponse.json({ error: platform.error }, { status: platform.status });
  }

  let body: { slug?: string; locale?: string; content?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const locale = typeof body.locale === 'string' && body.locale ? body.locale.trim() : 'en';
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'slug must be lowercase alphanumeric with dashes' }, { status: 400 });
  }
  if (!LOCALE_RE.test(locale)) {
    return NextResponse.json({ error: 'locale must look like en or en-US' }, { status: 400 });
  }

  const content = body.content ?? { blocks: [] };
  const validation = validatePageContent(content);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.errors.join('; ') }, { status: 400 });
  }

  const adminClient = createServiceRoleClient();
  const { data: page, error: pageError } = await adminClient
    .from('site_pages')
    .insert({ scope: 'platform', tenant_id: null, slug, locale })
    .select('id, slug, locale')
    .single();
  if (pageError || !page) {
    const message = pageError?.message ?? 'Create failed';
    const status = /duplicate|unique|conflict/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }

  const pageId = (page as { id: string }).id;
  const { data: revision, error: revError } = await adminClient
    .from('site_page_revisions')
    .insert({
      page_id: pageId,
      content,
      status: 'draft',
      author_id: platform.user.id,
    })
    .select('id')
    .single();
  if (revError || !revision) {
    return NextResponse.json({ error: revError?.message ?? 'Draft failed' }, { status: 500 });
  }

  // Platform audit is scoped to the operator's home tenant (audit_logs
  // requires a tenant); best-effort per repo convention, never silent on
  // the mutation itself.
  try {
    await adminClient.from('audit_logs').insert({
      tenant_id: (platform.profile as { tenant_id: string }).tenant_id,
      user_id: platform.user.id,
      action: 'site_page_create',
      resource_type: 'site_pages',
      resource_id: pageId,
      changes: { slug, locale },
    });
  } catch {
    // Audit failure alerts via logs but never blocks (section 4.3).
    console.warn('[platform-pages] audit insert failed for site_page_create', pageId);
  }

  return NextResponse.json({ page, revision }, { status: 201 });
}
