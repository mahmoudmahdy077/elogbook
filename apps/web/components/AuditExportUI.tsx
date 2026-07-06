'use client';

import { useState, useCallback } from 'react';

interface AuditExportUIProps {
  tenantSlug: string;
  dateFrom: string;
  dateTo: string;
}

type ExportFormat = 'csv' | 'pdf';

export default function AuditExportUI({ tenantSlug, dateFrom, dateTo }: AuditExportUIProps) {
  const [startDate, setStartDate] = useState(dateFrom || '');
  const [endDate, setEndDate] = useState(dateTo || '');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      params.set('format', format);

      const res = await fetch(`/api/${tenantSlug}/audit/export?${params.toString()}`, {
        method: 'GET',
        headers: { 'Accept': format === 'csv' ? 'text/csv' : 'application/pdf' },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Export failed' }));
        throw new Error(body.error || `Export failed (${res.status})`);
      }

      const contentType = res.headers.get('Content-Type') || '';
      const disposition = res.headers.get('Content-Disposition') || '';

      if (contentType.includes('text/csv') || disposition.includes('.csv')) {
        // Download CSV
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (contentType.includes('text/html')) {
        // Download HTML (PDF fallback)
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // PDF or binary — open in new tab
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [tenantSlug, startDate, endDate, format]);

  return (
    <div className="rounded-xl bg-[rgba(255,255,255,0.72)] border border-[rgba(60,60,67,0.10)] p-5 mb-6">
      <h2 className="text-base font-semibold text-[#000000] mb-4">Export Audit Logs</h2>

      {/* Date range row */}
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div className="flex-1 min-w-[140px]">
          <label htmlFor="export-date-from" className="block text-xs font-medium text-[#8E8E93] mb-1.5 uppercase tracking-wide">
            From
          </label>
          <input
            id="export-date-from"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[#F2F2F7] border border-[rgba(60,60,67,0.10)] text-sm text-[#000000] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/30 transition-colors"
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label htmlFor="export-date-to" className="block text-xs font-medium text-[#8E8E93] mb-1.5 uppercase tracking-wide">
            To
          </label>
          <input
            id="export-date-to"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[#F2F2F7] border border-[rgba(60,60,67,0.10)] text-sm text-[#000000] focus:outline-none focus:border-[#007AFF] focus:ring-1 focus:ring-[#007AFF]/30 transition-colors"
          />
        </div>
      </div>

      {/* Format selector — Apple-style pill radio buttons */}
      <div className="mb-4">
        <span className="block text-xs font-medium text-[#8E8E93] mb-2 uppercase tracking-wide">
          Format
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFormat('csv')}
            className={
              'px-4 py-2 rounded-full text-sm font-medium transition-all border ' +
              (format === 'csv'
                ? 'bg-[#007AFF] text-white border-[#007AFF]'
                : 'bg-[#F2F2F7] text-[#3C3C43] border-[rgba(60,60,67,0.10)] hover:border-[rgba(60,60,67,0.20)]')
            }
          >
            CSV
          </button>
          <button
            type="button"
            onClick={() => setFormat('pdf')}
            className={
              'px-4 py-2 rounded-full text-sm font-medium transition-all border ' +
              (format === 'pdf'
                ? 'bg-[#007AFF] text-white border-[#007AFF]'
                : 'bg-[#F2F2F7] text-[#3C3C43] border-[rgba(60,60,67,0.10)] hover:border-[rgba(60,60,67,0.20)]')
            }
          >
            PDF
          </button>
        </div>
      </div>

      {/* Export button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className={
            'inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ' +
            (exporting
              ? 'bg-[#007AFF]/50 text-white cursor-not-allowed'
              : 'bg-[#007AFF] text-white hover:bg-[#0066D6] active:bg-[#0055B3]')
          }
        >
          {exporting ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Exporting…
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export {format.toUpperCase()}
            </>
          )}
        </button>
        {error && (
          <span className="text-sm text-[#FF3B30]">{error}</span>
        )}
      </div>

      <p className="mt-3 text-xs text-[#8E8E93]">
        Exports up to 10,000 most recent audit log entries for the selected date range.
      </p>
    </div>
  );
}
