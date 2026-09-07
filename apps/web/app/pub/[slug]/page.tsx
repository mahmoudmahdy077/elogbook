import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import SitePageRenderer, { type ContentBlock } from '@/components/SitePageRenderer';
import { validatePageContent } from '@/lib/site-content';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

/**
 * Public platform page renderer (T25). Serves the PUBLISHED revision only;
 * drafts are unreachable here (the query joins through the published
 * pointer). Content is re-validated at render as defense in depth:
 * anything failing validation is a 404, never raw output.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `E-Logbook — ${slug}` };
}

export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) notFound();

  const adminClient = createServiceRoleClient();
  const { data: page } = await adminClient
    .from('site_pages')
    .select('id, slug, published_revision_id')
    .eq('scope', 'platform')
    .eq('slug', slug)
    .eq('locale', 'en')
    .single();
  const pointer = (page as { published_revision_id?: string | null } | null)?.published_revision_id;
  if (!page || !pointer) notFound();

  const { data: revision } = await adminClient
    .from('site_page_revisions')
    .select('content')
    .eq('id', pointer)
    .single();
  const content = (revision as { content?: unknown } | null)?.content;
  if (validatePageContent(content).ok !== true) notFound();

  const blocks = (content as { blocks: ContentBlock[] }).blocks;
  return (
    <main className="min-h-dvh bg-backdrop py-8">
      <SitePageRenderer blocks={blocks} />
    </main>
  );
}
