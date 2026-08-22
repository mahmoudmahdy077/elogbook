'use client';

import { useState } from 'react';

/** ACGME WebADS XML export button (director+). Downloads the tenant-wide
 *  XML via the webads API route (proxies the webads-export edge function)
 *  with the report page's date-range filters applied. */
export default function WebAdsExportButton({
  tenantSlug,
  dateFrom,
  dateTo,
}: {
  tenantSlug: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set('date_from', dateFrom);
      if (dateTo) qs.set('date_to', dateTo);
      const res = await fetch(`/api/${tenantSlug}/reports/webads?${qs.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `webads-export-${tenantSlug}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WebADS export failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void download()}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-border bg-surface-solid text-sm font-medium text-text-secondary hover:bg-backdrop transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M10 2a1 1 0 011 1v8.586l2.293-2.293a1 1 0 011.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 11.586V3a1 1 0 011-1zM3 16a1 1 0 011 1v.5h12V17a1 1 0 112 0v1.5a.5.5 0 01-.5.5h-13a.5.5 0 01-.5-.5V17a1 1 0 011-1z" />
        </svg>
        {loading ? 'Exporting…' : 'Export WebADS'}
      </button>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
