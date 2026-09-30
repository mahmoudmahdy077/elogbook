'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@/lib/supabase/client';
import ErrorDisplay from '@/components/ErrorDisplay';
import { newRequestId, saveCaseDraft } from '@/lib/cases/submit-flow';
import {
  MAX_IMPORT_BYTES,
  parseCaseImportCsv,
  type ImportTemplateField,
  type ParsedImportRow,
} from '@/lib/cases/import-rows';

interface CaseImportProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  tenantSlug: string;
}

interface TenantTemplate {
  id: string;
  name: string;
  fields: ImportTemplateField[] | null;
}

interface PreviewRow {
  cells: Record<string, string>;
  caseDate: string;
}

const PREVIEW_ROWS = 10;
const MAX_IMPORT_MB = Math.floor(MAX_IMPORT_BYTES / 1024 / 1024);

/**
 * One preview cell per CSV column, resolved back from the validated row.
 *
 * `case_date` and the template selector are projected into dedicated fields
 * rather than `field_values`, so a column name that happens to collide with a
 * projected field still renders the value the import will actually store.
 */
function previewCell(row: ParsedImportRow, column: string): string {
  const normalized = column.trim().toLowerCase();
  if (normalized === 'case_date') return row.caseDate;
  if (normalized === 'template_name' || normalized === 'template') return row.templateSelector ?? '';
  const value = Object.entries(row.fieldValues).find(([key]) => key.toLowerCase() === normalized)?.[1];
  return value === undefined ? '' : String(value);
}

