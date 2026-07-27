'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import ErrorDisplay from '@/components/ErrorDisplay';

interface CaseImportProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  residentId: string;
}

interface CsvRow {
  [key: string]: string;
}

export default function CaseImport({
  isOpen,
  onClose,
  tenantId,
  residentId,
}: CaseImportProps) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewRows, setPreviewRows] = useState<CsvRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const [importCount, setImportCount] = useState(0);

  function parseCSV(text: string): { headers: string[]; rows: CsvRow[] } {
    const lines = text.split('\n').filter((line) => line.trim());
    if (lines.length === 0) {
      throw new Error('CSV file is empty');
    }

    const parsedHeaders = parseCSVLine(lines[0]);
    const rows: CsvRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length === 0) continue;
      const row: CsvRow = {};
      parsedHeaders.forEach((header, idx) => {
        row[header.trim()] = (values[idx] || '').trim();
      });
      rows.push(row);
    }

    return { headers: parsedHeaders, rows };
  }

  function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const { headers, rows } = parseCSV(text);
        setHeaders(headers);
        setPreviewRows(rows.slice(0, 10));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to parse CSV file'
        );
      }
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (previewRows.length === 0) return;

    setImporting(true);
    setError(null);

    // Re-parse the full file since previewRows only has first 10
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const { rows } = parseCSV(text);
      const BATCH_SIZE = 50;
      let totalInserted = 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const inserts = batch.map((row) => ({
          tenant_id: tenantId,
          resident_id: residentId,
          case_date: row.case_date || row.date || new Date().toISOString().split('T')[0],
          field_values: row,
          status: 'draft',
        }));

        const { error: insertError } = await supabase
          .from('case_entries')
          .insert(inserts);

        if (insertError) {
          setError(insertError.message);
          setImporting(false);
          return;
        }
        totalInserted += batch.length;
      }

      setImportCount(totalInserted);
      setImported(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to import cases'
      );
    }

    setImporting(false);
  }

  function resetForm() {
    setPreviewRows([]);
    setHeaders([]);
    setFileName(null);
    setError(null);
    setImported(false);
    setImportCount(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-xl glass-panel p-6 my-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-text-primary">
                Import Cases from CSV
              </h2>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full p-1.5 hover:bg-neutral-dark transition-colors"
                aria-label="Close"
              >
                <svg
                  className="w-5 h-5 text-text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {error && <ErrorDisplay message={error} />}

            {imported ? (
              <div className="text-center py-8 space-y-4">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success-50 border border-success/20">
                  <svg
                    className="w-8 h-8 text-approved"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-text-primary">
                    Import Complete
                  </h3>
                  <p className="text-sm text-text-muted mt-1">
                    Successfully imported {importCount} case
                    {importCount !== 1 ? 's' : ''}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="inline-flex px-5 py-2.5 rounded-full bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                {/* File upload */}
                {previewRows.length === 0 ? (
                  <div
                    className="border-2 border-dashed border-border rounded-2xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <svg
                      className="w-10 h-10 mx-auto mb-3 text-text-muted"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                      />
                    </svg>
                    <p className="text-sm font-medium text-text-primary mb-1">
                      Click to upload a CSV file
                    </p>
                    <p className="text-xs text-text-muted">
                      File should have headers in the first row
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </div>
                ) : (
                  <>
                    {/* Preview */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-text-primary">
                          Preview ({fileName})
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            resetForm();
                            fileInputRef.current?.click();
                          }}
                          className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                        >
                          Choose different file
                        </button>
                      </div>
                      <p className="text-xs text-text-muted mt-1">
                        Showing first {Math.min(previewRows.length, 10)} of{' '}
                        {previewRows.length} rows
                      </p>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-neutral-dark">
                            {headers.map((header) => (
                              <th
                                key={header}
                                className="px-3 py-2 text-left font-semibold text-text-muted uppercase tracking-wider"
                              >
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {previewRows.slice(0, 10).map((row, idx) => (
                            <tr key={idx} className="hover:bg-black/[0.02]">
                              {headers.map((header) => (
                                <td
                                  key={header}
                                  className="px-3 py-2 text-text-secondary truncate max-w-[150px]"
                                >
                                  {row[header] || ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex gap-3 mt-6">
                      <button
                        type="button"
                        onClick={resetForm}
                        className="flex-1 rounded-full border border-border text-sm font-medium px-4 py-2.5 text-text-secondary hover:bg-neutral-dark transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleImport}
                        disabled={importing}
                        className={`flex-1 rounded-full bg-primary text-white px-4 py-2.5 text-sm font-medium transition-opacity ${
                          importing
                            ? 'opacity-50 cursor-not-allowed'
                            : 'hover:opacity-90'
                        }`}
                      >
                        {importing
                          ? 'Importing...'
                          : `Import ${previewRows.length} Case${previewRows.length !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
