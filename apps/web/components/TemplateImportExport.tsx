'use client';

import { useState, useRef } from 'react';

interface TemplateImportExportProps {
  templateId?: string;
  templateName?: string;
  tenantSlug: string;
  onImportComplete: () => void;
}

export default function TemplateImportExport({
  templateId,
  templateName,
  tenantSlug,
  onImportComplete,
}: TemplateImportExportProps) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    if (!templateId) return;

    try {
      const res = await fetch(`/api/${tenantSlug}/templates/export/${templateId}`);
      if (!res.ok) throw new Error('Export failed');

      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(templateName ?? 'template').replace(/[^a-z0-9]/gi, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const res = await fetch(`/api/${tenantSlug}/templates/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_data: data }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Import failed');

      setSuccess(`Template "${result.template.name}" imported successfully`);
      onImportComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-2">
      {templateId && (
        <button
          type="button"
          onClick={handleExport}
          className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-neutral-dark/50"
        >
          Export
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImport}
        className="hidden"
        id="template-import"
      />
      <label
        htmlFor="template-import"
        className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-neutral-dark/50 cursor-pointer"
      >
        {importing ? 'Importing...' : 'Import'}
      </label>

      {error && <span className="text-xs text-danger">{error}</span>}
      {success && <span className="text-xs text-success">{success}</span>}
    </div>
  );
}