export default function CaseImport({
  isOpen,
  onClose,
  tenantId,
  tenantSlug,
}: CaseImportProps) {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The chosen file is held here, not read back out of the DOM. The input is
  // unmounted once the preview is showing, so a DOM read at import time finds
  // nothing and the import would silently no-op.
  const selectedFileRef = useRef<File | null>(null);
  const [templates, setTemplates] = useState<TenantTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const [importCount, setImportCount] = useState(0);

  /**
   * Tenant templates, each with the field schema an import is validated
   * against. The operator picks the template; the file never gets to define the
   * shape of the data it is about to write.
   */
  async function fetchTemplates(): Promise<TenantTemplate[]> {
    const { data } = await supabase
      .from('case_templates')
      .select('id, name, fields')
      .eq('tenant_id', tenantId);
    return ((data ?? []) as TenantTemplate[]).map((template) => ({
      ...template,
      fields: Array.isArray(template.fields) ? (template.fields as ImportTemplateField[]) : [],
    }));
  }

  /**
   * Load templates, resolve the one in force, and project the file. Returns
   * either a refusal message or the projection to preview. Shared by intake and
   * import so both see exactly the same decision.
   */
  async function projectFile(
    text: string,
    byteLength: number,
  ): Promise<{ refusal: string } | { template: TenantTemplate; parsed: Extract<ReturnType<typeof parseCaseImportCsv>, { ok: true }> }> {
    const available = await fetchTemplates();
    setTemplates(available);

    if (available.length === 0) {
      return { refusal: 'No case templates exist for this program yet. Create a template before importing cases.' };
    }

    const chosen = available.find((candidate) => candidate.id === templateId) ?? available[0]!;
    setTemplateId(chosen.id);

    const parsed = parseCaseImportCsv({ text, fields: chosen.fields ?? [], byteLength });
    if (!parsed.ok) return { refusal: parsed.message };
    if (parsed.rows.length === 0) return { refusal: 'No data rows found in the CSV file' };
    return { template: chosen, parsed };
  }

  function toPreview(
    rows: ParsedImportRow[],
    columns: string[],
  ): PreviewRow[] {
    return rows.slice(0, PREVIEW_ROWS).map((row) => ({
      caseDate: row.caseDate,
      cells: Object.fromEntries(columns.map((column) => [column, previewCell(row, column)])),
    }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    selectedFileRef.current = file;

    if (file.size > MAX_IMPORT_BYTES) {
      setPreviewRows([]);
      setRowCount(0);
      setHeaders([]);
      setError(`File is too large. CSV imports are limited to ${MAX_IMPORT_MB} MB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const outcome = await projectFile(text, file.size);
        if ('refusal' in outcome) {
          setPreviewRows([]);
          setRowCount(0);
          setHeaders([]);
          setError(outcome.refusal);
          return;
        }

        setHeaders(outcome.parsed.headers);
        setRowCount(outcome.parsed.rows.length);
        setPreviewRows(toPreview(outcome.parsed.rows, outcome.parsed.headers));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse CSV file');
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

    // Re-read the full file: the preview only holds the first rows, and the
    // validation and the write must see the same projection.
    const file = selectedFileRef.current;
    if (!file) {
      setError('The selected file is no longer available. Choose it again.');
      setImporting(false);
      return;
    }

    try {
      const text = await file.text();
      const outcome = await projectFile(text, file.size);
      if ('refusal' in outcome) {
        setError(outcome.refusal);
        setImporting(false);
        return;
      }

      const { template, parsed } = outcome;
      const rows = parsed.rows;

      // One file validates against exactly one template schema. A file that
      // names a second template is refused rather than written under a schema
      // its columns were never checked against.
      const byName = new Map<string, TenantTemplate>(
        templates.map((candidate) => [candidate.name.trim().toLowerCase(), candidate] as const),
      );
      for (const row of rows) {
        const wanted = (row.templateSelector ?? '').trim().toLowerCase();
        if (!wanted) continue;
        const rowTemplate = byName.get(wanted);
        if (!rowTemplate) {
          setError(`Template "${row.templateSelector}" does not exist for this program.`);
          setImporting(false);
          return;
        }
        if (rowTemplate.id !== template.id) {
          setError('This file mixes templates. Import one template at a time so every row is validated against the right schema.');
          setImporting(false);
          return;
        }
      }

      const today = new Date().toISOString().split('T')[0] as string;
      let totalInserted = 0;

      for (const row of rows) {
        // Every row crosses the server command boundary (`save_case_draft_command`),
        // which re-validates required fields, PHI, and the write-once draft
        // status. The client projection is a narrowing, never the authority.
        const result = await saveCaseDraft(tenantSlug, {
          request_id: newRequestId(),
          template_id: template.id,
          case_date: row.caseDate || today,
          field_values: row.fieldValues,
          accreditation_mappings: [],
          is_deidentified: true,
          patient_age_years: null,
        });

        if (result.error) {
          setError(result.error);
          setImporting(false);
          return;
        }
        totalInserted += 1;
      }

      setImportCount(totalInserted);
      setImported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import cases');
    }

    setImporting(false);
  }

  function resetForm() {
    selectedFileRef.current = null;
    setPreviewRows([]);
    setRowCount(0);
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
                    className="w-8 h-8 text-fg-approved"
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
                          className="text-xs font-medium text-fg-primary hover:text-fg-primary transition-colors"
                        >
                          Choose different file
                        </button>
                      </div>
                      <p className="text-xs text-text-muted mt-1">
                        Showing first {Math.min(previewRows.length, PREVIEW_ROWS)} of{' '}
                        {rowCount} row{rowCount === 1 ? '' : 's'}
                        {templates.length > 1 && templateId ? (
                          <>
                            {' '}
                            &middot; template{' '}
                            {templates.find((candidate) => candidate.id === templateId)?.name}
                          </>
                        ) : null}
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
                          {previewRows.slice(0, PREVIEW_ROWS).map((row, idx) => (
                            <tr key={idx} className="hover:bg-black/[0.02]">
                              {headers.map((header) => (
                                <td
                                  key={header}
                                  className="px-3 py-2 text-text-secondary truncate max-w-[150px]"
                                >
                                  {row.cells[header] || ''}
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
