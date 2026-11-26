'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function TenantCreateForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState<'institution' | 'individual'>('institution');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/platform/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, tenant_type: type }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        tenant?: { slug: string };
      };
      if (!res.ok) {
        setError(payload.error ?? 'Could not create the tenant.');
        return;
      }
      setCreated(payload.tenant?.slug ?? slug);
      setName('');
      setSlug('');
      router.refresh();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const field =
    'w-full rounded-lg border border-border bg-surface-solid px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

  return (
    <div className="panel mb-6 p-5">
      <h2 className="text-sm font-semibold text-text-primary">Create a tenant</h2>
      <p className="mt-1 text-xs text-text-muted">
        Creates an empty program. Invite its first administrator from the tenant&apos;s
        Invites page — directors are promoted after MFA enrolment.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="text-xs text-text-muted">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="St. Mary's Surgery"
            className={`${field} mt-1`}
          />
        </label>
        <label className="text-xs text-text-muted">
          Slug
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            required
            placeholder="st-marys"
            className={`${field} mt-1`}
          />
        </label>
        <label className="text-xs text-text-muted">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'institution' | 'individual')}
            className={`${field} mt-1`}
          >
            <option value="institution">Institution</option>
            <option value="individual">Individual</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={saving}
          className="min-h-[44px] rounded-lg bg-primary px-4 text-sm font-medium text-text-on-primary hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
      </form>
      {error ? <p role="alert" className="mt-3 text-xs text-fg-danger">{error}</p> : null}
      {created ? (
        <p role="status" className="mt-3 text-xs text-fg-success">
          Created <code className="font-mono">{created}</code>. Open{' '}
          <a className="underline" href={`/${created}/invites`}>/{created}/invites</a> to invite its first admin.
        </p>
      ) : null}
    </div>
  );
}
