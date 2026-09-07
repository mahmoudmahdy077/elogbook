'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';

interface Revision {
  id: string;
  status: string;
  created_at: string;
}

/**
 * Platform page editor (T25). Structured-JSON composer with server-side
 * validation on save, explicit publish with optimistic concurrency, and
 * revert by republishing a prior revision (revision rows keep their
 * content/author; only lifecycle statuses move). Reordering is cut/paste
 * in this release; the block model (not free HTML) is what makes even a
 * textarea safe.
 */
export default function PageEditor({
  pageId,
  revisions,
  publishedId,
}: {
  pageId: string;
  revisions: Revision[];
  publishedId: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState('{\n  "blocks": [\n    { "type": "text", "body": "" }\n  ]\n}');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function saveDraft() {
    setError(null);
    setSuccess(null);
    let content: unknown;
    try {
      content = JSON.parse(draft);
    } catch {
      setError('Draft is not valid JSON');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/platform/pages/${pageId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; revision?: { id?: string } };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSuccess(`Draft saved (${data.revision?.id?.slice(0, 8) ?? 'ok'})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  async function publish(revisionId: string) {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/platform/pages/${pageId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision_id: revisionId, expected_current_revision_id: publishedId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSuccess('Published');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-2">Draft composer</h2>
        <p className="text-xs text-text-muted mb-2">
          Structured JSON only. Unknown block types, script URLs, and HTML in text fields are rejected on save.
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={18}
          spellCheck={false}
          className="w-full font-mono text-xs rounded-14 border border-border bg-surface-solid p-4 text-text-primary"
          aria-label="Draft content as JSON"
        />
        <div className="mt-3 flex gap-2">
          <button
            onClick={saveDraft}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Save draft'}
          </button>
        </div>
        {error && (
          <div className="mt-3">
            <ErrorDisplay message={error} />
          </div>
        )}
        {success && <p className="mt-3 text-sm text-success">{success}</p>}
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-2">Revisions</h2>
        <ul className="space-y-2">
          {revisions.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-14 border border-border bg-surface p-3">
              <div>
                <p className="font-mono text-xs text-text-primary">
                  {r.id.slice(0, 8)} {r.id === publishedId && <span className="text-success">(published)</span>}
                </p>
                <p className="text-xs text-text-muted">
                  {r.status} · {new Date(r.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => void publish(r.id)}
                disabled={loading || r.id === publishedId}
                className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-50"
              >
                {r.id === publishedId ? 'Live' : 'Publish'}
              </button>
            </li>
          ))}
          {revisions.length === 0 && <p className="text-sm text-text-muted">No revisions yet.</p>}
        </ul>
      </div>
    </div>
  );
}
