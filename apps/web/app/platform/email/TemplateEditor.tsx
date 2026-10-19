'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ErrorDisplay from '@/components/ErrorDisplay';

interface EmailTemplate {
  key: string;
  subject: string;
  html: string;
  text: string | null;
  version: number;
  active: boolean;
  updated_at: string;
}

/**
 * Platform email template editor. Lists templates from the platform API,
 * loads the selected template in full, and saves via PUT with server-side
 * zod validation (subject max 200, html max 100KB) + version bump.
 */
export default function TemplateEditor() {
  const router = useRouter();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [text, setText] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void loadList();
  }, []);

  async function loadList(selectKey?: string) {
    setListLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/email/templates');
      const data = (await res.json().catch(() => ({}))) as { error?: string; templates?: EmailTemplate[] };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const list = data.templates ?? [];
      setTemplates(list);
      const next = selectKey ?? selectedKey ?? list[0]?.key ?? '';
      if (next) await selectTemplate(next, list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setListLoading(false);
    }
  }

  async function selectTemplate(key: string, list?: EmailTemplate[]) {
    setSelectedKey(key);
    setError(null);
    setSuccess(null);
    const cached = (list ?? templates).find((t) => t.key === key);
    if (cached?.html !== undefined) {
      setSubject(cached.subject);
      setHtml(cached.html);
      setText(cached.text ?? '');
      setVersion(cached.version);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/platform/email/templates/${encodeURIComponent(key)}`);
      const data = (await res.json().catch(() => ({}))) as { error?: string; template?: EmailTemplate };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.template) {
        setSubject(data.template.subject);
        setHtml(data.template.html);
        setText(data.template.text ?? '');
        setVersion(data.template.version);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!selectedKey) return;
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/platform/email/templates/${encodeURIComponent(selectedKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, html, text: text || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; template?: EmailTemplate };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setVersion(data.template?.version ?? null);
      setSuccess(`Saved ${selectedKey} (v${data.template?.version ?? '?'})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-14 border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-text-primary mb-1">Templates</h2>
      <p className="text-xs text-text-muted mb-4">
        Subject max 200 chars, HTML max 100KB. Saves bump the version and are audited.
        {version !== null && <> Currently editing v{version}.</>}
      </p>
      {listLoading ? (
        <p className="text-sm text-text-muted">Loading templates…</p>
      ) : (
        <>
          <label className="block text-xs font-medium text-text-muted mb-1" htmlFor="email-template-select">
            Template
          </label>
          <select
            id="email-template-select"
            value={selectedKey}
            onChange={(e) => void selectTemplate(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-solid px-3 py-2 text-sm text-text-primary mb-4"
          >
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.key} (v{t.version}{t.active ? '' : ', inactive'})
              </option>
            ))}
            {templates.length === 0 && <option value="">No templates</option>}
          </select>
          <label className="block text-xs font-medium text-text-muted mb-1" htmlFor="email-template-subject">
            Subject
          </label>
          <input
            id="email-template-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            className="w-full rounded-lg border border-border bg-surface-solid px-3 py-2 text-sm text-text-primary mb-3"
          />
          <label className="block text-xs font-medium text-text-muted mb-1" htmlFor="email-template-html">
            HTML
          </label>
          <textarea
            id="email-template-html"
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full font-mono text-xs rounded-lg border border-border bg-surface-solid p-3 text-text-primary mb-3"
          />
          <label className="block text-xs font-medium text-text-muted mb-1" htmlFor="email-template-text">
            Text (optional)
          </label>
          <textarea
            id="email-template-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            spellCheck={false}
            className="w-full font-mono text-xs rounded-lg border border-border bg-surface-solid p-3 text-text-primary"
          />
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => void save()}
              disabled={loading || !selectedKey}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Save template'}
            </button>
          </div>
        </>
      )}
      {error && (
        <div className="mt-3">
          <ErrorDisplay message={error} onRetry={() => void loadList()} />
        </div>
      )}
      {success && <p className="mt-3 text-sm text-success">{success}</p>}
    </div>
  );
}
