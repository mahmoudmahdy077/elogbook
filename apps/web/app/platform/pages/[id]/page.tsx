import { notFound } from 'next/navigation';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import PageEditor from './PageEditor';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Platform page editor shell (T25). The layout already gated operators. */
export default async function PlatformPageEditor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const adminClient = createServiceRoleClient();
  const { data: page } = await adminClient
    .from('site_pages')
    .select('id, slug, locale, published_revision_id')
    .eq('id', id)
    .eq('scope', 'platform')
    .single();
  if (!page) notFound();

  const { data: revisions } = await adminClient
    .from('site_page_revisions')
    .select('id, status, created_at')
    .eq('page_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  const row = page as { slug: string; locale: string; published_revision_id: string | null };
  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">
        Edit: {row.slug} ({row.locale})
      </h1>
      <p className="text-sm text-text-muted mb-6">
        Public preview at <span className="font-mono text-xs">/pub/{row.slug}</span> shows the published revision only.
      </p>
      <PageEditor
        pageId={id}
        revisions={(revisions ?? []) as { id: string; status: string; created_at: string }[]}
        publishedId={row.published_revision_id}
      />
    </div>
  );
}
