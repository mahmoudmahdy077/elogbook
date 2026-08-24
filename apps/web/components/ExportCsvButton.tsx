'use client';

import { useState } from 'react';

interface CaseEntryRow {
  id: string;
  case_date: string;
  patient_mrn: string | null;
  status: string;
  case_templates: { name: string; specialty: string } | { name: string; specialty: string }[];
}

export default function ExportCsvButton({ entries }: { entries: CaseEntryRow[] }) {
  const [exporting, setExporting] = useState(false);

  function handleExport() {
    setExporting(true);
    try {
      const headers = ['Case Date', 'Template', 'Specialty', 'Status', 'MRN'];
      const rows = entries.map((e) => {
        const template = Array.isArray(e.case_templates) ? e.case_templates[0] : e.case_templates;
        return [
          e.case_date,
          template?.name || '',
          template?.specialty || '',
          e.status,
          e.patient_mrn || '',
        ];
      });
      const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cases-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={exporting || entries.length === 0}
      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-border text-text-secondary text-sm font-medium hover:bg-neutral-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
    >
      <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10.75 10.75a.75.75 0 001.5 0v-4.5a.75.75 0 00-1.5 0v4.5zM10 16a.75.75 0 01.75.75v1.25a.25.25 0 00.25.25h5.5a.25.25 0 00.25-.25v-1.25a.75.75 0 011.5 0v1.25c0 .69-.56 1.25-1.25 1.25h-5.5c-.69 0-1.25-.56-1.25-1.25v-1.25a.75.75 0 011.5 0zM3.5 3.75a.75.75 0 00-1.5 0v8.5c0 .414.336.75.75.75h12.5a.75.75 0 00.75-.75v-8.5a.75.75 0 00-1.5 0v7.75h-12a.25.25 0 01-.25-.25v-7.75z"/>
      </svg>
      {exporting ? 'Exporting...' : 'Export CSV'}
    </button>
  );
}
