'use client';

import { useState } from 'react';
import type { PlatformMobileConfig } from '@elogbook/shared';

export default function PlatformMobilePanel({
  initialConfig,
}: {
  initialConfig: PlatformMobileConfig | null;
}) {
  const [maintenance, setMaintenance] = useState(initialConfig?.maintenance_mode ?? false);
  const [message, setMessage] = useState(initialConfig?.maintenance_message ?? '');
  const [minVersion, setMinVersion] = useState(initialConfig?.min_app_version ?? '');
  const [forceUpdate, setForceUpdate] = useState(initialConfig?.force_update ?? false);
  const [updateUrl, setUpdateUrl] = useState(initialConfig?.update_url ?? '');
  const [annTitle, setAnnTitle] = useState(initialConfig?.announcement?.title ?? '');
  const [annBody, setAnnBody] = useState(initialConfig?.announcement?.body ?? '');
  const [annSeverity, setAnnSeverity] = useState<'info' | 'warning' | 'critical'>(
    initialConfig?.announcement?.severity ?? 'info',
  );
  const [annExpiry, setAnnExpiry] = useState(
    initialConfig?.announcement?.expires_at
      ? new Date(initialConfig.announcement.expires_at).toISOString().slice(0, 10)
      : '',
  );
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch('/api/platform/mobile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maintenance_mode: maintenance,
          maintenance_message: message.trim() || null,
          min_app_version: minVersion.trim() || null,
          force_update: forceUpdate,
          update_url: updateUrl.trim() || null,
          announcement:
            annTitle.trim() && annBody.trim()
              ? {
                  title: annTitle.trim(),
                  body: annBody.trim(),
                  severity: annSeverity,
                  expires_at: annExpiry
                    ? new Date(`${annExpiry}T23:59:59.000Z`).toISOString()
                    : null,
                }
              : null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      setResult(
        res.ok
          ? { ok: true, text: 'Global mobile settings saved. Every tenant app applies them.' }
          : { ok: false, text: data.error ?? 'Could not save.' },
      );
    } catch {
      setResult({ ok: false, text: 'Network error. Nothing was saved.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel p-5 mt-8">
      <h2 className="text-lg font-heading font-semibold mb-1">Mobile app (all tenants)</h2>
      <p className="text-sm text-text-muted mb-4">
        Global floor for every tenant: maintenance applies everywhere, and a higher minimum version
        wins over the tenant setting. Tenant announcements take precedence over the global one.
      </p>

      <label className="flex items-center gap-3 mb-3">
        <input
          type="checkbox"
          checked={maintenance}
          onChange={(e) => setMaintenance(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-primary"
        />
        <span className="text-sm text-text-primary">Global maintenance mode</span>
      </label>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, 500))}
        rows={2}
        placeholder="The app is undergoing scheduled maintenance. Please try again shortly."
        className="w-full px-3 py-2 text-sm text-text-primary placeholder:text-text-muted bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none mb-3"
        aria-label="Global maintenance message"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="p-min-version">
            Minimum app version
          </label>
          <input
            id="p-min-version"
            value={minVersion}
            onChange={(e) => setMinVersion(e.target.value)}
            placeholder="1.0.0"
            className="w-full px-3 py-2 text-sm bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1" htmlFor="p-update-url">
            Update link
          </label>
          <input
            id="p-update-url"
            value={updateUrl}
            onChange={(e) => setUpdateUrl(e.target.value)}
            placeholder="https://apps.apple.com/app/id000000000"
            className="w-full px-3 py-2 text-sm bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <label className="flex items-center gap-3 mt-3">
        <input
          type="checkbox"
          checked={forceUpdate}
          onChange={(e) => setForceUpdate(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-primary"
        />
        <span className="text-sm text-text-primary">Force update below the minimum</span>
      </label>

      <div className="mt-5">
        <h3 className="text-sm font-medium text-text-primary mb-2">Global announcement</h3>
        <input
          value={annTitle}
          onChange={(e) => setAnnTitle(e.target.value.slice(0, 120))}
          placeholder="Title"
          aria-label="Global announcement title"
          className="w-full px-3 py-2 text-sm bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary mb-2"
        />
        <textarea
          value={annBody}
          onChange={(e) => setAnnBody(e.target.value.slice(0, 1000))}
          rows={2}
          placeholder="Message"
          aria-label="Global announcement message"
          className="w-full px-3 py-2 text-sm bg-backdrop rounded-xl border border-border focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none mb-2"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            value={annSeverity}
            onChange={(e) => setAnnSeverity(e.target.value as 'info' | 'warning' | 'critical')}
            aria-label="Global announcement severity"
            className="w-full px-3 py-2 text-sm bg-backdrop rounded-xl border border-border"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <input
            type="date"
            value={annExpiry}
            onChange={(e) => setAnnExpiry(e.target.value)}
            aria-label="Global announcement expiry"
            className="w-full px-3 py-2 text-sm bg-backdrop rounded-xl border border-border"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center min-h-[44px] rounded-full bg-primary px-5 text-sm font-medium text-text-on-primary hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save global settings'}
        </button>
        {result && (
          <p
            role="status"
            className={`text-sm ${result.ok ? 'text-fg-success' : 'text-fg-danger'}`}
          >
            {result.text}
          </p>
        )}
      </div>
    </section>
  );
}
